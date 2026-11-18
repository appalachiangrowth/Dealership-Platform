import { Body, Controller, Delete, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DealsService } from './deals.service.js';
import { pdfFile } from './deals.controller.js';
import { CurrentUser, PlatformOnly } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Platform Admin › Deal forms: the official fillable VSA 17A used by every dealership (a dealer's own upload wins). */
@Controller('platform/state-forms')
@PlatformOnly()
export class StateFormsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list() {
    return this.deals.templates(null);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  upload(@UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.deals.uploadTemplate(null, file, b || {}, u);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.deals.updateTemplate(null, id, b || {}, u);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.deals.removeTemplate(null, id, u);
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Query('sample') sample?: string): Promise<StreamableFile> {
    return pdfFile(await this.deals.templatePdf(null, id, undefined, undefined, sample === '1'), true);
  }
}
