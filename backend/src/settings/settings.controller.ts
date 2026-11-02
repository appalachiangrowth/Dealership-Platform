import { BadRequestException, Body, Controller, ForbiddenException, Get, Patch } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import { cleanSettingsPatch } from '../tenants/settings.fields.js';
import type { AuthUser } from '../common/auth.types.js';

/**
 * Business details (permission "business") and Email & advanced settings (permission "settings").
 * Secrets (SMTP / FTP password, feed key) are write-only: the API answers { set: true|false }.
 */
@Controller('dealer/settings')
@Perms('business', 'settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@TenantId() tenantId: string) {
    const t = await this.tenants.get(tenantId);
    return {
      settings: await this.tenants.settingsForAdmin(tenantId),
      tenant: { id: t.id, name: t.name, dealerCode: t.dealerCode, domains: t.domains.map((d) => d.domain), status: t.status },
    };
  }

  @Patch()
  async save(@TenantId() tenantId: string, @Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    const { data, denied, invalid } = cleanSettingsPatch(body, {
      business: user.perms.includes('business'),
      settings: user.perms.includes('settings'),
    });
    if (denied.length) throw new ForbiddenException(`You may not change: ${denied.join(', ')}`);
    if (invalid.length) throw new BadRequestException({ message: 'Please check these fields', fields: invalid });
    const s = await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    if (typeof data.name === 'string' && data.name) await this.prisma.tenant.update({ where: { id: tenantId }, data: { name: data.name } });
    if (s.name && s.phone && (s.street || s.city)) await this.tenants.setOnboarding(tenantId, 'business_done');
    await this.audit.record('settings.save', { tenantId, actor: user.login, detail: { keys: Object.keys(data) } });
    return this.get(tenantId);
  }
}
