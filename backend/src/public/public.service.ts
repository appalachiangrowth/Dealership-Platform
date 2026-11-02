import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ContentService } from '../content/content.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { clean } from '../common/util.js';
import type { Prisma, Tenant } from '../generated/prisma/client.js';

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
  'name', 'legalName', 'tagline', 'logo', 'phone', 'email', 'street', 'city', 'state', 'stateName', 'zip', 'country', 'lat', 'lng',
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
      if (th) theme = { id: th.id, name: th.name, version: th.stableVersion, colorSlots: th.colorSlots as unknown[] };
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
    const p = await this.prisma.blogPost.findFirst({ where: { tenantId: t.id, status: 'PUBLISHED', OR: [{ slug }, { id: slug }] } });
    if (!p) throw new NotFoundException('Article not found');
    const more = await this.prisma.blogPost.findMany({
      where: { tenantId: t.id, status: 'PUBLISHED', id: { not: p.id } },
      orderBy: { publishedAt: 'desc' },
      take: 3,
      omit: { body: true },
    });
    return { post: p, more };
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
      if (th) theme = { id: th.id, name: th.name, version: th.stableVersion, colorSlots: th.colorSlots as unknown[] };
    }
    const values = await this.content.values(t.id);
    const saved = await this.prisma.designColors.findUnique({ where: { tenantId_themeId: { tenantId: t.id, themeId: theme.id } } });
    const settings: Record<string, unknown> = {};
    for (const k of PUBLIC_SETTINGS) settings[k] = s ? (s as Record<string, unknown>)[k] : '';
    return {
      tenant: { id: t.id, name: t.name, dealerCode: t.dealerCode },
      theme: { id: theme.id, version: theme.version },
      values,
      settings,
      colors: (saved?.colors ?? {}) as Record<string, string>,
      features: await this.tenants.features(t),
    };
  }

  /**
   * /inventory.json exactly as the old platform published it (same field names), so the original
   * theme scripts work unchanged: published vehicles + blog posts + lead form.
   */
  async inventoryJson(host: string) {
    const t = await this.tenantFor(host);
    const [vehicles, posts, tenant] = await Promise.all([
      this.prisma.vehicle.findMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.blogPost.findMany({ where: { tenantId: t.id, status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' } }),
      this.prisma.tenant.findUnique({ where: { id: t.id }, select: { leadForm: true } }),
    ]);
    const rel = (u: string) => (u.startsWith('/uploads/') ? u.slice(1) : u);
    const n = (x: unknown) => (x === null || x === undefined ? '' : Number(x));
    const updated = [...vehicles, ...posts].reduce((a, x) => (x.updatedAt > a ? x.updatedAt : a), new Date(0));
    return {
      vehicles: vehicles.map((v) => ({
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
        price: n(v.price),
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
        msrp: n(v.msrp),
        status: 'published',
        featured: v.featured,
        description: v.description,
        features: v.features,
        safety: v.safetyFeatures,
        images: v.images.map(rel),
      })),
      posts: posts.map((p) => ({
        id: p.legacyId || p.slug,
        title: p.title,
        tag: p.category,
        date: p.publishedAt ? p.publishedAt.toISOString().slice(0, 10) : '',
        image: rel(p.coverImage),
        excerpt: p.excerpt,
        content: p.body,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
      })),
      leadForm: tenant?.leadForm ?? null,
      updated: updated.getTime() ? updated.toISOString().replace(/\.\d{3}Z$/, 'Z') : '',
    };
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
