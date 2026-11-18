import { BadRequestException, Body, Controller, Get, Header, NotFoundException, Param, Post, StreamableFile } from '@nestjs/common';
import { MediaService } from './media.service.js';
import { VehiclePhotoEnhancerService } from './photo-enhancer.service.js';
import { CUSTOM, DEFAULT_PRESET, PRESET_MAP, TRANSPARENT, TRANSPARENT_CLEAN } from './studio-backgrounds.js';
import { CurrentUser, Perms, Public, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

type StudioBody = { source?: string; background?: string; customBackground?: string };

const thumbs = new Map<string, Buffer>();

/**
 * Photo Studio (dealer portal › vehicle photos): put a vehicle photo on a showroom / studio / outdoor scene, a custom
 * photo or a transparent background. The cut-out is made once per photo and cached, so trying other backgrounds is
 * quick. preview = smaller before / after images (nothing saved); apply = full size, saved as a new photo.
 */
@Controller('dealer/media/studio')
@Perms('inventory')
export class StudioController {
  constructor(
    private readonly media: MediaService,
    private readonly enhancer: VehiclePhotoEnhancerService,
  ) {}

  /** GET /dealer/media/studio — installed? + the backgrounds (thumbnails at /studio/backgrounds/<id>.jpg) */
  @Get()
  async info() {
    const st = await this.enhancer.status();
    return {
      available: st.available,
      reason: st.reason || '',
      default: DEFAULT_PRESET,
      backgrounds: this.enhancer.backgrounds().map((b) => ({ ...b, thumb: `/studio/backgrounds/${b.id}.jpg` })),
    };
  }

  private async choice(tenantId: string, b: StudioBody) {
    const background = String(b.background || DEFAULT_PRESET);
    if (background !== TRANSPARENT && background !== TRANSPARENT_CLEAN && background !== CUSTOM && !PRESET_MAP.has(background)) throw new BadRequestException('Unknown background');
    const custom = background === CUSTOM ? await this.media.readSource(tenantId, String(b.customBackground || '')) : null;
    return { background, custom };
  }

  /** POST /dealer/media/studio/preview { source, background, customBackground? } → before / after (data URLs) */
  @Post('preview')
  async preview(@TenantId() t: string, @Body() b: StudioBody) {
    const choice = await this.choice(t, b || {});
    const input = await this.media.readSource(t, String(b?.source || ''));
    const c = await this.enhancer.cutout(input, { priority: 'high' });
    if (!c.ok) return { ok: false, reason: c.reason };
    const r = await this.enhancer.render(c.cutout, choice, { preview: true });
    return {
      ok: true,
      cached: c.cached,
      ms: c.cutout.ms,
      width: r.width,
      height: r.height,
      after: `data:image/jpeg;base64,${r.buffer.toString('base64')}`,
      before: r.before ? `data:image/jpeg;base64,${r.before.toString('base64')}` : '',
    };
  }

  /** POST /dealer/media/studio/apply { source, background, customBackground? } → the full-size photo, saved */
  @Post('apply')
  async apply(@TenantId() t: string, @Body() b: StudioBody, @CurrentUser() u: AuthUser) {
    const choice = await this.choice(t, b || {});
    const source = String(b?.source || '');
    const input = await this.media.readSource(t, source);
    const c = await this.enhancer.cutout(input, { priority: 'high' });
    if (!c.ok) return { ok: false, reason: c.reason };
    const r = await this.enhancer.render(c.cutout, choice);
    const name = `${(source.split(/[?#]/)[0].split('/').pop() || 'photo').replace(/\.[a-z0-9]+$/i, '')}-${choice.background}.${r.ext}`;
    const m = await this.media.store(t, r.buffer, { ext: r.ext, mime: r.mime, width: r.width, height: r.height }, name, u);
    return { ok: true, url: m.url, width: r.width, height: r.height, background: choice.background };
  }
}

/** the background thumbnails for the picker (no login: plain pictures, cached by the browser) */
@Controller('studio')
export class StudioPublicController {
  constructor(private readonly enhancer: VehiclePhotoEnhancerService) {}

  @Get('backgrounds/:file')
  @Public()
  @Header('Cache-Control', 'public, max-age=86400')
  async thumb(@Param('file') file: string) {
    const id = String(file || '').replace(/\.jpg$/i, '');
    if (!PRESET_MAP.has(id)) throw new NotFoundException();
    let buf = thumbs.get(id);
    if (!buf) {
      buf = (await this.enhancer.backgroundImage(id, 480, 360)) ?? undefined;
      if (!buf) throw new NotFoundException('Image packages are not installed on the server');
      thumbs.set(id, buf);
    }
    return new StreamableFile(buf, { type: 'image/jpeg', disposition: 'inline' });
  }
}
