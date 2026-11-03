import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { clean, cleanMl, isColor, num, rateLimit } from '../common/util.js';
import type { BillingCycle, Theme } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';
import { installedVersions } from './theme-installer.service.js';

export const CURRENCIES = ['USD', 'PKR', 'CAD', 'GBP', 'EUR', 'AED'];
const BILLING: BillingCycle[] = ['ONE_TIME', 'MONTHLY', 'YEARLY'];

export function priceLabel(t: { paid: boolean; price: unknown; currency: string; billing: BillingCycle }) {
  if (!t.paid) return 'Free';
  const p = Number(t.price);
  const per = t.billing === 'MONTHLY' ? ' / month' : t.billing === 'YEARLY' ? ' / year' : '';
  return `${t.currency} ${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}${per}`;
}

@Injectable()
export class ThemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
    private readonly platform: PlatformSettingsService,
  ) {}

  async access(tenantId: string, theme: Theme, activeThemeId: string) {
    const [license, pending] = await Promise.all([
      this.prisma.themeLicense.findUnique({ where: { tenantId_themeId: { tenantId, themeId: theme.id } } }),
      this.prisma.themeLicenseRequest.findFirst({ where: { tenantId, themeId: theme.id, status: 'PENDING' } }),
    ]);
    const unlocked = !!license;
    return {
      paid: theme.paid,
      price: Number(theme.price),
      currency: theme.currency,
      billing: theme.billing,
      label: priceLabel(theme),
      unlocked,
      requested: pending?.id ?? '',
      allowed: !theme.paid || unlocked || theme.id === activeThemeId,
    };
  }

  /** Design & colours screen for a dealership. */
  async dealerView(tenantId: string) {
    const t = await this.tenants.get(tenantId);
    const current = await this.tenants.themeFor(t);
    const themes = await this.prisma.theme.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const catalog = [];
    for (const th of themes) {
      catalog.push({
        id: th.id,
        name: th.name,
        description: th.description,
        style: th.style,
        previewUrl: th.previewUrl,
        version: th.stableVersion,
        active: th.id === t.themeId,
        access: await this.access(tenantId, th, t.themeId),
      });
    }
    return {
      current: { themeId: current.id, name: current.name, version: current.version, channel: t.channel, pinned: !!t.themePin },
      colors: { slots: current.colorSlots, values: await this.tenants.colorsFor(tenantId, current.id) },
      catalog,
      paymentInstructions: String(await this.platform.get('payment', 'instructions', '')),
    };
  }

  async activate(tenantId: string, themeId: string, user: AuthUser) {
    const t = await this.tenants.get(tenantId);
    const theme = await this.prisma.theme.findUnique({ where: { id: themeId } });
    if (!theme || !theme.enabled) throw new NotFoundException('Design not found');
    const acc = await this.access(tenantId, theme, t.themeId);
    if (!acc.allowed && user.kind !== 'owner') throw new ForbiddenException(`This design costs ${acc.label}. Request it first.`);
    if (t.themeId !== themeId) {
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { themeId, themePin: '' } });
      await this.audit.record('theme.activate', { tenantId, actor: user.login, detail: { theme: themeId } });
    }
    await this.tenants.setOnboarding(tenantId, 'theme_chosen');
    return this.dealerView(tenantId);
  }

  async saveColors(tenantId: string, body: { colors?: Record<string, string>; themeId?: string }, user: AuthUser) {
    const t = await this.tenants.get(tenantId);
    const themeId = body.themeId || t.themeId;
    const theme = await this.prisma.theme.findUnique({ where: { id: themeId } });
    if (!theme) throw new NotFoundException('Design not found');
    const slots = theme.colorSlots as { key: string }[];
    const colors: Record<string, string> = {};
    for (const s of slots) {
      const v = body.colors?.[s.key];
      if (v && isColor(v)) colors[s.key] = v.toUpperCase();
    }
    await this.prisma.designColors.upsert({
      where: { tenantId_themeId: { tenantId, themeId } },
      create: { tenantId, themeId, colors },
      update: { colors },
    });
    await this.audit.record('design.colors', { tenantId, actor: user.login, detail: { theme: themeId, colors } });
    return this.dealerView(tenantId);
  }

  async request(tenantId: string, body: { themeId?: string; note?: string }, user: AuthUser) {
    const t = await this.tenants.get(tenantId);
    const theme = await this.prisma.theme.findUnique({ where: { id: String(body.themeId) } });
    if (!theme) throw new NotFoundException('Design not found');
    const acc = await this.access(tenantId, theme, t.themeId);
    if (!acc.paid || acc.unlocked) throw new BadRequestException('This design is already available to you.');
    if (acc.requested) throw new ConflictException('You already requested this design. It will be unlocked once your payment is confirmed.');
    if (!rateLimit(`theme-request|${tenantId}`, 10, 3600)) throw new BadRequestException('Too many requests');
    const req = await this.prisma.themeLicenseRequest.create({
      data: {
        tenantId,
        themeId: theme.id,
        requestedBy: user.login,
        requestedByName: user.name,
        note: cleanMl(body.note, 1000),
        price: theme.price,
        currency: theme.currency,
        billing: theme.billing,
      },
    });
    await this.audit.record('theme.request', { tenantId, actor: user.login, detail: { theme: theme.id, price: acc.label } });
    return req;
  }

  // ───────── Platform Admin ─────────

  async platformList() {
    const themes = await this.prisma.theme.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { versions: { orderBy: { releasedAt: 'desc' } } } });
    const usage = await this.prisma.tenant.groupBy({ by: ['themeId'], _count: true });
    const used = Object.fromEntries(usage.map((u) => [u.themeId, u._count]));
    const licenses = await this.prisma.themeLicense.groupBy({ by: ['themeId'], _count: true });
    const lic = Object.fromEntries(licenses.map((u) => [u.themeId, u._count]));
    return {
      themes: themes.map((t) => ({ ...t, price: Number(t.price), priceLabel: priceLabel(t), dealers: used[t.id] || 0, licenses: lic[t.id] || 0, installed: installedVersions(t.id) })),
      currencies: CURRENCIES,
      paymentInstructions: String(await this.platform.get('payment', 'instructions', '')),
    };
  }

  async platformUpdate(id: string, b: Record<string, unknown>, user: AuthUser) {
    const theme = await this.prisma.theme.findUnique({ where: { id }, include: { versions: true } });
    if (!theme) throw new NotFoundException('Design not found');
    const data: Record<string, unknown> = {};
    if ('paid' in b) data.paid = !!b.paid;
    if ('price' in b) data.price = Math.max(0, num(b.price) ?? 0);
    if ('currency' in b && CURRENCIES.includes(String(b.currency))) data.currency = String(b.currency);
    if ('billing' in b && BILLING.includes(String(b.billing) as BillingCycle)) data.billing = String(b.billing);
    if ('priceNote' in b) data.priceNote = clean(b.priceNote, 300);
    if ('enabled' in b) data.enabled = !!b.enabled;
    if ('name' in b) data.name = clean(b.name, 60) || theme.name;
    if ('description' in b) data.description = clean(b.description, 400);
    const versions = theme.versions.map((v) => v.version);
    for (const k of ['stableVersion', 'betaVersion'] as const) {
      if (k in b) {
        const v = clean(b[k], 20);
        if (v && !versions.includes(v)) throw new BadRequestException(`Version ${v} is not released for this design`);
        if (k === 'stableVersion' && !v) continue;
        data[k] = v;
      }
    }
    await this.prisma.theme.update({ where: { id }, data });
    await this.audit.record('theme.update', { actor: user.login, detail: { theme: id, ...data } });
    return this.platformList();
  }

  async addVersion(id: string, b: { version?: string; notes?: string }, user: AuthUser) {
    const version = clean(b.version, 20);
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new BadRequestException('Version must look like 1.2.0');
    await this.prisma.themeVersion.create({ data: { themeId: id, version, notes: cleanMl(b.notes, 2000) } });
    await this.audit.record('theme.release', { actor: user.login, detail: { theme: id, version } });
    return this.platformList();
  }

  listRequests(status?: string) {
    const s = (status || '').toUpperCase();
    return this.prisma.themeLicenseRequest.findMany({
      where: s === 'PENDING' || s === 'PAID' || s === 'DECLINED' ? { status: s } : {},
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { id: true, name: true, dealerCode: true } }, theme: { select: { id: true, name: true } } },
      take: 500,
    });
  }

  async reviewRequest(id: string, action: 'approve' | 'decline', b: { amount?: unknown; note?: string }, user: AuthUser) {
    const r = await this.prisma.themeLicenseRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'PENDING') throw new BadRequestException('This request was already handled');
    const note = cleanMl(b.note, 1000);
    if (action === 'decline') {
      await this.prisma.themeLicenseRequest.update({ where: { id }, data: { status: 'DECLINED', reviewedBy: user.login, reviewNote: note, reviewedAt: new Date() } });
    } else {
      const amount = num(b.amount) ?? Number(r.price);
      await this.prisma.$transaction([
        this.prisma.themeLicenseRequest.update({
          where: { id },
          data: { status: 'PAID', reviewedBy: user.login, reviewNote: note, reviewedAt: new Date(), amountPaid: amount },
        }),
        this.prisma.themeLicense.upsert({
          where: { tenantId_themeId: { tenantId: r.tenantId, themeId: r.themeId } },
          create: { tenantId: r.tenantId, themeId: r.themeId, amount, currency: r.currency, billing: r.billing, note, grantedBy: user.login, requestId: id },
          update: { amount, note, grantedBy: user.login, requestId: id },
        }),
      ]);
    }
    await this.audit.record(`theme.request.${action}`, { tenantId: r.tenantId, actor: user.login, detail: { theme: r.themeId } });
    return this.listRequests();
  }

  async grant(tenantId: string, themeId: string, user: AuthUser) {
    await this.tenants.get(tenantId);
    await this.prisma.themeLicense.upsert({
      where: { tenantId_themeId: { tenantId, themeId } },
      create: { tenantId, themeId, grantedBy: user.login, note: 'Unlocked by the platform' },
      update: {},
    });
    await this.audit.record('theme.grant', { tenantId, actor: user.login, detail: { theme: themeId } });
    return { ok: true };
  }

  async revoke(tenantId: string, themeId: string, user: AuthUser) {
    await this.prisma.themeLicense.deleteMany({ where: { tenantId, themeId } });
    await this.audit.record('theme.revoke', { tenantId, actor: user.login, detail: { theme: themeId } });
    return { ok: true };
  }
}
