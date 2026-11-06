import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { FacebookService, FB_TMP, fbUploadName } from './facebook.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

type Upload = { path: string; originalname: string; fieldname: string; mimetype: string };
type Res = { setHeader(name: string, value: string): void; status(code: number): void };

const MEDIA_EXT = /^\.(jpe?g|png|gif|webp|bmp|heic|mp4|mov|m4v|webm|avi|mkv|3gp|wmv|mpe?g|flv|ogv)$/i;

/**
 * Dealership Portal › FB Poster (the old fb-poster app, now inside the platform).
 * Every dealer user has their own Facebook login, running in a browser on the server.
 */
@Controller('dealer/facebook')
@Perms('inventory')
export class FacebookController {
  constructor(private readonly fb: FacebookService) {}

  // ───────── connection & live browser view ─────────

  /** status, activity log (after ?log=<last seq>), posting progress, connected account */
  @Get('state')
  state(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query('log') log?: string, @Query('peek') peek?: string) {
    // peek=1: the progress bar on every portal page — it must not keep an unused Facebook browser awake
    return this.fb.state(t, u, Number(log) || 0, peek === '1');
  }

  @Post('connect')
  connect(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.connect(t, u);
  }

  /** close the browser (the login stays saved) */
  @Post('disconnect')
  disconnect(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.disconnect(t, u);
  }

  @Post('switch-account')
  switchAccount(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.switchAccount(t, u);
  }

  /** log out and delete the saved login from the server */
  @Post('forget')
  forget(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.forget(t, u);
  }

  @Put('proxy')
  proxy(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: { proxy?: string }) {
    return this.fb.setProxy(t, u, String(b.proxy || ''));
  }

  @Post('view/start')
  viewStart(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.viewStart(t, u);
  }

  @Post('view/stop')
  viewStop(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.viewStop(t, u);
  }

  /** next screen picture after ?after=<seq> (waits up to 8 s; 204 = nothing new) */
  @Get('view/frame')
  async frame(@TenantId() t: string, @CurrentUser() u: AuthUser, @Query('after') after: string, @Res({ passthrough: true }) res: Res) {
    const f = await this.fb.frame(t, u, Number(after) || 0);
    res.setHeader('Cache-Control', 'no-store');
    if (!f) {
      res.status(204);
      return undefined;
    }
    res.setHeader('X-Frame-Seq', String(f.seq));
    return new StreamableFile(f.data, { type: 'image/jpeg' });
  }

  /** { type: click|move|wheel|key|text, x, y, dx, dy, key, ctrl, shift, alt, text } */
  @Post('view/input')
  input(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: Record<string, unknown>) {
    return this.fb.input(t, u, b);
  }

  /** { action: back|forward|reload|home|url, url? } */
  @Post('view/nav')
  nav(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: { action?: string; url?: string }) {
    return this.fb.nav(t, u, String(b.action || 'home'), b.url);
  }

  /** problem screenshots mentioned in the activity log */
  @Get('debug/:file')
  debug(@TenantId() t: string, @Param('file') file: string) {
    return new StreamableFile(this.fb.debugFile(t, file), { type: 'image/png', disposition: 'inline' });
  }

  // ───────── Pages, groups, collections, posting ─────────

  @Post('pages/load')
  loadPages(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.loadPages(t, u);
  }

  /** act as a Page: { url, name } */
  @Post('pages/switch')
  switchPage(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: { url?: string; name?: string }) {
    return this.fb.switchToPage(t, u, b);
  }

  @Post('pages/personal')
  personal(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.clearActingAs(t, u);
  }

  @Post('groups/load')
  loadGroups(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.loadGroups(t, u);
  }

  /** save the Pages / groups lists (links added or removed by hand) */
  @Put('targets')
  targets(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: { pages?: unknown; groups?: unknown }) {
    return this.fb.saveTargets(t, u, b);
  }

  @Get('collections')
  collections(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.collections(t, u);
  }

  @Post('collections')
  createCollection(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: Record<string, unknown>) {
    return this.fb.saveCollection(t, u, null, b);
  }

  @Put('collections/:id')
  updateCollection(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.fb.saveCollection(t, u, id, b);
  }

  @Delete('collections/:id')
  deleteCollection(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fb.deleteCollection(t, u, id);
  }

  @Get('quick-config')
  getQuickConfig(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.getQuickConfig(t, u);
  }

  @Put('quick-config')
  saveQuickConfig(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: Record<string, unknown>) {
    return this.fb.saveQuickConfig(t, u, b);
  }

  /** multipart: media files + targets, names, caption, hashtags, order, delayMin, delayMax */
  @Post('post')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({ destination: FB_TMP, filename: (_req: unknown, file: Upload, cb: (e: Error | null, name: string) => void) => cb(null, fbUploadName(file.originalname)) }),
      limits: { fileSize: 500 * 1024 * 1024, files: 20 },
      fileFilter: (_req: unknown, file: Upload, cb: (e: Error | null, ok: boolean) => void) => {
        const ok = file.fieldname === 'media' && (/^(image|video)\//.test(file.mimetype) || MEDIA_EXT.test(extname(file.originalname)));
        cb(ok ? null : new BadRequestException(`Unsupported file: ${file.originalname}. Use photos (JPG, PNG, WEBP, GIF) or videos (MP4, MOV, WEBM…).`), ok);
      },
    }),
  )
  post(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: Record<string, string>, @UploadedFiles() files: Upload[] | undefined) {
    return this.fb.post(t, u, b, files || []);
  }

  @Post('stop')
  stop(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.stopPosting(t, u);
  }

  @Get('history')
  history(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.history(t, u);
  }

  // ───────── Marketplace ─────────

  @Get('mp/settings')
  mpSettings(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.getSettings(t, u);
  }

  @Put('mp/settings')
  mpSaveSettings(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: Record<string, unknown>) {
    return this.fb.saveSettings(t, u, b);
  }

  /** inventory vehicles with their Marketplace listing */
  @Get('mp/vehicles')
  mpVehicles(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.mpVehicles(t, u);
  }

  /** listing text & Facebook-only fields: { title, description, hashtags, fbCondition, cleanTitle } */
  @Put('mp/vehicles/:id')
  mpSaveCopy(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    return this.fb.saveCopy(t, u, id, b);
  }

  @Get('mp/vehicles/:id/preview')
  mpPreview(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fb.preview(t, u, id);
  }

  /** { ai: boolean, save?: false } → template or AI text (save=false: only return it) */
  @Post('mp/vehicles/:id/generate')
  mpGenerate(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { ai?: boolean; save?: boolean }) {
    return this.fb.generate(t, u, id, !!b.ai, b.save !== false);
  }

  @Post('mp/generate-bulk')
  mpGenerateBulk(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: { ids?: string[]; ai?: boolean }) {
    return this.fb.generateBulk(t, u, Array.isArray(b.ids) ? b.ids : [], !!b.ai);
  }

  @Post('mp/publish')
  mpPublish(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() b: { ids?: string[] }) {
    return this.fb.publish(t, u, Array.isArray(b.ids) ? b.ids : []);
  }

  @Post('mp/vehicles/:id/update-listing')
  mpUpdate(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { price?: unknown }) {
    return this.fb.updateListing(t, u, id, b);
  }

  /** { mode: sold | delete } */
  @Post('mp/vehicles/:id/remove')
  mpRemove(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { mode?: string }) {
    return this.fb.removeListing(t, u, id, String(b.mode || 'delete'));
  }

  @Post('mp/vehicles/:id/verify')
  mpVerify(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fb.verifyListing(t, u, id);
  }

  /** { action: set_url | mark_removed | mark_sold | reset, url? } */
  @Post('mp/vehicles/:id/listing')
  mpManual(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: { action?: string; url?: string }) {
    return this.fb.manualListing(t, u, id, b);
  }

  @Post('mp/stop')
  mpStop(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.fb.mpStop(t, u);
  }
}
