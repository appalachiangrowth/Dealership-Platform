import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UPLOAD_ROOT, sniffImage } from '../media/media.service.js';
import { clean, randomHex } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';
import type { Prisma, SitePage } from '../generated/prisma/client.js';

/** Section types the website knows (frontend/lib/custom-pages.ts). */
export const SECTION_TYPES = ['hero', 'text', 'split', 'cards', 'inventory', 'cta', 'stats', 'testimonials', 'faq', 'gallery', 'form', 'map', 'html', 'spacer'] as const;

/** Addresses the themes already use (or the website serves itself). */
const RESERVED = new Set([
  'index', 'inventory', 'used-cars', 'used-sedans', 'used-trucks', 'used-suvs', 'used-wagons', 'about-us', 'contact-us', 'blog',
  'blog-post', 'pages', 'vehicle', 'sitemap', 'robots', 'logo', 'api', 'themes', 'uploads', 'images', 'admin', 'login', 'dealer',
  'platform', 'inventory-json', 'pa-keys', 'feed', 'feeds',
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const MAX_JSON = 400_000;

type Seo = { title?: string; description?: string; image?: string; noindex?: boolean };

export function slugify(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** Published custom pages for a dealership (its own + the ones for every dealership; its own wins on the same address). */
export async function publishedPagesFor(prisma: PrismaService, tenantId: string) {
  const rows = await prisma.sitePage.findMany({
    where: { status: 'PUBLISHED', OR: [{ tenantId }, { tenantId: null }] },
    select: { slug: true, title: true, navLabel: true, showInNav: true, navOrder: true, tenantId: true, publishedSeo: true },
    orderBy: [{ navOrder: 'asc' }, { title: 'asc' }],
  });
  const bySlug = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!bySlug.has(r.slug) || r.tenantId) bySlug.set(r.slug, r);
  return [...bySlug.values()]
    .sort((a, b) => a.navOrder - b.navOrder || a.title.localeCompare(b.title))
    .map((r) => ({
      slug: r.slug,
      title: r.title,
      navLabel: r.navLabel || r.title,
      showInNav: r.showInNav,
      navOrder: r.navOrder,
      noindex: !!((r.publishedSeo ?? {}) as Seo).noindex,
    }));
}

/** keeps the section list a list of plain objects with a known type (texts are escaped by the website) */
function cleanSections(v: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(v)) throw new BadRequestException('Sections must be a list');
  if (v.length > 80) throw new BadRequestException('A page can have at most 80 sections');
  const out = v
    .filter((s) => s && typeof s === 'object' && (SECTION_TYPES as readonly string[]).includes(String((s as { type?: unknown }).type)))
    .map((s) => ({ ...(s as Record<string, unknown>), id: String((s as { id?: unknown }).id || randomHex(6)).slice(0, 40) }));
  const json = JSON.stringify(out);
  if (json.length > MAX_JSON) throw new BadRequestException('This page is too large. Split it into two pages.');
  return JSON.parse(json) as Prisma.InputJsonValue;
}

function cleanSeo(v: unknown): Seo {
  const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    title: clean(s.title, 120),
    description: clean(s.description, 320),
    image: clean(s.image, 500),
    noindex: !!s.noindex,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

@Injectable()
export class SitePagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  /* ───────────── Platform Admin ───────────── */

  private view(p: SitePage & { tenant?: { name: string } | null }) {
    return {
      id: p.id,
      tenantId: p.tenantId,
      tenantName: p.tenant?.name || '',
      title: p.title,
      slug: p.slug,
      status: p.status,
      sections: p.sections,
      seo: p.seo,
      showInNav: p.showInNav,
      navLabel: p.navLabel,
      navOrder: p.navOrder,
      publishedAt: p.publishedAt,
      updatedAt: p.updatedAt,
      updatedBy: p.updatedBy,
      /** published, but the editor has changes the website does not show yet */
      unpublishedChanges: p.status === 'PUBLISHED' && (!same(p.sections, p.published) || !same(p.seo, p.publishedSeo)),
    };
  }

  async list(q: { tenantId?: string; q?: string }) {
    const where: Prisma.SitePageWhereInput = {};
    if (q.tenantId === 'all') where.tenantId = null;
    else if (q.tenantId) where.OR = [{ tenantId: q.tenantId }, { tenantId: null }];
    const term = clean(q.q, 80);
    if (term) where.AND = [{ OR: [{ title: { contains: term, mode: 'insensitive' } }, { slug: { contains: term.toLowerCase() } }] }];
    const rows = await this.prisma.sitePage.findMany({ where, orderBy: [{ updatedAt: 'desc' }], include: { tenant: { select: { name: true } } } });
    return { pages: rows.map((r) => ({ ...this.view(r), sections: undefined, sectionCount: Array.isArray(r.sections) ? r.sections.length : 0 })) };
  }

  async get(id: string) {
    const p = await this.prisma.sitePage.findUnique({ where: { id }, include: { tenant: { select: { name: true } } } });
    if (!p) throw new NotFoundException('Page not found');
    return this.view(p);
  }

  private async checkSlug(slug: string, tenantId: string | null, exceptId?: string) {
    if (!SLUG.test(slug)) throw new BadRequestException('The address may use a–z, 0–9 and dashes (e.g. "financing" or "trade-in-value").');
    if (RESERVED.has(slug)) throw new BadRequestException(`"${slug}" is already used by the website designs. Choose another address.`);
    const clash = await this.prisma.sitePage.findFirst({ where: { slug, tenantId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictException(`Another page already uses /${slug}${tenantId ? ' for this dealership' : ''}.`);
  }

  private async scope(v: unknown): Promise<string | null> {
    const id = String(v ?? '').trim();
    if (!id || id === 'all') return null;
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw new BadRequestException('Dealership not found');
    return t.id;
  }

  async create(b: Record<string, unknown>, u: AuthUser) {
    const title = clean(b.title, 120) || 'New page';
    const tenantId = await this.scope(b.tenantId);
    let slug = slugify(String(b.slug || title)) || 'page';
    if (!b.slug) {
      // first free address: financing, financing-2 …
      for (let i = 2; (await this.prisma.sitePage.findFirst({ where: { slug, tenantId } })) || RESERVED.has(slug); i++) slug = `${slugify(title) || 'page'}-${i}`;
    }
    await this.checkSlug(slug, tenantId);
    const sections = b.sections !== undefined ? cleanSections(b.sections) : [];
    const p = await this.prisma.sitePage.create({
      // new pages go into the website's header menu when they are published (can be switched off in Page & menu)
      data: { title, slug, tenantId, sections, seo: cleanSeo(b.seo), showInNav: b.showInNav === undefined ? true : !!b.showInNav, navLabel: clean(b.navLabel, 40), createdBy: u.login, updatedBy: u.login },
      include: { tenant: { select: { name: true } } },
    });
    await this.audit.record('page.create', { tenantId, actor: u.login, detail: { id: p.id, slug } });
    return this.view(p);
  }

  async update(id: string, b: Record<string, unknown>, u: AuthUser) {
    const cur = await this.prisma.sitePage.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Page not found');
    const data: Prisma.SitePageUncheckedUpdateInput = { updatedBy: u.login };
    const tenantId = b.tenantId !== undefined ? await this.scope(b.tenantId) : cur.tenantId;
    const slug = b.slug !== undefined ? String(b.slug).trim().toLowerCase() : cur.slug;
    if (slug !== cur.slug || tenantId !== cur.tenantId) {
      await this.checkSlug(slug, tenantId, id);
      data.slug = slug;
      data.tenantId = tenantId;
    }
    if (b.title !== undefined) data.title = clean(b.title, 120) || cur.title;
    if (b.sections !== undefined) data.sections = cleanSections(b.sections);
    if (b.seo !== undefined) data.seo = cleanSeo(b.seo) as Prisma.InputJsonValue;
    if (b.showInNav !== undefined) data.showInNav = !!b.showInNav;
    if (b.navLabel !== undefined) data.navLabel = clean(b.navLabel, 40);
    if (b.navOrder !== undefined) data.navOrder = Math.max(-999, Math.min(999, Math.round(Number(b.navOrder) || 0)));
    const p = await this.prisma.sitePage.update({ where: { id }, data, include: { tenant: { select: { name: true } } } });
    return this.view(p);
  }

  /** the website shows the current sections + SEO from now on */
  async publish(id: string, u: AuthUser) {
    const cur = await this.prisma.sitePage.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Page not found');
    if (!Array.isArray(cur.sections) || !cur.sections.length) throw new BadRequestException('Add at least one section before publishing.');
    const p = await this.prisma.sitePage.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        published: cur.sections as Prisma.InputJsonValue,
        publishedSeo: cur.seo as Prisma.InputJsonValue,
        publishedAt: new Date(),
        // first publish: the page joins the header menu (Home, Inventory … Financing)
        ...(cur.publishedAt === null ? { showInNav: true } : {}),
        updatedBy: u.login,
      },
      include: { tenant: { select: { name: true } } },
    });
    await this.audit.record('page.publish', { tenantId: p.tenantId, actor: u.login, detail: { id, slug: p.slug } });
    return this.view(p);
  }

  async unpublish(id: string, u: AuthUser) {
    const p = await this.prisma.sitePage.update({ where: { id }, data: { status: 'DRAFT', updatedBy: u.login }, include: { tenant: { select: { name: true } } } }).catch(() => null);
    if (!p) throw new NotFoundException('Page not found');
    await this.audit.record('page.unpublish', { tenantId: p.tenantId, actor: u.login, detail: { id, slug: p.slug } });
    return this.view(p);
  }

  /** go back to what the website shows */
  async discard(id: string, u: AuthUser) {
    const cur = await this.prisma.sitePage.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Page not found');
    if (cur.published === null) throw new BadRequestException('This page was never published.');
    const p = await this.prisma.sitePage.update({
      where: { id },
      data: { sections: cur.published as Prisma.InputJsonValue, seo: (cur.publishedSeo ?? {}) as Prisma.InputJsonValue, updatedBy: u.login },
      include: { tenant: { select: { name: true } } },
    });
    return this.view(p);
  }

  async duplicate(id: string, b: Record<string, unknown>, u: AuthUser) {
    const cur = await this.prisma.sitePage.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Page not found');
    return this.create(
      {
        title: `${cur.title} (copy)`,
        tenantId: b.tenantId !== undefined ? b.tenantId : cur.tenantId,
        sections: cur.sections,
        seo: cur.seo,
        navLabel: cur.navLabel,
      },
      u,
    );
  }

  async remove(id: string, u: AuthUser) {
    const p = await this.prisma.sitePage.delete({ where: { id } }).catch(() => null);
    if (!p) throw new NotFoundException('Page not found');
    await this.audit.record('page.delete', { tenantId: p.tenantId, actor: u.login, detail: { id, slug: p.slug } });
    return { ok: true };
  }

  /** pictures for pages: backend/uploads/_platform/pages/<year>/<month>/… */
  async saveImage(file: { buffer: Buffer; originalname: string; size: number }, u: AuthUser) {
    if (!file?.buffer?.length) throw new BadRequestException('No file');
    if (file.size > 15 * 1024 * 1024) throw new BadRequestException('Pictures can be up to 15 MB');
    const kind = sniffImage(file.buffer);
    if (!kind) throw new BadRequestException(`${file.originalname}: use a JPG, PNG, GIF or WebP picture`);
    const d = new Date();
    const rel = join('_platform', 'pages', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'));
    await mkdir(join(UPLOAD_ROOT, rel), { recursive: true });
    const name = `${randomHex(10)}.${kind.ext}`;
    await writeFile(join(UPLOAD_ROOT, rel, name), file.buffer);
    void u;
    return { url: '/uploads/' + rel.split(/[\\/]/).join('/') + '/' + name, width: kind.width, height: kind.height };
  }

  /* ───────────── draft preview links (Platform Admin → website) ───────────── */

  private secret() {
    return process.env.JWT_SECRET || 'dev-only-secret-change-me-please';
  }

  previewToken(id: string) {
    const exp = Date.now() + 3 * 3600_000;
    const body = `${id}.${exp}`;
    const sig = createHmac('sha256', this.secret()).update('page-preview:' + body).digest('base64url');
    return { token: `${body}.${sig}`, expires: new Date(exp) };
  }

  private readToken(token: string): string | null {
    const [id, exp, sig] = String(token || '').split('.');
    if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
    const want = createHmac('sha256', this.secret()).update(`page-preview:${id}.${exp}`).digest();
    const got = Buffer.from(sig, 'base64url');
    return got.length === want.length && timingSafeEqual(got, want) ? id : null;
  }

  /* ───────────── public website ───────────── */

  private async tenantFor(host: string) {
    const t = await this.tenants.resolveHost(host);
    if (!t) throw new NotFoundException({ message: 'No dealership is connected to this address yet', code: 'unknown_site' });
    return t;
  }

  /** one page for the website (its published copy), or the draft with a preview token */
  async publicPage(host: string, slug: string, preview?: string) {
    const t = await this.tenantFor(host);
    if (preview) {
      const id = this.readToken(preview);
      if (!id) throw new NotFoundException('This preview link has expired. Open the preview again from Platform Admin.');
      const p = await this.prisma.sitePage.findUnique({ where: { id } });
      if (!p || (p.tenantId && p.tenantId !== t.id)) throw new NotFoundException('Page not found');
      return { page: { slug: p.slug, title: p.title, sections: p.sections, seo: p.seo }, preview: true };
    }
    const s = String(slug || '').toLowerCase();
    if (!SLUG.test(s)) throw new NotFoundException('Page not found');
    const p =
      (await this.prisma.sitePage.findFirst({ where: { slug: s, tenantId: t.id, status: 'PUBLISHED' } })) ??
      (await this.prisma.sitePage.findFirst({ where: { slug: s, tenantId: null, status: 'PUBLISHED' } }));
    if (!p) throw new NotFoundException('Page not found');
    return { page: { slug: p.slug, title: p.title, sections: p.published ?? [], seo: p.publishedSeo ?? {} }, preview: false };
  }
}
