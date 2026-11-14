import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ContentService } from '../content/content.service.js';
import { AuditService } from '../audit/audit.service.js';
import { clean } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';
import type { Prisma, SeoPage, Tenant } from '../generated/prisma/client.js';
import {
  CUSTOM_PREFIX,
  DEFAULT_INVENTORY_BASE,
  DEFAULT_VEHICLE_DESCRIPTION,
  DEFAULT_VEHICLE_TITLE,
  DESCRIPTION_RANGE,
  PART_RE,
  QUERY_PAGES,
  RESERVED_PATHS,
  STANDARD_PAGES,
  TITLE_RANGE,
  VEHICLE_VARS,
  defaultPathOf,
  fillTemplate,
  normalizePath,
  slugMatchesVehicle,
  slugPart,
  templateVars,
  uniqueVehicleSlug,
} from './seo.util.js';

/** What a website needs to show one page's head (empty string = keep the design's own value). */
export interface SeoMeta {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonicalUrl: string;
}

/** Link map for the website: design address ("used-cars.html", "financing") → clean address ("/used-cars-for-sale"). */
export interface SeoLinks {
  base: string;
  pages: Record<string, string>;
}

export type ResolveResult =
  | { type: 'redirect'; to: string; status: 301 | 302; links: SeoLinks }
  | { type: 'page'; page: { key: string; path: string; meta: SeoMeta }; links: SeoLinks }
  | { type: 'vehicle'; vehicle: { id: string; publicId: string; slug: string; path: string; meta: SeoMeta }; links: SeoLinks }
  | { type: 'none'; links: SeoLinks };

interface TenantCfg {
  at: number;
  tenantId: string;
  base: string;
  previousBases: string[];
  titleTpl: string;
  descTpl: string;
  dealer: { name: string; city: string; state: string };
  rows: Map<string, SeoPage>;
  /** the design has its own inventory page (single-page designs show inventory inside the home page) */
  inventoryPage: boolean;
  /** custom address → page key */
  pathToKey: Map<string, string>;
}

const VEHICLE_SELECT = {
  id: true,
  legacyId: true,
  year: true,
  make: true,
  model: true,
  trim: true,
  price: true,
  mileage: true,
  stockNumber: true,
  vin: true,
  bodyStyle: true,
  condition: true,
  exteriorColor: true,
  images: true,
  status: true,
  metaTitle: true,
  metaDescription: true,
  updatedAt: true,
} satisfies Prisma.VehicleSelect;
type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof VEHICLE_SELECT }>;

const EMPTY_META: SeoMeta = { title: '', description: '', ogTitle: '', ogDescription: '', ogImage: '', canonicalUrl: '' };
const CFG_TTL = 15_000;
const ENSURE_TTL = 60_000;
/** old addresses that still lead to vehicles (the platform's earlier vehicle pages) */
const LEGACY_BASES = ['inventory', 'vehicle', 'vehicles'];

/** Folders with the website designs (theme.json per version). Used to list each dealership's pages. */
function themeDirs(): string[] {
  const env = String(process.env.SEO_THEME_DIRS || process.env.THEMES_DIR || '').split(',').map((s) => s.trim()).filter(Boolean);
  const defaults = [resolve(process.cwd(), '../frontend/themes'), resolve(process.cwd(), '../peerless-autos-frontend/frontend/themes')];
  return [...new Set([...env.map((d) => resolve(d)), ...defaults])].filter((d) => existsSync(d));
}

/** The design's pages from its theme.json (null = design files not found on this server). */
function themePages(themeId: string, version: string): { key: string; label: string }[] | null {
  for (const dir of themeDirs()) {
    const root = join(dir, themeId);
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(themeId) || !existsSync(root)) continue;
    const versions = readdirSync(root).filter((v) => /^\d+\.\d+\.\d+$/.test(v) && existsSync(join(root, v, 'theme.json')));
    if (!versions.length) continue;
    const pick = versions.includes(version) ? version : versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()!;
    try {
      const m = JSON.parse(readFileSync(join(root, pick, 'theme.json'), 'utf8')) as { pages?: { id?: string; label?: string }[] };
      return (m.pages || [])
        .filter((p) => p && typeof p.id === 'string')
        .map((p) => ({ key: String(p.id), label: String(p.label || p.id).replace(/\s*\(.*\)\s*$/, '') }));
    } catch {
      return null;
    }
  }
  return null;
}

const str = (v: unknown, max: number) => clean(v, max);
function absUrlOrEmpty(v: unknown, label: string): string {
  const s = clean(v, 500);
  if (!s) return '';
  if (/^https?:\/\/[^\s]+$/i.test(s) || s.startsWith('/')) return s;
  throw new BadRequestException(`${label} must be a full address (https://…) or start with "/".`);
}

@Injectable()
export class SeoService {
  private readonly log = new Logger('SEO');
  private readonly cfgCache = new Map<string, TenantCfg>();
  private readonly ensuredAt = new Map<string, number>();
  private readonly ensuring = new Map<string, Promise<{ created: number; updated: number }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly content: ContentService,
    private readonly audit: AuditService,
  ) {}

  /* ───────────────────────── shared ───────────────────────── */

  private async cfg(tenantId: string, fresh = false): Promise<TenantCfg> {
    const hit = this.cfgCache.get(tenantId);
    if (!fresh && hit && Date.now() - hit.at < CFG_TTL) return hit;
    const [settings, rows, ts, t] = await Promise.all([
      this.prisma.seoSettings.findUnique({ where: { tenantId } }),
      this.prisma.seoPage.findMany({ where: { tenantId } }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { name: true, city: true, state: true } }),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, themeId: true, channel: true, themePin: true } }),
    ]);
    let inventoryPage = true;
    if (t) {
      try {
        const theme = await this.tenants.themeFor(t);
        const pages = themePages(theme.id, theme.version);
        if (pages) inventoryPage = pages.some((x) => x.key === 'inventory');
      } catch {
        /* keep the default */
      }
    }
    const map = new Map<string, SeoPage>(rows.map((r) => [r.pageKey, r] as const));
    const pathToKey = new Map<string, string>();
    for (const r of rows) if (r.path) pathToKey.set(r.path, r.pageKey);
    const cfg: TenantCfg = {
      at: Date.now(),
      tenantId,
      base: settings?.inventoryBase || DEFAULT_INVENTORY_BASE,
      previousBases: settings?.previousBases || [],
      titleTpl: settings?.vehicleTitleTemplate || DEFAULT_VEHICLE_TITLE,
      descTpl: settings?.vehicleDescriptionTemplate || DEFAULT_VEHICLE_DESCRIPTION,
      dealer: { name: ts?.name || t?.name || '', city: ts?.city || '', state: ts?.state || '' },
      rows: map,
      inventoryPage,
      pathToKey,
    };
    this.cfgCache.set(tenantId, cfg);
    return cfg;
  }

  private invalidate(tenantId: string) {
    this.cfgCache.delete(tenantId);
  }

  /** the address a page has now ("" = home) */
  private pathOf(cfg: TenantCfg, key: string): string {
    if (key === 'home') return '';
    return cfg.rows.get(key)?.path || defaultPathOf(key);
  }

  /** where visitors of a sold / removed vehicle go */
  private inventoryUrl(cfg: TenantCfg): string {
    const custom = cfg.rows.get('inventory')?.path;
    if (custom) return '/' + custom;
    return cfg.inventoryPage ? '/inventory.html' : '/#/inventory';
  }

  private links(cfg: TenantCfg): SeoLinks {
    const pages: Record<string, string> = {};
    for (const [key, r] of cfg.rows) {
      if (!r.path || key === 'home') continue;
      pages[defaultPathOf(key)] = '/' + r.path;
    }
    return { base: cfg.base, pages };
  }

  private pageMeta(r: SeoPage | undefined): SeoMeta {
    if (!r) return { ...EMPTY_META };
    return {
      title: r.metaTitle,
      description: r.metaDescription,
      ogTitle: r.ogTitle || r.metaTitle,
      ogDescription: r.ogDescription || r.metaDescription,
      ogImage: r.ogImage,
      canonicalUrl: r.canonicalUrl,
    };
  }

  private vehicleMeta(cfg: TenantCfg, v: VehicleRow, sv: { metaTitle: string; metaDescription: string } | null): SeoMeta {
    const vars = templateVars(v, cfg.dealer);
    const title = sv?.metaTitle || v.metaTitle || fillTemplate(cfg.titleTpl, vars);
    const description = sv?.metaDescription || v.metaDescription || fillTemplate(cfg.descTpl, vars);
    return { title, description, ogTitle: title, ogDescription: description, ogImage: v.images[0] || '', canonicalUrl: '' };
  }

  /* ───────────────────────── vehicle slugs ───────────────────────── */

  /**
   * Gives every vehicle of a dealership a clean slug. Existing slugs stay unless the vehicle's year / make / model /
   * trim changed (then the old address 301s to the new one). `regenerate` rebuilds every slug that was not typed by
   * hand to the cleanest free form. Runs one at a time per dealership.
   */
  async ensureVehicleSlugs(tenantId: string, regenerate = false): Promise<{ created: number; updated: number }> {
    const running = this.ensuring.get(tenantId);
    if (running) {
      await running.catch(() => undefined);
      if (!regenerate) return { created: 0, updated: 0 };
    }
    const job = this.doEnsure(tenantId, regenerate).finally(() => this.ensuring.delete(tenantId));
    this.ensuring.set(tenantId, job);
    const out = await job;
    this.ensuredAt.set(tenantId, Date.now());
    return out;
  }

  /** at most once a minute per dealership (website traffic) */
  private async ensureThrottled(tenantId: string) {
    const at = this.ensuredAt.get(tenantId) || 0;
    if (Date.now() - at < ENSURE_TTL) return;
    this.ensuredAt.set(tenantId, Date.now());
    try {
      await this.ensureVehicleSlugs(tenantId);
    } catch (e) {
      this.log.warn(`slug refresh failed for ${tenantId}: ${(e as Error).message}`);
    }
  }

  private async doEnsure(tenantId: string, regenerate: boolean) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId },
      select: { id: true, year: true, make: true, model: true, trim: true, stockNumber: true, vin: true, seo: { select: { slug: true, slugLocked: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const taken = new Map<string, string>(); // slug → vehicle id
    for (const v of vehicles) if (v.seo?.slugLocked) taken.set(v.seo.slug, v.id);
    const keep = new Set<string>();
    if (!regenerate) {
      for (const v of vehicles) {
        if (!v.seo || v.seo.slugLocked) continue;
        if (slugMatchesVehicle(v.seo.slug, v) && !taken.has(v.seo.slug)) {
          taken.set(v.seo.slug, v.id);
          keep.add(v.id);
        }
      }
    }
    const creates: { vehicleId: string; tenantId: string; slug: string }[] = [];
    const updates: { id: string; from: string; to: string }[] = [];
    for (const v of vehicles) {
      if (v.seo?.slugLocked || keep.has(v.id)) continue;
      const slug = uniqueVehicleSlug(v, (s) => taken.has(s) && taken.get(s) !== v.id);
      taken.set(slug, v.id);
      if (!v.seo) creates.push({ vehicleId: v.id, tenantId, slug });
      else if (v.seo.slug !== slug) updates.push({ id: v.id, from: v.seo.slug, to: slug });
    }
    if (!creates.length && !updates.length) return { created: 0, updated: 0 };

    await this.prisma.$transaction(
      async (tx) => {
        // two steps so two vehicles can swap slugs without hitting the unique index
        for (const u of updates) await tx.seoVehicle.update({ where: { vehicleId: u.id }, data: { slug: `tmp-${u.id}` } });
        for (const u of updates) await tx.seoVehicle.update({ where: { vehicleId: u.id }, data: { slug: u.to } });
        if (creates.length) await tx.seoVehicle.createMany({ data: creates, skipDuplicates: true });
        for (const u of updates) await this.saveRedirect(tx, tenantId, `@v/${u.from}`, `vehicle:${u.id}`);
        const now = [...updates.map((u) => u.to), ...creates.map((c) => c.slug)];
        if (now.length) await tx.seoRedirect.deleteMany({ where: { tenantId, fromPath: { in: now.map((s) => `@v/${s}`) } } });
      },
      { timeout: 60_000 },
    );
    return { created: creates.length, updated: updates.length };
  }

  private async saveRedirect(tx: Prisma.TransactionClient, tenantId: string, fromPath: string, target: string) {
    await tx.seoRedirect.upsert({
      where: { tenantId_fromPath: { tenantId, fromPath } },
      create: { tenantId, fromPath, target },
      update: { target },
    });
  }

  /* ───────────────────────── Platform Admin ───────────────────────── */

  private async tenantOr404(id: string): Promise<Tenant & { domains: { domain: string; isPrimary: boolean }[] }> {
    const t = await this.prisma.tenant.findUnique({ where: { id }, include: { domains: { orderBy: { isPrimary: 'desc' } } } });
    if (!t) throw new NotFoundException('Dealership not found');
    return t;
  }

  /** the dealership's fixed website address (primary domain → <id>.<SITES_DOMAIN> → none) */
  private siteBaseOf(t: { id: string; domains: { domain: string }[] }, siteUrl: string) {
    const d = t.domains.find((x) => !x.domain.endsWith('localhost'))?.domain;
    if (d) return { url: `https://${d}`, domain: d, fixed: true };
    if (/^https?:\/\//i.test(siteUrl)) return { url: siteUrl.replace(/\/+$/, ''), domain: siteUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, ''), fixed: true };
    const sites = String(process.env.SITES_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    if (sites) return { url: `https://${t.id}.${sites}`, domain: `${t.id}.${sites}`, fixed: true };
    return { url: '', domain: t.domains[0]?.domain || '', fixed: false };
  }

  /** Every page of the dealership's website: standard pages + the design's own + published Pages & SEO pages. */
  private async catalog(t: Tenant) {
    const theme = await this.tenants.themeFor(t);
    const fromTheme = themePages(theme.id, theme.version);
    const list: { key: string; label: string; kind: 'theme' | 'custom'; inTheme: boolean | null; seoGroup?: string; seo?: { title?: string; description?: string } }[] = [];
    for (const p of STANDARD_PAGES) {
      const own = fromTheme?.find((x) => x.key === p.key);
      list.push({ key: p.key, label: p.label, kind: 'theme', inTheme: fromTheme ? !!own : null, seoGroup: p.seo });
    }
    for (const p of fromTheme || []) {
      if (QUERY_PAGES.has(p.key) || list.some((x) => x.key === p.key) || !/^[a-z0-9][a-z0-9-]*$/.test(p.key)) continue;
      list.push({ key: p.key, label: p.label, kind: 'theme', inTheme: true });
    }
    const custom = await this.prisma.sitePage.findMany({
      where: { status: 'PUBLISHED', OR: [{ tenantId: t.id }, { tenantId: null }] },
      select: { slug: true, title: true, tenantId: true, publishedSeo: true, navOrder: true },
      orderBy: [{ navOrder: 'asc' }, { title: 'asc' }],
    });
    const bySlug = new Map<string, (typeof custom)[number]>();
    for (const r of custom) if (!bySlug.has(r.slug) || r.tenantId) bySlug.set(r.slug, r);
    for (const r of bySlug.values()) {
      list.push({ key: CUSTOM_PREFIX + r.slug, label: r.title, kind: 'custom', inTheme: true, seo: (r.publishedSeo ?? {}) as { title?: string; description?: string } });
    }
    return { theme, list };
  }

  async adminGet(tenantId: string, q: { q?: string; page?: string; pageSize?: string }) {
    const t = await this.tenantOr404(tenantId);
    await this.ensureVehicleSlugs(t.id).catch((e) => this.log.warn(`slugs: ${(e as Error).message}`));
    const cfg = await this.cfg(t.id, true);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: t.id } });
    const { content } = await this.content.resolved(t.id, s, t.name);
    const { theme, list } = await this.catalog(t);
    const site = this.siteBaseOf(t, s?.siteUrl || '');
    const themeRow = await this.prisma.theme.findUnique({ where: { id: theme.id }, select: { name: true } });

    const pages = list.map((p) => {
      const r = cfg.rows.get(p.key);
      return {
        key: p.key,
        label: p.label,
        kind: p.kind,
        inTheme: p.inTheme,
        defaultPath: defaultPathOf(p.key),
        path: this.pathOf(cfg, p.key),
        customPath: r?.path ?? null,
        metaTitle: r?.metaTitle ?? '',
        metaDescription: r?.metaDescription ?? '',
        ogTitle: r?.ogTitle ?? '',
        ogDescription: r?.ogDescription ?? '',
        ogImage: r?.ogImage ?? '',
        canonicalUrl: r?.canonicalUrl ?? '',
        defaultTitle: p.kind === 'custom' ? clean(p.seo?.title, 200) || p.label : p.seoGroup ? content[`${p.seoGroup}.title`] || '' : '',
        defaultDescription: p.kind === 'custom' ? clean(p.seo?.description, 400) : p.seoGroup ? content[`${p.seoGroup}.description`] || '' : '',
        updatedAt: r?.updatedAt ?? null,
      };
    });

    const vehicles = await this.adminVehicles(t.id, cfg, q);
    const redirects = await this.prisma.seoRedirect.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const redirectRows = await Promise.all(
      redirects.map(async (r) => ({
        from: r.fromPath.startsWith('@v/') ? `/${cfg.base}/${r.fromPath.slice(3)}` : `/${r.fromPath}`,
        to: (await this.targetPath(cfg, r.target)) ?? '(removed)',
        hits: r.hits,
        createdAt: r.createdAt,
      })),
    );

    return {
      dealer: { id: t.id, name: s?.name || t.name, status: t.status, themeId: theme.id, themeName: themeRow?.name || theme.id, site },
      ranges: { title: TITLE_RANGE, description: DESCRIPTION_RANGE },
      pages,
      vehicleSettings: {
        inventoryBase: cfg.base,
        previousBases: cfg.previousBases,
        titleTemplate: cfg.titleTpl === DEFAULT_VEHICLE_TITLE ? '' : cfg.titleTpl,
        descriptionTemplate: cfg.descTpl === DEFAULT_VEHICLE_DESCRIPTION ? '' : cfg.descTpl,
        defaults: { title: DEFAULT_VEHICLE_TITLE, description: DEFAULT_VEHICLE_DESCRIPTION },
        vars: VEHICLE_VARS,
        dealer: cfg.dealer,
      },
      vehicles,
      redirects: redirectRows,
    };
  }

  private async adminVehicles(tenantId: string, cfg: TenantCfg, q: { q?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(q.pageSize || '25', 10) || 25));
    const term = clean(q.q, 80);
    const where: Prisma.VehicleWhereInput = { tenantId };
    if (term) {
      const n = Number(term);
      where.OR = [
        { make: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
        { trim: { contains: term, mode: 'insensitive' } },
        { stockNumber: { contains: term, mode: 'insensitive' } },
        { vin: { contains: term, mode: 'insensitive' } },
        { title: { contains: term, mode: 'insensitive' } },
        { seo: { is: { slug: { contains: slugPart(term) || term.toLowerCase() } } } },
        ...(Number.isInteger(n) && n > 1900 && n < 2100 ? [{ year: n }] : []),
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        select: { ...VEHICLE_SELECT, title: true, seo: { select: { slug: true, slugLocked: true, metaTitle: true, metaDescription: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return {
      items: rows.map((v) => {
        const auto = this.vehicleMeta(cfg, v, null);
        const name = v.title || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'Vehicle';
        return {
          id: v.id,
          publicId: v.legacyId || v.id,
          name,
          status: v.status,
          stockNumber: v.stockNumber,
          image: v.images[0] || '',
          price: v.price === null ? null : Number(v.price),
          mileage: v.mileage,
          slug: v.seo?.slug || '',
          slugLocked: !!v.seo?.slugLocked,
          path: v.seo ? `/${cfg.base}/${v.seo.slug}` : '',
          metaTitle: v.seo?.metaTitle || '',
          metaDescription: v.seo?.metaDescription || '',
          /** what the website shows without a Platform Admin override (dealer's own text, else the template) */
          autoTitle: auto.title,
          autoDescription: auto.description,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** PUT pages: [{ key, path, metaTitle, metaDescription, ogTitle, ogDescription, ogImage, canonicalUrl }] */
  async savePages(tenantId: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(tenantId);
    const input = Array.isArray(b.pages) ? (b.pages as Record<string, unknown>[]) : null;
    if (!input) throw new BadRequestException('pages must be a list');
    const cfg = await this.cfg(t.id, true);
    const { list } = await this.catalog(t);
    const labels = new Map(list.map((p) => [p.key, p.label]));
    // stored pages keep working even when the design no longer lists them
    for (const k of cfg.rows.keys()) if (!labels.has(k)) labels.set(k, k);

    const next = new Map<string, { path: string | null; data: Omit<Prisma.SeoPageUncheckedCreateInput, 'tenantId' | 'pageKey' | 'path'> }>();
    for (const p of input) {
      const key = String(p.key || '');
      const label = labels.get(key);
      if (!label) throw new BadRequestException(`Unknown page "${key}"`);
      let path: string | null = null;
      if (key !== 'home' && p.path !== undefined && p.path !== null && String(p.path).trim() !== '') {
        const n = normalizePath(p.path);
        if (n === null) throw new BadRequestException(`${label}: the URL path may use a–z, 0–9, dashes and up to 3 parts separated by "/" (e.g. "used-cars" or "financing/get-approved").`);
        path = n === '' || n === defaultPathOf(key) ? null : n;
      }
      next.set(key, {
        path,
        data: {
          metaTitle: str(p.metaTitle, 200),
          metaDescription: str(p.metaDescription, 400),
          ogTitle: str(p.ogTitle, 200),
          ogDescription: str(p.ogDescription, 400),
          ogImage: absUrlOrEmpty(p.ogImage, `${label}: share image`),
          canonicalUrl: (() => {
            const c = absUrlOrEmpty(p.canonicalUrl, `${label}: canonical URL`);
            if (c && !/^https?:\/\//i.test(c)) throw new BadRequestException(`${label}: the canonical URL must be a full address (https://…).`);
            return c;
          })(),
        },
      });
    }

    // every page's address after this save → must be unique and must not hide a vehicle or a system address
    const effective = new Map<string, string>(); // path → key
    const allKeys = new Set([...labels.keys()]);
    for (const key of allKeys) {
      const path = next.has(key) ? next.get(key)!.path : cfg.rows.get(key)?.path ?? null;
      const eff = key === 'home' ? '' : path || defaultPathOf(key);
      if (path) {
        const first = path.split('/')[0];
        if (RESERVED_PATHS.has(path) || RESERVED_PATHS.has(first)) throw new BadRequestException(`${labels.get(key)}: "/${path}" is used by the website itself. Choose another URL path.`);
        if (path.startsWith(cfg.base + '/') || cfg.previousBases.some((pb) => path.startsWith(pb + '/'))) {
          throw new BadRequestException(`${labels.get(key)}: "/${path}" is inside the vehicle addresses (/${cfg.base}/…). Choose another URL path.`);
        }
      }
      const clash = effective.get(eff);
      if (clash !== undefined) throw new ConflictException(`"/${eff}" is used by both ${labels.get(clash)} and ${labels.get(key)}. Every page needs its own URL path.`);
      effective.set(eff, key);
      // "about-us.html" also answers on "about-us"
      if (eff.endsWith('.html')) {
        const bare = eff.slice(0, -5);
        const other = effective.get(bare);
        if (other !== undefined && other !== key) throw new ConflictException(`"/${bare}" is used by both ${labels.get(other)} and ${labels.get(key)}. Every page needs its own URL path.`);
        effective.set(bare, key);
      }
    }

    const changed: { key: string; from: string; to: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const [key, n] of next) {
        const cur = cfg.rows.get(key);
        const oldPath = cur?.path ?? null;
        if (oldPath && oldPath !== n.path) {
          // the old custom address keeps working (301 to wherever this page lives now)
          await this.saveRedirect(tx, t.id, oldPath, `page:${key}`);
          changed.push({ key, from: '/' + oldPath, to: '/' + (n.path || defaultPathOf(key)) });
        } else if (!oldPath && n.path) changed.push({ key, from: '/' + defaultPathOf(key), to: '/' + n.path });
        const empty = !n.path && !Object.values(n.data).some((v) => String(v ?? '').trim() !== '');
        if (empty) {
          if (cur) await tx.seoPage.delete({ where: { id: cur.id } });
          continue;
        }
        await tx.seoPage.upsert({
          where: { tenantId_pageKey: { tenantId: t.id, pageKey: key } },
          create: { tenantId: t.id, pageKey: key, path: n.path, ...n.data, updatedBy: u.login },
          update: { path: n.path, ...n.data, updatedBy: u.login },
        });
      }
      // an address in use again is no longer a redirect
      const live = [...effective.keys()].filter(Boolean);
      if (live.length) await tx.seoRedirect.deleteMany({ where: { tenantId: t.id, fromPath: { in: live } } });
    });
    this.invalidate(t.id);
    await this.audit.record('seo.pages', { tenantId: t.id, actor: u.login, detail: { pages: [...next.keys()], moved: changed } });
    return { ok: true, moved: changed };
  }

  /** PUT vehicle-template: { inventoryBase, titleTemplate, descriptionTemplate, regenerate? } */
  async saveVehicleTemplate(tenantId: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(tenantId);
    const cfg = await this.cfg(t.id, true);
    let base = cfg.base;
    if (b.inventoryBase !== undefined) {
      base = slugPart(String(b.inventoryBase || '').replace(/^\/+|\/+$/g, ''), 60) || DEFAULT_INVENTORY_BASE;
      if (!PART_RE.test(base) || RESERVED_PATHS.has(base)) throw new BadRequestException(`"/${base}" cannot be used for vehicle addresses. Try "inventory" or "used-cars".`);
      for (const [key, r] of cfg.rows) {
        if (r.path && r.path.startsWith(base + '/')) throw new ConflictException(`The page "${key}" uses /${r.path}, which is inside /${base}/…. Change that page's URL path first.`);
      }
    }
    const tpl = (v: unknown, def: string) => {
      const s = clean(v, 300);
      return s === def ? '' : s;
    };
    const titleTemplate = b.titleTemplate === undefined ? (cfg.titleTpl === DEFAULT_VEHICLE_TITLE ? '' : cfg.titleTpl) : tpl(b.titleTemplate, DEFAULT_VEHICLE_TITLE);
    const descriptionTemplate =
      b.descriptionTemplate === undefined ? (cfg.descTpl === DEFAULT_VEHICLE_DESCRIPTION ? '' : cfg.descTpl) : tpl(b.descriptionTemplate, DEFAULT_VEHICLE_DESCRIPTION);
    const previousBases = base !== cfg.base ? [...new Set([...cfg.previousBases, cfg.base])].filter((x) => x !== base).slice(-10) : cfg.previousBases.filter((x) => x !== base);

    await this.prisma.seoSettings.upsert({
      where: { tenantId: t.id },
      create: { tenantId: t.id, inventoryBase: base, previousBases, vehicleTitleTemplate: titleTemplate, vehicleDescriptionTemplate: descriptionTemplate, updatedBy: u.login },
      update: { inventoryBase: base, previousBases, vehicleTitleTemplate: titleTemplate, vehicleDescriptionTemplate: descriptionTemplate, updatedBy: u.login },
    });
    this.invalidate(t.id);
    const slugs = await this.ensureVehicleSlugs(t.id, !!b.regenerate);
    await this.audit.record('seo.vehicle-template', { tenantId: t.id, actor: u.login, detail: { inventoryBase: base, from: cfg.base, slugs } });
    return { ok: true, inventoryBase: base, slugs };
  }

  async regenerate(tenantId: string, u: AuthUser) {
    const t = await this.tenantOr404(tenantId);
    const slugs = await this.ensureVehicleSlugs(t.id, true);
    this.invalidate(t.id);
    await this.audit.record('seo.regenerate-slugs', { tenantId: t.id, actor: u.login, detail: slugs });
    return { ok: true, ...slugs };
  }

  /** PATCH one vehicle: { slug?, metaTitle?, metaDescription? } — slug "" = back to the automatic clean slug */
  async patchVehicle(tenantId: string, vehicleId: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(tenantId);
    const v = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId: t.id }, select: { id: true, seo: true } });
    if (!v) throw new NotFoundException('Vehicle not found for this dealership');
    if (!v.seo) await this.ensureVehicleSlugs(t.id);
    const cur = await this.prisma.seoVehicle.findUnique({ where: { vehicleId: v.id } });
    if (!cur) throw new ConflictException('This vehicle has no address yet — try again in a moment.');

    const data: Prisma.SeoVehicleUpdateInput = {};
    if (b.metaTitle !== undefined) data.metaTitle = str(b.metaTitle, 200);
    if (b.metaDescription !== undefined) data.metaDescription = str(b.metaDescription, 400);
    let unlock = false;
    if (b.slug !== undefined) {
      const raw = String(b.slug ?? '').trim().replace(/^.*\//, '');
      if (raw === '') unlock = true;
      else {
        const slug = slugPart(raw, 120);
        if (!PART_RE.test(slug)) throw new BadRequestException('The URL slug may use a–z, 0–9 and dashes, e.g. "2022-ford-f150-lariat".');
        if (slug !== cur.slug) {
          const clash = await this.prisma.seoVehicle.findUnique({ where: { tenantId_slug: { tenantId: t.id, slug } }, select: { vehicleId: true } });
          if (clash && clash.vehicleId !== v.id) throw new ConflictException(`Another vehicle of this dealership already uses "${slug}".`);
          data.slug = slug;
        }
        data.slugLocked = true;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (unlock) data.slugLocked = false;
      await tx.seoVehicle.update({ where: { vehicleId: v.id }, data });
      if (typeof data.slug === 'string') {
        await this.saveRedirect(tx, t.id, `@v/${cur.slug}`, `vehicle:${v.id}`);
        await tx.seoRedirect.deleteMany({ where: { tenantId: t.id, fromPath: `@v/${data.slug}` } });
      }
    });
    if (unlock) await this.ensureVehicleSlugs(t.id);
    this.invalidate(t.id);
    const row = await this.prisma.seoVehicle.findUnique({ where: { vehicleId: v.id } });
    await this.audit.record('seo.vehicle', { tenantId: t.id, actor: u.login, detail: { vehicleId: v.id, from: cur.slug, to: row?.slug } });
    const cfg = await this.cfg(t.id);
    return { ok: true, slug: row?.slug, slugLocked: row?.slugLocked, path: row ? `/${cfg.base}/${row.slug}` : '' };
  }

  /* ───────────────────────── public website ───────────────────────── */

  /** current address of a redirect target (null = it no longer exists) */
  private async targetPath(cfg: TenantCfg, target: string): Promise<string | null> {
    if (target.startsWith('page:')) return '/' + this.pathOf(cfg, target.slice(5));
    if (target.startsWith('vehicle:')) {
      const sv = await this.prisma.seoVehicle.findUnique({ where: { vehicleId: target.slice(8) }, select: { slug: true, tenantId: true } });
      return sv && sv.tenantId === cfg.tenantId ? `/${cfg.base}/${sv.slug}` : null;
    }
    return null;
  }

  private hit(id: string) {
    this.prisma.seoRedirect.update({ where: { id }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }).catch(() => undefined);
  }

  /** a vehicle by its old id / legacy id / old internal slug (links from before clean addresses) */
  private async vehicleByAnyId(tenantId: string, ref: string) {
    if (!ref || ref.length > 120) return null;
    return this.prisma.vehicle.findFirst({
      where: { tenantId, OR: [{ id: ref }, { legacyId: ref }, { slug: ref }] },
      select: { id: true, status: true, seo: { select: { slug: true } } },
    });
  }

  private async vehicleRedirect(cfg: TenantCfg, v: { id: string; status: string; seo: { slug: string } | null }, links: SeoLinks): Promise<ResolveResult> {
    if (v.status !== 'PUBLISHED') return { type: 'redirect', to: this.inventoryUrl(cfg), status: 302, links };
    let slug = v.seo?.slug;
    if (!slug) {
      await this.ensureVehicleSlugs(cfg.tenantId);
      slug = (await this.prisma.seoVehicle.findUnique({ where: { vehicleId: v.id }, select: { slug: true } }))?.slug;
    }
    return slug ? { type: 'redirect', to: `/${cfg.base}/${slug}`, status: 301, links } : { type: 'none', links };
  }

  /**
   * What the website should do with an address: show a page (with its title / description), show a vehicle,
   * redirect, or nothing special (design's own handling). `id` = the ?id= of vehicle.html links.
   */
  async resolve(tenantId: string, rawPath: string, id?: string): Promise<ResolveResult> {
    void this.ensureThrottled(tenantId);
    const cfg = await this.cfg(tenantId);
    const links = this.links(cfg);
    let p = String(rawPath || '').trim().toLowerCase();
    try {
      p = decodeURIComponent(p);
    } catch {
      /* keep as is */
    }
    p = p.replace(/[?#].*$/, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
    if (p.length > 300) return { type: 'none', links };

    // home
    if (p === '' || p === 'index.html' || p === 'index.php') {
      return { type: 'page', page: { key: 'home', path: '', meta: this.pageMeta(cfg.rows.get('home')) }, links };
    }

    // a configured clean address
    const key = cfg.pathToKey.get(p);
    if (key) return { type: 'page', page: { key, path: p, meta: this.pageMeta(cfg.rows.get(key)) }, links };

    // vehicle.html?id=… (links the designs build) → clean vehicle address
    if (p === 'vehicle.html' || p === 'vehicle') {
      const v = id ? await this.vehicleByAnyId(tenantId, id) : null;
      return v ? this.vehicleRedirect(cfg, v, links) : { type: 'none', links };
    }

    // /<base>/<slug>, older bases, and /inventory/<old id>
    const parts = p.split('/');
    if (parts.length === 2) {
      const [a, b] = parts;
      const bases = new Set([cfg.base, ...cfg.previousBases, ...LEGACY_BASES]);
      if (bases.has(a)) {
        const sv = await this.prisma.seoVehicle.findUnique({ where: { tenantId_slug: { tenantId, slug: b } }, select: { slug: true, vehicleId: true, metaTitle: true, metaDescription: true } });
        if (sv) {
          const v = await this.prisma.vehicle.findUnique({ where: { id: sv.vehicleId }, select: VEHICLE_SELECT });
          if (!v || v.status !== 'PUBLISHED') return { type: 'redirect', to: this.inventoryUrl(cfg), status: 302, links };
          if (a !== cfg.base) return { type: 'redirect', to: `/${cfg.base}/${sv.slug}`, status: 301, links };
          const path = `${cfg.base}/${sv.slug}`;
          return { type: 'vehicle', vehicle: { id: v.id, publicId: v.legacyId || v.id, slug: sv.slug, path, meta: this.vehicleMeta(cfg, v, sv) }, links };
        }
        const old = await this.prisma.seoRedirect.findUnique({ where: { tenantId_fromPath: { tenantId, fromPath: `@v/${b}` } } });
        if (old) {
          const to = await this.targetPath(cfg, old.target);
          if (to) {
            this.hit(old.id);
            return { type: 'redirect', to, status: 301, links };
          }
        }
        const v = await this.vehicleByAnyId(tenantId, parts[1]);
        if (v) return this.vehicleRedirect(cfg, v, links);
      }
    }

    // a design / Pages & SEO page at its own address that now has a clean one → 301
    const bare = p.endsWith('.html') ? p.slice(0, -5) : p;
    for (const k of [bare, CUSTOM_PREFIX + bare]) {
      const r = cfg.rows.get(k);
      if (!r || k === 'home') continue;
      if (r.path) return { type: 'redirect', to: '/' + r.path, status: 301, links };
      // its own address: still gets the title / description set in Platform Admin
      if (k.startsWith(CUSTOM_PREFIX) || p.endsWith('.html')) return { type: 'page', page: { key: k, path: defaultPathOf(k), meta: this.pageMeta(r) }, links };
    }

    // renamed addresses
    const old = await this.prisma.seoRedirect.findUnique({ where: { tenantId_fromPath: { tenantId, fromPath: p } } });
    if (old) {
      const to = await this.targetPath(cfg, old.target);
      if (to !== null && to !== '/' + p) {
        this.hit(old.id);
        return { type: 'redirect', to, status: 301, links };
      }
    }
    return { type: 'none', links };
  }

  /** Link map + every clean address (client-side link rewriting and sitemap.xml). */
  async linksFor(tenantId: string) {
    await this.ensureThrottled(tenantId);
    const cfg = await this.cfg(tenantId);
    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId, status: 'PUBLISHED', seo: { isNot: null } },
      select: { id: true, legacyId: true, updatedAt: true, seo: { select: { slug: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const map: Record<string, string> = {};
    for (const v of vehicles) if (v.seo) map[v.legacyId || v.id] = v.seo.slug;
    return {
      ...this.links(cfg),
      vehicles: map,
      sitemap: {
        pages: [...cfg.rows.entries()].filter(([, r]) => !!r.path).map(([key, r]) => ({ key, path: '/' + r.path })),
        vehicles: vehicles.filter((v) => v.seo).map((v) => ({ path: `/${cfg.base}/${v.seo!.slug}`, updatedAt: v.updatedAt })),
      },
    };
  }
}
