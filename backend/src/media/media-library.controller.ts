import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MediaLibraryService } from './media-library.service.js';
import { CurrentUser, PlatformOnly } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Platform Admin › SEO & URLs › Images (platform owners only): one dealership's media library. */
@Controller(['platform/media', 'admin/media'])
@PlatformOnly()
export class MediaLibraryController {
  constructor(private readonly library: MediaLibraryService) {}

  /** GET /platform/media/:dealerId?type=image|video&q=&page=&pageSize= → { items, total, page, pageSize, counts } */
  @Get(':dealerId')
  list(@Param('dealerId') dealerId: string, @Query() q: { type?: string; q?: string; page?: string; pageSize?: string }) {
    return this.library.list(dealerId, q);
  }

  /** POST /platform/media/:dealerId (multipart "files", up to 20): pictures and videos → { files, errors } */
  @Post(':dealerId')
  @UseInterceptors(FilesInterceptor('files', 20, { storage: memoryStorage(), limits: { fileSize: 150 * 1024 * 1024 } }))
  upload(@Param('dealerId') dealerId: string, @UploadedFiles() files: { buffer: Buffer; originalname: string; size: number }[], @CurrentUser() u: AuthUser) {
    return this.library.upload(dealerId, files, u);
  }

  /** PATCH /platform/media/:dealerId/:id { altText, title, caption, description } */
  @Patch(':dealerId/:id')
  update(@Param('dealerId') dealerId: string, @Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.library.update(dealerId, id, b, u);
  }
}
