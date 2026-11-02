import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PlatformService } from './platform.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, PlatformOnly } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Platform Admin (platform owners only). Dealer-level actions use the /dealer/* endpoints with X-Tenant-Id. */
@Controller('platform')
@PlatformOnly()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('jump')
  jump(@Query('q') q: string) {
    return this.platform.jump(q);
  }

  @Get('tenants')
  tenants(@Query() q: { q?: string; status?: string }) {
    return this.platform.listTenants(q);
  }

  @Post('tenants')
  createTenant(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.platform.createTenant(b, u);
  }

  @Get('tenants/:id')
  inspect(@Param('id') id: string) {
    return this.platform.inspect(id);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.platform.updateTenant(id, b, u);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string, @Query('confirm') confirm: string, @CurrentUser() u: AuthUser) {
    return this.platform.deleteTenant(id, confirm, u);
  }

  @Get('inventory')
  inventory(@Query() q: { q?: string; tenantId?: string; status?: string; page?: string }) {
    return this.platform.inventory(q);
  }

  @Get('leads')
  leads(@Query() q: { q?: string; tenantId?: string; status?: string; page?: string }) {
    return this.platform.leads(q);
  }

  @Get('accounts')
  accounts(@Query() q: { filter?: string; q?: string }) {
    return this.platform.accounts(q);
  }

  @Get('accounts/:id')
  account(@Param('id') id: string) {
    return this.platform.account(id);
  }

  @Patch('accounts/:id')
  updateAccount(@Param('id') id: string, @Body() b: { disabled?: boolean; password?: string }, @CurrentUser() u: AuthUser) {
    return this.platform.updateAccount(id, b, u);
  }

  @Get('owners')
  owners() {
    return this.platform.owners();
  }

  @Post('owners')
  createOwner(@Body() b: { login?: string; name?: string; email?: string; password?: string }, @CurrentUser() u: AuthUser) {
    return this.platform.createOwner(b, u);
  }

  @Patch('owners/:id')
  updateOwner(@Param('id') id: string, @Body() b: { name?: string; email?: string; password?: string; disabled?: boolean }, @CurrentUser() u: AuthUser) {
    return this.platform.updateOwner(id, b, u);
  }

  @Delete('owners/:id')
  deleteOwner(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.platform.deleteOwner(id, u);
  }

  @Get('activity')
  activity(@Query() q: { tenantId?: string; action?: string; page?: string }) {
    return this.platform.activity(q);
  }

  @Get('settings')
  getSettings() {
    return this.settings.publicView();
  }

  @Put('settings')
  async saveSettings(@Body() b: Record<string, Record<string, unknown>>, @CurrentUser() u: AuthUser) {
    const out = await this.settings.save(b);
    await this.audit.record('platform.settings', { actor: u.login, detail: { groups: Object.keys(b || {}) } });
    return out;
  }

  @Get('system')
  system() {
    return this.platform.system();
  }
}
