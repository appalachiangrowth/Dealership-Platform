import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ContentService } from '../content/content.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { clean } from '../common/util.js';
import { isRichHtml, richHtmlToText } from '../posts/rich-html.js';
import { mediaMetaFor } from '../media/media-meta.js';
import type { BlogPost, Prisma, Tenant, Vehicle } from '../generated/prisma/client.js';
import { publishedNavFor, publishedPagesFor } from '../site-pages/site-pages.service.js';

/** Vehicle categories used by the category pages (/used-sedans …). */
export const CATEGORIES: Record<string, { label: string; match: string[] }> = {
  cars: { label: 'Used Cars', match: ['car', 'sedan', 'coupe', 'hatchback', 'convertible'] },
  sedans: { label: 'Sedans', match: ['sedan'] },
  suvs: { label: 'SUVs', match: ['suv', 'crossover'] },
  trucks: { label: 'Trucks', match: ['truck', 'pickup'] },
  wagons: { label: 'Wagons', match: ['wagon'] },
};

export interface PublicVehicleQuery {
  category?: string;
  make?: string;
  model?: string;
  q?: string;
  minPrice?: string;
  maxPrice?: string;
  minYear?: string;
  maxYear?: string;
  maxMileage?: string;
  featured?: string;
  sort?: string;
  page?: string;
  pageSize?: string;
}

const PUBLIC_SETTINGS = [
  'name', 'legalName', 'tagline', 'logo', 'faviconUrl', 'phone', 'email', 'street', 'city', 'state', 'stateName', 'zip', 'country', 'lat', 'lng',
  'hours', 'hoursWeek', 'hoursWeekend', 'hoursShort', 'facebook', 'instagram', 'google', 'googleReviews', 'youtube', 'tiktok',
  'messenger', 'siteUrl', 'themeColor',
] as const;

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly content: ContentService,
    private readonly platform: PlatformSettingsService,
  ) {}

  async tenantFor(host: string): Promise<Tenant> {
    const t = await this.tenants.resolveHost(host);
    if (!t) throw new NotFoundException({ message: 'No dealership is connected to this address yet', code: 'unknown_site' });
    if (t.status === 'SUSPENDED') throw new ForbiddenException({ message: 'This website is temporarily unavailable', code: 'suspended' });
    return t;
  }

  /** Everything a design needs to render the header, footer and texts. `previewTheme` = admin design preview. */
  async site(host: string, previewTheme?: string) {
    const t = await this.tenantFor(host);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: t.id } });
    let theme = await this.tenants.themeFor(t);
    if (previewTheme && previewTheme !== theme.id) {
      const th = await this.prisma.theme.findUnique({ where: { id: previewTheme } });
      // a private theme is only previewed on the websites of its own dealerships
      if (th && (!th.isPrivate || th.allowedTenantIds.includes(t.id))) theme = { id: th.id, name: th.name, version: th.stableVersion, colorSlots: th.colorSlots as unknown[] };
    }
    const { content, tokens } = await this.content.resolved(t.id, s, t.name);
    const settings: Record<string, unknown> = {};
    for (const k of PUBLIC_SETTINGS) settings[k] = s ? (s as Record<string, unknown>)[k] : '';
    const [published, posts, makes] = await Promise.all([
      this.prisma.vehicle.count({ where: { tenantId: t.id, status: 'PUBLISHED' } }),
      this.prisma.blogPost.count({ where: { tenantId: t.id, status: 'PUBLISHED' } }),
      this.prisma.vehicle.groupBy({ by: ['make'], where: { tenantId: t.id, status: 'PUBLISHED', make: { not: '' } }, _count: true, orderBy: { make: 'asc' } }),
    ]);
    return {
      tenant: { id: t.id, name: s?.name || t.name, dealerCode: t.dealerCode },
      theme: { id: theme.id, version: theme.version },
      colors: await this.tenants.colorsFor(t.id, theme.id),
      settings,
      tokens,
      content,
      features: await this.tenants.features(t),
      stats: { vehicles: published, posts },
      makes: makes.map((m) => ({ make: m.make, count: m._count })),
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])),
    };
  }

  private vehicleWhere(tenantId: string, q: PublicVehicleQuery): Prisma.VehicleWhereInput {
    const and: Prisma.VehicleWhereInput[] = [{ tenantId, status: 'PUBLISHED' }];
    const cat = CATEGORIES[q.category || ''];
    if (cat) {
      and.push({
        OR: cat.match.flatMap((m) => [
          { bodyStyle: { contains: m, mode: 'insensitive' as const } },
          { vehicleType: { contains: m, mode: 'insensitive' as const } },
        ]),
      });
    }
    if (q.make) and.push({ make: { equals: clean(q.make, 60), mode: 'insensitive' } });
    if (q.model) and.push({ model: { equals: clean(q.model, 80), mode: 'insensitive' } });
    const term = clean(q.q, 80);
    if (term) {
      and.push({
        OR: [
          { make: { contains: term, mode: 'insensitive' } },
          { model: { contains: term, mode: 'insensitive' } },
          { trim: { contains: term, mode: 'insensitive' } },
          { bodyStyle: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    const n = (v?: string) => (v && Number.isFinite(+v) ? +v : undefined);
    if (n(q.minPrice) !== undefined || n(q.maxPrice) !== undefined) and.push({ price: { gte: n(q.minPrice), lte: n(q.maxPrice) } });
    if (n(q.minYear) !== undefined || n(q.maxYear) !== undefined) and.push({ year: { gte: n(q.minYear), lte: n(q.maxYear) } });
    if (n(q.maxMileage) !== undefined) and.push({ mileage: { lte: n(q.maxMileage) } });
    if (q.featured === 'true') and.push({ featured: true });
    return { AND: and };
  }

  async vehicles(host: string, q: PublicVehicleQuery) {
    const t = await this.tenantFor(host);
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.pageSize || '24', 10) || 24));
    const sorts: Record<string, Prisma.VehicleOrderByWithRelationInput[]> = {
      newest: [{ featured: 'desc' }, { createdAt: 'desc' }],
      price_asc: [{ price: { sort: 'asc', nulls: 'last' } }],
      price_desc: [{ price: { sort: 'desc', nulls: 'last' } }],
      year_desc: [{ year: { sort: 'desc', nulls: 'last' } }],
      mileage_asc: [{ mileage: { sort: 'asc', nulls: 'last' } }],
    };
    const where = this.vehicleWhere(t.id, q);
    const [items, total] = await Promise.all([
      this.prisma.vehicle.findMany({ where, orderBy: sorts[q.sort || 'newest'] ?? sorts.newest, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async vehicle(host: string, slug: string) {
    const t = await this.tenantFor(host);
    const v = await this.prisma.vehicle.findFirst({ where: { tenantId: t.id, status: 'PUBLISHED', OR: [{ slug }, { id: slug }, { legacyId: slug }] } });
    if (!v) throw new NotFoundException('This vehicle is no longer available');
    const similar = await this.prisma.vehicle.findMany({
      where: { tenantId: t.id, status: 'PUBLISHED', id: { not: v.id }, OR: [{ make: v.make }, { bodyStyle: v.bodyStyle || '__none__' }] },
      take: 4,
      orderBy: { createdAt: 'desc' },
    });
    return { vehicle: v, similar };
  }

  async posts(host: string, page = 1) {
    const t = await this.tenantFor(host);
    const where = { tenantId: t.id, status: 'PUBLISHED' as const };
    const [items, total] = await Promise.all([
      this.prisma.blogPost.findMany({ where, orderBy: { publishedAt: 'desc' }, skip: (page - 1) * 12, take: 12, omit: { body: true } }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / 12)) };
  }

  async post(host: string, slug: string) {
    const t = await this.tenantFor(host);
    const p = await this.prisma.blogPost.findFirst({ where: { tenantId: t.id, status: 'PUBLISHED', OR: [{ slug }, { id: slug }, { legacyId: slug }] } });
    if (!p) throw new NotFoundException('Article not found');
    const more = await this.prisma.blogPost.findMany({
      where: { tenantId: t.id, status: 'PUBLISHED', id: { not: p.id } },
      orderBy: { publishedAt: 'desc' },
      take: 3,
      omit: { body: true },
    });
    const rich = isRichHtml(p.body);
    return { post: { ...p, format: rich ? 'html' : 'text', text: rich ? richHtmlToText(p.body) : p.body }, more };
  }

  /**
   * Everything the original theme templates need to render a page (used by the frontend's template engine):
   * the dealer's saved texts, business details, saved brand colours and feature flags.
   */
  async themeContext(host: string, previewTheme?: string) {
    const t = await this.tenantFor(host);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: t.id } });
    let theme = await this.tenants.themeFor(t);
    if (previewTheme && previewTheme !== theme.id) {
      const th = await this.prisma.theme.findUnique({ where: { id: previewTheme } });
      // a private theme is only previewed on the websites of its own dealerships
      if (th && (!th.isPrivate || th.allowedTenantIds.includes(t.id))) theme = { id: th.id, name: th.name, version: th.stableVersion, colorSlots: th.colorSlots as unknown[] };
    }
    const values = await this.content.values(t.id);
    const pages = await publishedPagesFor(this.prisma, t.id);
    const nav = await publishedNavFor(this.prisma, t.id, pages);
    const saved = await this.prisma.designColors.findUnique({ where: { tenantId_themeId: { tenantId: t.id, themeId: theme.id } } });
    const settings: Record<string, unknown> = {};
    for (const k of PUBLIC_SETTINGS) settings[k] = s ? (s as Record<string, unknown>)[k] : '';
    const features = await this.tenants.features(t);
    return {
      tenant: { id: t.id, name: t.name, dealerCode: t.dealerCode },
      theme: { id: theme.id, version: theme.version },
      values,
      settings,
      colors: (saved?.colors ?? {}) as Record<string, string>,
      features,
      /** Platform Admin storefront switches (same values as features.financing / features.tradeIn) */
      financingEnabled: features.financing !== false,
      tradeInEnabled: features.tradeIn !== false,
      /** custom pages from Platform Admin › Pages & SEO (menu links + sitemap) */
      pages,
      /** the header menu from Pages & SEO › Header menu (top-level links + dropdowns); null = automatic from `pages` */
      menu: nav.menu,
      /** full = the menu also holds the design's standard pages and replaces the design's own menu links */
      menuMode: nav.menuMode,
      /** footer columns from Pages & SEO › Footer; null = the design's own footer links */
      footer: nav.footer,
      /** alt text / title per picture (Platform Admin › SEO & URLs › Images), for <img> tags without their own */
      mediaMeta: await mediaMetaFor(this.prisma, t.id),
    };
  }

  /**
   * /inventory.json exactly as the old platform published it (same field names), so the original
   * theme scripts work unchanged: published vehicles + blog posts + lead form.
   */
  async inventoryJson(host: string) {
    const t = await this.tenantFor(host);
    const where = { tenantId: t.id, status: 'PUBLISHED' as const };
    // iOS memory guard: a dealership with tens of thousands of vehicles would otherwise send all of them to every
    // page (100+ MB of JSON → the iPhone tab crashes). The full list is capped (featured vehicles always included);
    // designs that browse everything use the paged storefront feed (/public/feed, api/feed-public.php?page=…).
    const cap = inventoryJsonCap();
    const [latest, featured, total, posts, tenant] = await Promise.all([
      this.prisma.vehicle.findMany({ where, orderBy: { createdAt: 'desc' }, take: cap }),
      this.prisma.vehicle.findMany({ where: { ...where, featured: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.vehicle.count({ where }),
      this.prisma.blogPost.findMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' } }),
      this.prisma.tenant.findUnique({ where: { id: t.id }, select: { leadForm: true } }),
    ]);
    const seen = new Set(latest.map((v) => v.id));
    const vehicles = [...latest, ...featured.filter((v) => !seen.has(v.id))].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const updated = [...vehicles, ...posts].reduce((a, x) => (x.updatedAt > a ? x.updatedAt : a), new Date(0));
    return {
      vehicles: vehicles.map(feedVehicle),
      posts: posts.map(feedPost),
      /** total published vehicles; `truncated` = this list is capped (see INVENTORY_JSON_MAX) */
      total,
      truncated: total > vehicles.length,
      leadForm: leadFormFor(tenant?.leadForm ?? null, await this.tenants.features(t)),
      updated: updated.getTime() ? updated.toISOString().replace(/\.\d{3}Z$/, 'Z') : '',
      /** alt text / title per picture, used by the website for pictures the design draws (lib/site-extras.ts) */
      mediaMeta: await mediaMetaFor(this.prisma, t.id),
    };
  }

  /**
   * Paged storefront feed for the designs (api/feed-public.php on the websites). Never sends the whole inventory:
   *   ?page=1&limit=16&make=&model=&body=&minPrice=&maxPrice=&q=&sort=   one page (≤ 16 vehicles) + total + pages
   *   ?featured=1&limit=12                                              featured first, then the newest (≤ 12)
   *   ?facets=1                                                         makes, models, body styles, price range
   *   ?id=<vehicle id or slug>                                          one vehicle with all its photos (VDP)
 *   ?posts=1                                                          the blog posts (no vehicles)
   * Vehicles use the same field names as /inventory.json, plus `thumb` (a ~600 px card photo).
   */
  async storefrontFeed(host: string, q: StorefrontFeedQuery) {
    const t = await this.tenantFor(host);
    const base: Prisma.VehicleWhereInput = { tenantId: t.id, status: 'PUBLISHED' };

    if (q.id) {
      const id = clean(q.id, 120);
      const v = await this.prisma.vehicle.findFirst({ where: { ...base, OR: [{ slug: id }, { id }, { legacyId: id }] } });
      if (!v) throw new NotFoundException('This vehicle is no longer available');
      return { vehicle: feedVehicle(v), mediaMeta: await mediaMetaFor(this.prisma, t.id) };
    }

    if (q.posts) {
      // blog list / article pages: the posts without the vehicles (newest first, at most 200)
      const posts = await this.prisma.blogPost.findMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, take: 200 });
      // mediaMeta: alt text / title of uploaded pictures, used by the website's article runtime (lib/site-extras.ts)
      return { posts: posts.map(feedPost), total: posts.length, mediaMeta: await mediaMetaFor(this.prisma, t.id) };
    }

    if (q.facets) {
      // optional ?body=suv / ?make=: facets of one body style or brand (the designs' "SUVs from $…" and brand links)
      const fw: Prisma.VehicleWhereInput = q.body || q.make ? this.vehicleWhere(t.id, { category: bodyCategory(q.body), make: q.make }) : base;
      const [total, makes, models, bodies, price, years, transmissions] = await Promise.all([
        this.prisma.vehicle.count({ where: fw }),
        this.prisma.vehicle.groupBy({ by: ['make'], where: { ...fw, make: { not: '' } }, _count: true, orderBy: { make: 'asc' }, take: FACET_MAX }),
        this.prisma.vehicle.groupBy({ by: ['make', 'model'], where: { ...fw, model: { not: '' } }, _count: true, orderBy: [{ make: 'asc' }, { model: 'asc' }], take: FACET_MAX * 4 }),
        this.prisma.vehicle.groupBy({ by: ['bodyStyle'], where: { ...fw, bodyStyle: { not: '' } }, _count: true, orderBy: { bodyStyle: 'asc' }, take: FACET_MAX }),
        this.prisma.vehicle.aggregate({ where: { ...fw, price: { gt: 0 } }, _min: { price: true }, _max: { price: true } }),
        // year / transmission dropdowns (Velora's inventory filters)
        this.prisma.vehicle.groupBy({ by: ['year'], where: { ...fw, year: { not: null } }, _count: true, orderBy: { year: 'desc' }, take: 80 }),
        this.prisma.vehicle.groupBy({ by: ['transmission'], where: { ...fw, transmission: { not: '' } }, _count: true, orderBy: { transmission: 'asc' }, take: 40 }),
      ]);
      return {
        total,
        makes: makes.map((m) => ({ make: m.make, count: m._count })),
        models: models.map((m) => ({ make: m.make, model: m.model, count: m._count })),
        bodies: bodies.map((b) => ({ body: b.bodyStyle, count: b._count })),
        minPrice: price._min.price === null ? 0 : Number(price._min.price),
        maxPrice: price._max.price === null ? 0 : Number(price._max.price),
        years: years.map((y) => ({ year: y.year, count: y._count })),
        transmissions: transmissions.map((x) => ({ trans: x.transmission, count: x._count })),
      };
    }

    if (q.featured) {
      const limit = clampInt(q.limit, 12, 1, 12);
      const featured = await this.prisma.vehicle.findMany({ where: { ...base, featured: true }, orderBy: { createdAt: 'desc' }, take: limit });
      const more = featured.length < limit
        ? await this.prisma.vehicle.findMany({ where: { ...base, featured: false }, orderBy: { createdAt: 'desc' }, take: limit - featured.length })
        : [];
      const vehicles = [...featured, ...more].map(feedVehicle);
      return { vehicles, total: vehicles.length };
    }

    const limit = clampInt(q.limit, 16, 1, 16);
    const page = clampInt(q.page, 1, 1, 100000);
    const where = this.vehicleWhere(t.id, {
      category: bodyCategory(q.body),
      make: q.make,
      model: q.model,
      q: q.q,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      minYear: q.minYear,
      maxYear: q.maxYear,
      maxMileage: q.maxMileage,
    });
    const bodyText = clean(q.body, 40);
    if (bodyText && !bodyCategory(q.body)) {
      (where.AND as Prisma.VehicleWhereInput[]).push({
        OR: [{ bodyStyle: { contains: bodyText, mode: 'insensitive' } }, { vehicleType: { contains: bodyText, mode: 'insensitive' } }],
      });
    }
    // the designs' fuel / drivetrain shortcuts (e.g. ?fuel=electric-hybrid, ?drive=awd)
    const fuel = clean(q.fuel, 40).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (fuel.length) {
      (where.AND as Prisma.VehicleWhereInput[]).push({ OR: fuel.map((f) => ({ fuelType: { contains: f, mode: 'insensitive' as const } })) });
    }
    const drive = clean(q.drive, 40);
    if (drive) {
      const d = drive.toLowerCase().replace(/[^a-z0-9]/g, '');
      const words: Record<string, string[]> = { awd: ['awd', 'all'], '4wd': ['4wd', '4x4', 'four'], '4x4': ['4wd', '4x4', 'four'], fwd: ['fwd', 'front'], rwd: ['rwd', 'rear'] };
      (where.AND as Prisma.VehicleWhereInput[]).push({ OR: (words[d] || [drive]).map((w) => ({ drivetrain: { contains: w, mode: 'insensitive' as const } })) });
    }
    // transmission (?trans=Automatic) and condition (?cond=used) filters
    const trans = clean(q.trans, 60);
    if (trans) (where.AND as Prisma.VehicleWhereInput[]).push({ transmission: { contains: trans, mode: 'insensitive' as const } });
    const cond = clean(q.cond, 30);
    if (cond) (where.AND as Prisma.VehicleWhereInput[]).push({ condition: { startsWith: cond, mode: 'insensitive' as const } });
    const total = await this.prisma.vehicle.count({ where });
    const pages = Math.max(1, Math.ceil(total / limit));
    const cur = Math.min(page, pages);
    const items = await this.prisma.vehicle.findMany({ where, orderBy: feedSort(q.sort), skip: (cur - 1) * limit, take: limit });
    return { vehicles: items.map(feedVehicle), total, page: cur, pages, limit };
  }

  /** URLs for sitemap.xml */
  async sitemap(host: string) {
    const t = await this.tenantFor(host);
    const [vehicles, posts] = await Promise.all([
      this.prisma.vehicle.findMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } }),
      this.prisma.blogPost.findMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } }),
    ]);
    return { vehicles, posts, categories: Object.keys(CATEGORIES), xmlEnabled: !!(await this.platform.get('feeds', 'inventoryXml', true)) };
  }
}

/** The vehicle enquiry form: its "Trade-in?" / "Need financing?" questions are left out when that storefront feature is off. */
function leadFormFor(form: unknown, features: Record<string, boolean>): unknown {
  if (!form || typeof form !== 'object') return form ?? null;
  const f = form as { fields?: Record<string, unknown> };
  if (!f.fields || typeof f.fields !== 'object') return form;
  const fields = { ...f.fields };
  if (features.financing === false) fields.financing = 0;
  if (features.tradeIn === false) fields.tradeIn = 0;
  return { ...f, fields };
}

/* ---------------- storefront feed helpers ---------------- */

export interface StorefrontFeedQuery {
  page?: string;
  limit?: string;
  make?: string;
  model?: string;
  body?: string;
  q?: string;
  minPrice?: string;
  maxPrice?: string;
  minYear?: string;
  maxYear?: string;
  maxMileage?: string;
  sort?: string;
  featured?: string;
  facets?: string;
  posts?: string;
  fuel?: string;
  drive?: string;
  trans?: string;
  cond?: string;
  id?: string;
}

/** at most this many makes / body styles in ?facets=1 (models: 4×) */
const FACET_MAX = 200;

/** /inventory.json holds at most INVENTORY_JSON_MAX vehicles (default 1000, min 100, max 5000) */
export function inventoryJsonCap(): number {
  const v = parseInt(process.env.INVENTORY_JSON_MAX || '', 10);
  return Number.isFinite(v) ? Math.min(5000, Math.max(100, v)) : 1000;
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** "sedan" / "sedans" / "SUV" → a CATEGORIES key; anything else → undefined (free-text body filter) */
function bodyCategory(body?: string): string | undefined {
  const b = clean(body, 40).toLowerCase();
  if (!b) return undefined;
  if (CATEGORIES[b]) return b;
  if (CATEGORIES[b + 's']) return b + 's';
  if (b === 'car') return 'cars';
  return undefined;
}

/** the designs' sort names (apex: price-asc …, vroomfox: lo / hi / mi / new) → database order */
function feedSort(sort?: string): Prisma.VehicleOrderByWithRelationInput[] {
  switch (String(sort || '').toLowerCase()) {
    case 'price-asc': case 'price_asc': case 'lo': return [{ price: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'price-desc': case 'price_desc': case 'hi': return [{ price: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'year-desc': case 'year_desc': return [{ year: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'year-asc': case 'year_asc': return [{ year: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'mileage-asc': case 'mileage_asc': case 'mi': return [{ mileage: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];
    case 'new': case 'newest': return [{ createdAt: 'desc' }];
    default: return [{ featured: 'desc' }, { createdAt: 'desc' }]; // "featured" (the designs' default)
  }
}

const relUrl = (u: string) => (u.startsWith('/uploads/') ? u.slice(1) : u);
const num = (x: unknown) => (x === null || x === undefined ? '' : Number(x));

/** card photo: our own uploads get the ~600 px version (backend media/thumbs.ts); other links are left as they are */
export function thumbUrl(u: string, w = 600): string {
  const r = relUrl(u || '');
  return /^uploads\/[^?#]+\.jpe?g$/i.test(r) ? `${r}?w=${w}` : r; // the thumbnail service resizes JPEG photos (uploads are stored as JPEG)
}

/** a blog post as /inventory.json and the storefront feed (?posts=1) publish it */
export function feedPost(p: BlogPost) {
  return {
    // the post's web address is /blog/<slug>: the designs open an article by this id
    id: p.slug,
    slug: p.slug,
    legacyId: p.legacyId || '',
    title: p.title,
    tag: p.category,
    date: p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : '',
    image: relUrl(p.coverImage),
    excerpt: p.excerpt,
    // rich text editor articles: plain text for the designs (paragraphs, word counts) + the formatted HTML,
    // which the website shows in place of the plain paragraphs (frontend lib/site-extras.ts)
    content: isRichHtml(p.body) ? richHtmlToText(p.body) : p.body,
    contentHtml: isRichHtml(p.body) ? p.body : '',
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
  };
}

/** one vehicle in the /inventory.json format (the original theme scripts read these exact field names) */
export function feedVehicle(v: Vehicle) {
  const images = (v.images || []).map(relUrl);
  return {
    id: v.legacyId || v.id,
    slug: v.slug,
    title: v.title,
    metaTitle: v.metaTitle,
    metaDescription: v.metaDescription,
    year: v.year ?? '',
    make: v.make,
    model: v.model,
    trim: v.trim,
    type: v.vehicleType,
    body: v.bodyStyle,
    price: num(v.price),
    mileage: v.mileage ?? '',
    stock: v.stockNumber,
    vin: v.vin,
    ext: v.exteriorColor,
    int: v.interiorColor,
    engine: v.engine,
    hp: v.horsepower,
    drivetrain: v.drivetrain,
    trans: v.transmission,
    fuel: v.fuelType,
    mpg: v.mpg,
    tank: v.fuelTank,
    doors: v.doors,
    seats: v.seats,
    owners: v.owners,
    accidents: v.accidents,
    deal: v.dealLabel,
    condition: v.condition,
    certified: v.certified ? 'Yes' : 'No',
    msrp: num(v.msrp),
    status: 'published',
    featured: v.featured,
    description: v.description,
    features: v.features,
    safety: v.safetyFeatures,
    images,
    /** ~600 px card photo (full-size photos stay in `images` for the vehicle page) */
    thumb: images[0] ? thumbUrl(images[0]) : '',
  };
}
