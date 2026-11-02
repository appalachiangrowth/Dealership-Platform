import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { LeadsService } from './leads.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

@Controller('dealer/leads')
@Perms('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@TenantId() t: string, @Query() q: { status?: string; q?: string; page?: string; pageSize?: string }) {
    return this.leads.list(t, q);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="inquiries.csv"')
  export(@TenantId() t: string) {
    return this.leads.exportCsv(t);
  }

  @Get('email')
  email(@TenantId() t: string) {
    return this.leads.leadEmail(t);
  }

  @Put('email')
  setEmail(@TenantId() t: string, @Body() b: { leadTo?: string }, @CurrentUser() u: AuthUser) {
    return this.leads.setLeadEmail(t, b, u);
  }

  @Post('email/test')
  test(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.leads.testEmail(t, u);
  }

  @Get(':id')
  get(@TenantId() t: string, @Param('id') id: string) {
    return this.leads.get(t, id);
  }

  @Patch(':id')
  update(@TenantId() t: string, @Param('id') id: string, @Body() b: { status?: string; notes?: string }, @CurrentUser() u: AuthUser) {
    return this.leads.update(t, id, b, u);
  }

  @Post(':id/reply')
  reply(@TenantId() t: string, @Param('id') id: string, @Body() b: { body?: string }, @CurrentUser() u: AuthUser) {
    return this.leads.reply(t, id, b, u);
  }

  @Delete(':id')
  remove(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.leads.remove(t, id, u);
  }
}
