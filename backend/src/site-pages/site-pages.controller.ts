import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SitePagesService } from './site-pages.service.js';
import { CurrentUser, PlatformOnly, Public } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Platform Admin › Pages & SEO */
@Controller('platform/pages')
@PlatformOnly()
export class SitePagesController {
  constructor(private readonly pages: SitePagesService) {}

  /** ?tenantId=<dealership> (its pages + pages for every dealership) | all (only pages for every dealership) */
  @Get()
  list(@Query() q: { tenantId?: string; q?: string }) {
    return this.pages.list(q);
  }

  @Post()
  create(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.pages.create(b, u);
  }

  /** pictures used in sections */
  @Post('media')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } }))
  media(@UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined, @CurrentUser() u: AuthUser) {
    if (!file) throw new BadRequestException('No file');
    return this.pages.saveImage(file, u);
  }

  /** Header menu: ?scope=<dealership id> | all */
  @Get('menu')
  menu(@Query('scope') scope: string) {
    return this.pages.getMenu(scope);
  }

  /** { scope, items: [{ id, type: page | group | link, slug?, url?, label, hidden, children? }] } */
  @Put('menu')
  saveMenu(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.pages.saveMenu(b, u);
  }

  /** a dealership goes back to the menu for every dealership; "all" goes back to the automatic menu */
  @Delete('menu')
  resetMenu(@Query('scope') scope: string, @CurrentUser() u: AuthUser) {
    return this.pages.resetMenu(scope, u);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.pages.get(id);
  }

  /** { title, slug, tenantId, sections, seo, showInNav, navLabel, navOrder } — saves the working copy */
  @Patch(':id')
  update(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.pages.update(id, b, u);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.pages.publish(id, u);
  }

  @Post(':id/unpublish')
  unpublish(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.pages.unpublish(id, u);
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.pages.discard(id, u);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.pages.duplicate(id, b, u);
  }

  /** a link that shows the unpublished working copy on a dealership's website (3 hours) */
  @Post(':id/preview-token')
  previewToken(@Param('id') id: string) {
    return this.pages.previewToken(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.pages.remove(id, u);
  }
}

/** The dealer websites (frontend) ask for a custom page by its address. */
@Controller('public/pages')
@Public()
export class PublicPagesController {
  constructor(private readonly pages: SitePagesService) {}

  @Get(':slug')
  page(@Param('slug') slug: string, @Query('host') host: string, @Headers('x-site-host') h: string, @Query('preview') preview?: string) {
    return this.pages.publicPage(host || h || '', slug, preview);
  }
}
