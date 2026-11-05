import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { clean, isEmail, normDomain, slugify, VALID_TENANT_ID } from '../common/util.js';
import { SECRET_FIELDS } from './settings.fields.js';
import { BUILTIN_THEMES } from '../themes/themes.registry.js';
import type { AccountSource, DealerRole, Prisma, Tenant } from '../generated/prisma/client.js';

export interface CreateTenantInput {
  name: string;
  id?: string;
  domains?: string[];
  themeId?: string;
  notes?: string;
  admin?: { login: string; password: string; name?: string; email?: string; phone?: string; source?: AccountSource; signupIp?: string };
}

export const FEATURES = ['facebook', 'cargurus', 'blog'] as const;

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

/** Old PHP hashes start with $2y$ — bcryptjs reads them as $2b$ (same algorithm). */
export function checkPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash.replace(/^\$2y\$/, '$2b$'));
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformSettingsService,
    private readonly audit: AuditService,
  ) {}

  async nextDealerCode(tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const c = await tx.counter.upsert({
        where: { name: 'dealer_code' },
        create: { name: 'dealer_code', value: 1001 },
        update: { value: { increment: 1 } },
      });
      const code = `AGS-${c.value}`;
      const taken = await tx.tenant.findUnique({ where: { dealerCode: code }, select: { id: true } });
      if (!taken) return code;
    }
    throw new ConflictException('Could not allocate a dealer code');
  }

  async uniqueId(base: string): Promise<string> {
    let id = slugify(base, 36);
    if (!VALID_TENANT_ID.test(id)) id = 'dealer-' + id;
    let n = 1;
    let cand = id;
    while (await this.prisma.tenant.findUnique({ where: { id: cand }, select: { id: true } })) {
      n++;
      cand = `${id}-${n}`;
    }
    return cand;
  }

  async create(input: CreateTenantInput, actor = '') {
    const name = clean(input.name, 120);
    if (!name) throw new BadRequestException('Dealership name is required');
    const id = input.id ? clean(input.id, 40).toLowerCase() : await this.uniqueId(name);
    if (!VALID_TENANT_ID.test(id)) throw new BadRequestException('Dealership id: 2-40 lower-case letters, digits and dashes');
    if (await this.prisma.tenant.findUnique({ where: { id } })) throw new ConflictException('That dealership id is taken');

    const domains = [...new Set((input.domains || []).map(normDomain).filter(Boolean))];
    for (const d of domains) {
      const used = await this.prisma.tenantDomain.findUnique({ where: { domain: d } });
      if (used) throw new ConflictException(`The domain ${d} already belongs to another dealership`);
    }
    const themeId = input.themeId && BUILTIN_THEMES.some((t) => t.id === input.themeId) ? input.themeId : 'classic';

    let adminData: Prisma.DealerUserCreateWithoutTenantInput | undefined;
    if (input.admin) {
      const login = clean(input.admin.login, 120).toLowerCase();
      if (!/^[a-z0-9._@+-]{3,120}$/.test(login)) throw new BadRequestException('Login: 3-120 characters (letters, digits, . _ @ + -)');
      if ((input.admin.password || '').length < 8) throw new BadRequestException('Password must be at least 8 characters');
      adminData = {
        login,
        name: clean(input.admin.name, 120),
        email: isEmail(clean(input.admin.email, 160)) ? clean(input.admin.email, 160).toLowerCase() : isEmail(login) ? login : '',
        phone: clean(input.admin.phone, 40),
        role: 'ADMIN' as DealerRole,
        passwordHash: await hashPassword(input.admin.password),
        source: input.admin.source || 'PLATFORM',
        signupIp: input.admin.signupIp || '',
      };
    }

    const tenant = await this.prisma.$transaction(async (tx) => {
      const dealerCode = await this.nextDealerCode(tx);
      return tx.tenant.create({
        data: {
          id,
          name,
          dealerCode,
          themeId,
          notes: clean(input.notes, 500),
          domains: { create: domains.map((domain, i) => ({ domain, isPrimary: i === 0 })) },
          settings: { create: { name, email: adminData?.email || '', leadTo: adminData?.email || '' } },
          users: adminData ? { create: adminData } : undefined,
        },
        include: { domains: true },
      });
    });
    await this.audit.record('tenant.create', { tenantId: tenant.id, actor, detail: { name, domains } });
    return tenant;
  }

  /** host header → dealership id (or null). Supports custom domains, <id>.localhost and DEFAULT_TENANT. */
  async resolveHost(host: string): Promise<Tenant | null> {
    const d = normDomain(host);
    if (!d) return null;
    const dom = await this.prisma.tenantDomain.findUnique({ where: { domain: d }, include: { tenant: true } });
    if (dom) return dom.tenant;
    const sub = d.match(/^([a-z0-9][a-z0-9-]{1,39})\.(localhost|lvh\.me)$/);
    // live server: <dealer-id>.<SITES_DOMAIN> (e.g. blue-motors.sites.yourcompany.com) for dealers without their own domain
    const sitesDomain = String(process.env.SITES_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (sitesDomain && d.endsWith('.' + sitesDomain)) {
      const t = await this.prisma.tenant.findUnique({ where: { id: d.slice(0, -sitesDomain.length - 1) } });
      if (t) return t;
    }
    if (sub) {
      const t = await this.prisma.tenant.findUnique({ where: { id: sub[1] } });
      if (t) return t;
    }
    const base = String(await this.platform.get('signup', 'baseDomain', '')).toLowerCase();
    if (base && d.endsWith('.' + base)) {
      const t = await this.prisma.tenant.findUnique({ where: { id: d.slice(0, -base.length - 1) } });
      if (t) return t;
    }
    if ((d === 'localhost' || d === '127.0.0.1') && process.env.DEFAULT_TENANT) {
      return this.prisma.tenant.findUnique({ where: { id: process.env.DEFAULT_TENANT } });
    }
    return null;
  }

  async get(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, include: { domains: { orderBy: { isPrimary: 'desc' } } } });
    if (!t) throw new NotFoundException('Dealership not found');
    return t;
  }

  /** Feature flags: per-dealer override, otherwise the platform default. */
  async features(tenant: { features: unknown }): Promise<Record<string, boolean>> {
    const defaults = (await this.platform.all()).features as Record<string, boolean>;
    const own = (tenant.features && typeof tenant.features === 'object' ? tenant.features : {}) as Record<string, boolean>;
    const out: Record<string, boolean> = {};
    for (const f of FEATURES) out[f] = typeof own[f] === 'boolean' ? own[f] : !!defaults[f];
    return out;
  }

  /** Which design version the dealership runs (pinned version, or the theme's stable/beta release). */
  async themeFor(tenant: { themeId: string; channel: string; themePin: string }) {
    const theme =
      (await this.prisma.theme.findUnique({ where: { id: tenant.themeId } })) ??
      (await this.prisma.theme.findUnique({ where: { id: 'classic' } }));
    if (!theme) return { id: tenant.themeId, version: '1.0.0', colorSlots: [] as unknown[] };
    const version = tenant.themePin || (tenant.channel === 'BETA' && theme.betaVersion ? theme.betaVersion : theme.stableVersion);
    return { id: theme.id, name: theme.name, version, colorSlots: theme.colorSlots as unknown[] };
  }

  /** Brand colours for a design: saved values over the design defaults. */
  async colorsFor(tenantId: string, themeId: string): Promise<Record<string, string>> {
    const theme = await this.prisma.theme.findUnique({ where: { id: themeId } });
    const slots = (theme?.colorSlots as { key: string; default: string }[] | undefined) ?? [];
    const saved = await this.prisma.designColors.findUnique({ where: { tenantId_themeId: { tenantId, themeId } } });
    const vals = (saved?.colors ?? {}) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const s of slots) out[s.key] = vals[s.key] || s.default;
    return out;
  }

  /** Settings for the admin: secrets become { set: boolean }. */
  async settingsForAdmin(tenantId: string) {
    const s = await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
    const out: Record<string, unknown> = { ...s };
    for (const k of SECRET_FIELDS) out[k] = { set: !!(s as Record<string, unknown>)[k] };
    return out;
  }

  async setOnboarding(tenantId: string, flag: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { onboarding: true } });
    const o = { ...((t?.onboarding as object) || {}), [flag]: true };
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { onboarding: o } });
  }
}
