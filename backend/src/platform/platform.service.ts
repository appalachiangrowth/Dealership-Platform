import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService, hashPassword, FEATURES } from '../tenants/tenants.service.js';
import { clean, isEmail, normDomain, VALID_TENANT_ID } from '../common/util.js';
import { publicUser } from '../team/team.service.js';
import type { Prisma, ReleaseChannel, TenantStatus } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';
import { forgetAuthCache } from '../common/auth.guard.js';

const page = (p?: string, size = 50) => {
  const n = Math.max(1, parseInt(p || '1', 10) || 1);
  return { skip: (n - 1) * size, take: size, page: n, pageSize: size };
};

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
  ) {}

  // ───────── Overview ─────────

  async overview() {
    const since7 = new Date(Date.now() - 7 * 86400_000);
    const since14 = new Date(Date.now() - 13 * 86400_000);
    since14.setHours(0, 0, 0, 0);
    const [tenants, vehicleStats, value, leads7, unread, users, recentLeads, leads14, pendingCg, pendingThemes, activity] = await Promise.all([
      this.prisma.tenant.findMany({ include: { domains: true, settings: { select: { name: true, phone: true, street: true, city: true, logo: true } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.vehicle.groupBy({ by: ['tenantId', 'status'], _count: true }),
      this.prisma.vehicle.aggregate({ where: { status: 'PUBLISHED' }, _sum: { price: true } }),
      this.prisma.lead.groupBy({ by: ['tenantId'], where: { createdAt: { gte: since7 } }, _count: true }),
      this.prisma.lead.groupBy({ by: ['tenantId'], where: { status: 'UNREAD' }, _count: true }),
      this.prisma.dealerUser.count({ where: { disabled: false } }),
      this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { tenant: { select: { id: true, name: true } } } }),
      this.prisma.lead.findMany({ where: { createdAt: { gte: since14 } }, select: { createdAt: true } }),
      this.prisma.cargurusSubmission.count({ where: { status: 'PENDING' } }),
      this.prisma.themeLicenseRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { tenant: { select: { name: true } } } }),
    ]);
    const vc = (tid: string, st: string) => vehicleStats.find((v) => v.tenantId === tid && v.status === st)?._count ?? 0;
    const l7 = Object.fromEntries(leads7.map((l) => [l.tenantId, l._count]));
    const un = Object.fromEntries(unread.map((l) => [l.tenantId, l._count]));
    const chart: { day: string; count: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since14.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      chart.push({ day: key, count: leads14.filter((l) => l.createdAt.toISOString().slice(0, 10) === key).length });
    }
    const fleet = tenants.map((t) => ({
      id: t.id,
      name: t.settings?.name || t.name,
      dealerCode: t.dealerCode,
      status: t.status,
      themeId: t.themeId,
      domain: t.domains.find((d) => d.isPrimary)?.domain ?? t.domains[0]?.domain ?? '',
      published: vc(t.id, 'PUBLISHED'),
      drafts: vc(t.id, 'DRAFT'),
      sold: vc(t.id, 'SOLD'),
      leads7: l7[t.id] || 0,
      unread: un[t.id] || 0,
      createdAt: t.createdAt,
    }));
    const attention: { tenantId: string; name: string; issue: string }[] = [];
    for (const t of tenants) {
      const nm = t.settings?.name || t.name;
      if (t.status === 'SUSPENDED') attention.push({ tenantId: t.id, name: nm, issue: 'Suspended' });
      if (!t.domains.length) attention.push({ tenantId: t.id, name: nm, issue: 'No domain connected' });
      if (!t.settings?.phone || !(t.settings?.street || t.settings?.city)) attention.push({ tenantId: t.id, name: nm, issue: 'Business details incomplete' });
      if ((un[t.id] || 0) >= 5) attention.push({ tenantId: t.id, name: nm, issue: `${un[t.id]} unread inquiries` });
    }
    return {
      kpis: {
        dealerships: tenants.length,
        active: tenants.filter((t) => t.status === 'ACTIVE').length,
        vehiclesForSale: vehicleStats.filter((v) => v.status === 'PUBLISHED').reduce((a, v) => a + v._count, 0),
        inventoryValue: Number(value._sum.price || 0),
        leads7: leads7.reduce((a, l) => a + l._count, 0),
        unread: unread.reduce((a, l) => a + l._count, 0),
        dealerLogins: users,
        pendingCargurus: pendingCg,
        pendingThemeRequests: pendingThemes,
      },
      fleet,
      chart,
      attention: attention.slice(0, 20),
      recentLeads,
      activity,
    };
  }

  // ───────── Dealerships ─────────

  async listTenants(q: { q?: string; status?: string }) {
    const term = clean(q.q, 80);
    const where: Prisma.TenantWhereInput = {};
    if (q.status === 'ACTIVE' || q.status === 'SUSPENDED') where.status = q.status;
    if (term)
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { id: { contains: term.toLowerCase() } },
        { dealerCode: { contains: term, mode: 'insensitive' } },
        { domains: { some: { domain: { contains: term.toLowerCase() } } } },
      ];
    const tenants = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { domains: true, _count: { select: { vehicles: true, leads: true, users: true } } },
    });
    return tenants;
  }

  async createTenant(b: Record<string, unknown>, user: AuthUser) {
    const admin = b.admin as Record<string, string> | undefined;
    const t = await this.tenants.create(
      {
        name: String(b.name || ''),
        id: b.id ? String(b.id) : undefined,
        domains: Array.isArray(b.domains) ? (b.domains as string[]) : String(b.domains || '').split(/[\s,]+/),
        themeId: b.themeId ? String(b.themeId) : undefined,
        notes: String(b.notes || ''),
        admin: admin?.login ? { login: admin.login, password: admin.password, name: admin.name, email: admin.email, source: 'PLATFORM' } : undefined,
      },
      user.login,
    );
    return t;
  }

  async inspect(id: string) {
    const t = await this.tenants.get(id);
    const [settings, users, counts, value, leads, licenses, requests, features, cgPending] = await Promise.all([
      this.tenants.settingsForAdmin(id),
      this.prisma.dealerUser.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.vehicle.groupBy({ by: ['status'], where: { tenantId: id }, _count: true }),
      this.prisma.vehicle.aggregate({ where: { tenantId: id, status: 'PUBLISHED' }, _sum: { price: true } }),
      this.prisma.lead.groupBy({ by: ['status'], where: { tenantId: id }, _count: true }),
      this.prisma.themeLicense.findMany({ where: { tenantId: id } }),
      this.prisma.themeLicenseRequest.findMany({ where: { tenantId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.tenants.features(t),
      this.prisma.cargurusSubmission.count({ where: { tenantId: id, status: 'PENDING' } }),
    ]);
    return {
      tenant: t,
      settings,
      users: users.map(publicUser),
      vehicles: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      inventoryValue: Number(value._sum.price || 0),
      leads: Object.fromEntries(leads.map((c) => [c.status, c._count])),
      licenses,
      requests,
      features,
      featureOverrides: t.features,
      cargurusPending: cgPending,
    };
  }

  async updateTenant(id: string, b: Record<string, unknown>, user: AuthUser) {
    const t = await this.tenants.get(id);
    const data: Prisma.TenantUpdateInput = {};
    if ('name' in b) data.name = clean(b.name, 120) || t.name;
    if ('status' in b) {
      const s = String(b.status).toUpperCase() as TenantStatus;
      if (s !== 'ACTIVE' && s !== 'SUSPENDED') throw new BadRequestException('Unknown status');
      data.status = s;
    }
    if ('themeId' in b) {
      const th = await this.prisma.theme.findUnique({ where: { id: String(b.themeId) } });
      if (!th) throw new BadRequestException('Unknown design');
      data.themeId = th.id;
    }
    if ('channel' in b) {
      const c = String(b.channel).toUpperCase() as ReleaseChannel;
      if (c !== 'STABLE' && c !== 'BETA') throw new BadRequestException('Unknown channel');
      data.channel = c;
    }
    if ('themePin' in b) data.themePin = clean(b.themePin, 20);
    if ('notes' in b) data.notes = clean(b.notes, 1000);
    if ('features' in b && b.features && typeof b.features === 'object') {
      const f: Record<string, boolean> = {};
      for (const k of FEATURES) {
        const v = (b.features as Record<string, unknown>)[k];
        if (typeof v === 'boolean') f[k] = v;
      }
      data.features = f;
    }
    if ('dealerCode' in b) {
      const code = clean(b.dealerCode, 30);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(code)) throw new BadRequestException('Dealer ID: 2-30 letters, digits, - or _');
      const taken = await this.prisma.tenant.findFirst({ where: { dealerCode: code, NOT: { id } } });
      if (taken) throw new ConflictException('That Dealer ID is used by another dealership');
      data.dealerCode = code;
    }
    if ('domains' in b) {
      const list = (Array.isArray(b.domains) ? (b.domains as string[]) : String(b.domains || '').split(/[\s,]+/)).map(normDomain).filter(Boolean);
      const uniq = [...new Set(list)];
      for (const d of uniq) {
        const used = await this.prisma.tenantDomain.findUnique({ where: { domain: d } });
        if (used && used.tenantId !== id) throw new ConflictException(`${d} belongs to another dealership`);
      }
      await this.prisma.$transaction([
        this.prisma.tenantDomain.deleteMany({ where: { tenantId: id } }),
        this.prisma.tenantDomain.createMany({ data: uniq.map((domain, i) => ({ tenantId: id, domain, isPrimary: i === 0 })) }),
      ]);
    }
    await this.prisma.tenant.update({ where: { id }, data });
    forgetAuthCache(); // e.g. a suspended dealership is locked out at once
    await this.audit.record('tenant.update', { tenantId: id, actor: user.login, detail: { fields: Object.keys(b) } });
    return this.inspect(id);
  }

  async deleteTenant(id: string, confirm: string, user: AuthUser) {
    const t = await this.tenants.get(id);
    if (confirm !== t.id) throw new BadRequestException(`Type the dealership id "${t.id}" to confirm`);
    await this.prisma.tenant.delete({ where: { id } });
    await this.audit.record('tenant.delete', { actor: user.login, detail: { id, name: t.name } });
    return { ok: true };
  }

  // ───────── Cross-dealer data (read-only) ─────────

  async inventory(q: { q?: string; tenantId?: string; status?: string; page?: string }) {
    const p = page(q.page, 50);
    const where: Prisma.VehicleWhereInput = {};
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.status && ['PUBLISHED', 'DRAFT', 'SOLD'].includes(q.status)) where.status = q.status as never;
    const term = clean(q.q, 80);
    if (term)
      where.OR = [
        { make: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
        { vin: { contains: term.toUpperCase() } },
        { stockNumber: { contains: term, mode: 'insensitive' } },
      ];
    const [items, total] = await Promise.all([
      this.prisma.vehicle.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: p.skip, take: p.take, include: { tenant: { select: { id: true, name: true } } } }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async leads(q: { q?: string; tenantId?: string; status?: string; page?: string }) {
    const p = page(q.page, 50);
    const where: Prisma.LeadWhereInput = {};
    if (q.tenantId) where.tenantId = q.tenantId;
    if (q.status && ['UNREAD', 'READ', 'REPLIED', 'CLOSED'].includes(q.status)) where.status = q.status as never;
    const term = clean(q.q, 80);
    if (term) where.OR = ['name', 'email', 'phone', 'message'].map((f) => ({ [f]: { contains: term, mode: 'insensitive' } }));
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: { tenant: { select: { id: true, name: true } }, vehicle: { select: { year: true, make: true, model: true } }, replies: true },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  // ───────── Dealer accounts ─────────

  async accounts(q: { filter?: string; q?: string }) {
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const since7 = new Date(Date.now() - 7 * 86400_000);
    const where: Prisma.DealerUserWhereInput = {};
    const term = clean(q.q, 80);
    if (term)
      where.OR = [
        { login: { contains: term.toLowerCase() } },
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term.toLowerCase() } },
        { phone: { contains: term } },
      ];
    if (q.filter === 'signup') where.source = 'SIGNUP';
    if (q.filter === 'disabled') where.disabled = true;
    if (q.filter === 'never') where.lastLoginAt = null;
    if (q.filter === 'active') where.lastLoginAt = { gte: since7 };
    const users = await this.prisma.dealerUser.findMany({ where, orderBy: { createdAt: 'desc' }, include: { tenant: { select: { id: true, name: true, status: true } } } });
    const ev = await this.prisma.loginEvent.groupBy({ by: ['userId', 'success'], where: { createdAt: { gte: since30 }, userId: { not: null } }, _count: true });
    const stat = (id: string, ok: boolean) => ev.find((e) => e.userId === id && e.success === ok)?._count ?? 0;
    let rows = users.map((u) => ({ ...publicUser(u), tenant: u.tenant, logins30: stat(u.id, true), failed30: stat(u.id, false) }));
    if (q.filter === 'failed') rows = rows.filter((r) => r.failed30 > 0);
    return rows;
  }

  async account(id: string) {
    const u = await this.prisma.dealerUser.findUnique({ where: { id }, include: { tenant: { select: { id: true, name: true } } } });
    if (!u) throw new NotFoundException('Account not found');
    const history = await this.prisma.loginEvent.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { ...publicUser(u), tenant: u.tenant, history };
  }

  async updateAccount(id: string, b: { disabled?: boolean; password?: string }, user: AuthUser) {
    const u = await this.prisma.dealerUser.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Account not found');
    const data: Prisma.DealerUserUpdateInput = {};
    if (typeof b.disabled === 'boolean') data.disabled = b.disabled;
    if (b.password) {
      if (b.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
      data.passwordHash = await hashPassword(b.password);
    }
    await this.prisma.dealerUser.update({ where: { id }, data });
    forgetAuthCache();
    await this.audit.record('account.update', { tenantId: u.tenantId, actor: user.login, detail: { login: u.login, disabled: b.disabled, password: !!b.password } });
    return this.account(id);
  }

  // ───────── Platform owners ─────────

  async owners() {
    const list = await this.prisma.platformOwner.findMany({ orderBy: { createdAt: 'asc' } });
    return list.map(({ passwordHash: _p, ...o }) => o);
  }

  async createOwner(b: { login?: string; name?: string; email?: string; password?: string }, user: AuthUser) {
    const login = clean(b.login, 120).toLowerCase();
    if (!/^[a-z0-9._@+-]{3,120}$/.test(login)) throw new BadRequestException('Login: 3-120 characters');
    if ((b.password || '').length < 8) throw new BadRequestException('Password must be at least 8 characters');
    if (await this.prisma.platformOwner.findUnique({ where: { login } })) throw new ConflictException('That login exists');
    const email = clean(b.email, 160).toLowerCase();
    await this.prisma.platformOwner.create({
      data: { login, name: clean(b.name, 120), email: isEmail(email) ? email : '', passwordHash: await hashPassword(b.password!) },
    });
    await this.audit.record('owner.create', { actor: user.login, detail: { login } });
    return this.owners();
  }

  async updateOwner(id: string, b: { name?: string; email?: string; password?: string; disabled?: boolean }, user: AuthUser) {
    const o = await this.prisma.platformOwner.findUnique({ where: { id } });
    if (!o) throw new NotFoundException('Owner not found');
    const data: Prisma.PlatformOwnerUpdateInput = {};
    if (b.name !== undefined) data.name = clean(b.name, 120);
    if (b.email !== undefined) data.email = clean(b.email, 160).toLowerCase();
    if (b.password) {
      if (b.password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
      data.passwordHash = await hashPassword(b.password);
    }
    if (typeof b.disabled === 'boolean') {
      if (id === user.id) throw new ForbiddenException('You cannot disable yourself');
      data.disabled = b.disabled;
    }
    await this.prisma.platformOwner.update({ where: { id }, data });
    forgetAuthCache();
    await this.audit.record('owner.update', { actor: user.login, detail: { login: o.login } });
    return this.owners();
  }

  async deleteOwner(id: string, user: AuthUser) {
    if (id === user.id) throw new ForbiddenException('You cannot delete yourself');
    if ((await this.prisma.platformOwner.count({ where: { disabled: false } })) <= 1) throw new BadRequestException('At least one owner must remain');
    await this.prisma.platformOwner.delete({ where: { id } });
    forgetAuthCache();
    await this.audit.record('owner.delete', { actor: user.login, detail: { id } });
    return this.owners();
  }

  // ───────── Activity / system ─────────

  async activity(q: { tenantId?: string; action?: string; page?: string }) {
    const p = page(q.page, 100);
    const where: Prisma.AuditLogWhereInput = {};
    if (q.tenantId) where.tenantId = q.tenantId === 'platform' ? null : q.tenantId;
    if (q.action) where.action = { startsWith: clean(q.action, 60) };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take, include: { tenant: { select: { name: true } } } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: p.page, pageSize: p.pageSize };
  }

  async system() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const [tenants, vehicles, leads, media, posts] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.vehicle.count(),
      this.prisma.lead.count(),
      this.prisma.mediaFile.aggregate({ _sum: { size: true }, _count: true }),
      this.prisma.blogPost.count(),
    ]);
    return {
      version: '4.0.0',
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      database: { ok: true, latencyMs: Date.now() - started },
      counts: { tenants, vehicles, leads, posts, mediaFiles: media._count, mediaBytes: media._sum.size || 0 },
      cargurusCronHour: process.env.CARGURUS_CRON_HOUR ?? '',
    };
  }

  /** Quick dealership picker for the Platform Admin top bar. */
  async jump(q: string) {
    const term = clean(q, 60);
    if (!term) return [];
    const list = await this.listTenants({ q: term });
    return list.slice(0, 10).map((t) => ({ id: t.id, name: t.name, domain: t.domains[0]?.domain ?? '' }));
  }

  validId(id: string) {
    return VALID_TENANT_ID.test(id);
  }
}
