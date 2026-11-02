import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CargurusService } from './cargurus.service.js';
import { FeedsService } from '../feeds/feeds.service.js';
import { CurrentUser, Perms, PlatformOnly, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Dealership Portal › Inventory › Feeds & CarGurus */
@Controller('dealer/feeds')
@Perms('inventory')
export class DealerFeedsController {
  constructor(private readonly cg: CargurusService, private readonly feeds: FeedsService) {}

  @Get('status')
  status(@TenantId() t: string) {
    return this.feeds.status(t);
  }

  @Get('inventory.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async xml(@TenantId() t: string) {
    return (await this.feeds.xml(t)).xml;
  }

  @Get('cargurus-inventory.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cargurus-inventory.csv"')
  async cgCsv(@TenantId() t: string) {
    return (await this.feeds.cargurusFromInventory(t)).csv;
  }

  @Get('cargurus/template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cargurus-template.csv"')
  template() {
    return this.cg.template();
  }

  @Get('cargurus')
  list(@TenantId() t: string) {
    return this.cg.listForDealer(t);
  }

  @Get('cargurus/:id')
  get(@TenantId() t: string, @Param('id') id: string) {
    return this.cg.getForDealer(t, id);
  }

  /** multipart "file" (CSV / TSV / TXT) */
  @Post('cargurus/upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(@TenantId() t: string, @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @CurrentUser() u: AuthUser) {
    if (!file) throw new BadRequestException('Choose a CSV, TSV or TXT file');
    return this.cg.upload(t, file.buffer.toString('utf8'), file.originalname, u);
  }

  @Post('cargurus/submit-inventory')
  submitInventory(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.cg.submitInventory(t, u);
  }
}

/** Platform Admin › CarGurus Feeds & Ingestion Audit */
@Controller('platform/cargurus')
@PlatformOnly()
export class PlatformCargurusController {
  constructor(private readonly cg: CargurusService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.cg.listAll(status);
  }

  @Post('run-all')
  runAll() {
    return this.cg.runAll();
  }

  @Get(':tenantId/logs')
  logs(@Param('tenantId') t: string) {
    return this.cg.logs(t);
  }

  @Get(':tenantId/:id')
  audit(@Param('tenantId') t: string, @Param('id') id: string) {
    return this.cg.audit_(t, id);
  }

  @Get(':tenantId/:id/master.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="cargurus-master.csv"')
  master(@Param('tenantId') t: string, @Param('id') id: string) {
    return this.cg.masterCsv(t, id);
  }

  @Post(':tenantId/:id/approve')
  approve(@Param('tenantId') t: string, @Param('id') id: string, @Body() b: { includeInvalid?: boolean; note?: string }, @CurrentUser() u: AuthUser) {
    return this.cg.approve(t, id, b, u);
  }

  @Post(':tenantId/:id/reject')
  reject(@Param('tenantId') t: string, @Param('id') id: string, @Body() b: { note?: string }, @CurrentUser() u: AuthUser) {
    return this.cg.reject(t, id, b, u);
  }

  @Post(':tenantId/resend')
  resend(@Param('tenantId') t: string, @CurrentUser() u: AuthUser) {
    return this.cg.resend(t, u);
  }
}
