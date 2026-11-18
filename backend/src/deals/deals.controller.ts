import { Body, Controller, Delete, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DealsService } from './deals.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

export const pdfFile = (f: { bytes: Uint8Array; name: string }, inline = false) =>
  new StreamableFile(Buffer.from(f.bytes), {
    type: 'application/pdf',
    disposition: `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
  });

const PDF_UPLOAD = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/** Deals / Bill of Sale: the Sell Car form, the license scanner and the 4 deal forms. */
@Controller('dealer/deals')
@Perms('inventory')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  list(@TenantId() t: string, @Query() q: { status?: string; search?: string; vehicleId?: string }) {
    return this.deals.list(t, q || {});
  }

  /** a new deal pre-filled from ?vehicleId= and the dealership's deal defaults (not saved) */
  @Get('new')
  prefill(@TenantId() t: string, @Query('vehicleId') vehicleId?: string) {
    return this.deals.prefill(t, vehicleId);
  }

  /** official fillable forms: this dealership's uploads + the platform's copy */
  @Get('form-templates')
  templates(@TenantId() t: string) {
    return this.deals.templates(t);
  }

  @Post('form-templates')
  @Perms('business')
  @UseInterceptors(PDF_UPLOAD)
  upload(@TenantId() t: string, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.deals.uploadTemplate(t, file, b || {}, u);
  }

  @Patch('form-templates/:id')
  @Perms('business')
  updateTemplate(@TenantId() t: string, @Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.deals.updateTemplate(t, id, b || {}, u);
  }

  @Delete('form-templates/:id')
  @Perms('business')
  removeTemplate(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.deals.removeTemplate(t, id, u);
  }

  @Get('form-templates/:id/pdf')
  async templatePdf(@TenantId() t: string, @Param('id') id: string, @Query('dealId') dealId?: string, @Query('sample') sample?: string) {
    return pdfFile(await this.deals.templatePdf(t, id, dealId ? t : undefined, dealId, sample === '1'), true);
  }

  /** front photo of the license → buyer fields (AI); the barcode is read in the browser */
  @Post('read-license')
  readLicense(@TenantId() t: string, @Body() b: Record<string, unknown>) {
    return this.deals.readLicense(t, b || {});
  }

  @Get(':id')
  get(@TenantId() t: string, @Param('id') id: string) {
    return this.deals.get(t, id);
  }

  @Post()
  create(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.deals.create(t, b || {}, u);
  }

  @Patch(':id')
  update(@TenantId() t: string, @Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.deals.update(t, id, b || {}, u);
  }

  @Delete(':id')
  remove(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.deals.remove(t, id, u);
  }

  /** "Generate Deal Forms": COMPLETED (+ vehicle SOLD when markSold) */
  @Post(':id/complete')
  complete(@TenantId() t: string, @Param('id') id: string, @Body() b: { markSold?: boolean }, @CurrentUser() u: AuthUser) {
    return this.deals.complete(t, id, b || {}, u);
  }

  /** :form = bill-of-sale | odometer | buyers-guide | vsa17a | packet */
  @Get(':id/pdf/:form')
  async pdf(@TenantId() t: string, @Param('id') id: string, @Param('form') form: string, @Query('inline') inline?: string) {
    return pdfFile(await this.deals.pdf(t, id, form), inline === '1');
  }
}
