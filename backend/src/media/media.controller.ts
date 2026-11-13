import { Controller, Delete, Get, Param, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MediaService } from './media.service.js';
import { VehiclePhotoEnhancerService } from './photo-enhancer.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Photos for vehicles, blog posts, logo and website images. */
@Controller('dealer/media')
@Perms('inventory', 'blog', 'business', 'content', 'design')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly enhancer: VehiclePhotoEnhancerService,
  ) {}

  /** GET /dealer/media/enhancer — is "Auto White Studio Background" installed on this server? */
  @Get('enhancer')
  async enhancerStatus() {
    const st = await this.enhancer.status();
    return { available: st.available, reason: st.reason || '' };
  }

  /**
   * POST /dealer/media (multipart, field "files", up to 30 photos). ?folder=site for logo/website images.
   * ?enhance=1 for vehicle photos: Auto White Studio Background (each file says enhanced true / false).
   */
  @Post()
  @UseInterceptors(FilesInterceptor('files', 30, { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @TenantId() t: string,
    @UploadedFiles() files: { buffer: Buffer; originalname: string; size: number }[],
    @CurrentUser() u: AuthUser,
    @Query('folder') folder?: string,
    @Query('enhance') enhance?: string,
  ) {
    const opts = { enhance: /^(1|true|yes|on)$/i.test(enhance || '') && folder !== 'site' };
    const out = [];
    const errors = [];
    for (const f of files || []) {
      try {
        out.push(await this.media.save(t, f, u, folder, opts));
      } catch (e) {
        errors.push({ file: f.originalname, error: (e as Error).message });
      }
    }
    return { files: out, errors };
  }

  @Get()
  list(@TenantId() t: string) {
    return this.media.list(t);
  }

  @Delete(':id')
  remove(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.media.remove(t, id, u);
  }
}
