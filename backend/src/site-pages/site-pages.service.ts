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
import { sanitizeInlineHtml, sanitizeRichHtml } from '../posts/rich-html.js';
import { DEFAULT_BY_KEY, DEFAULT_PAGES, LINK_URL, cleanFooter, resolveFooter, starterFooter, type FooterColumn, type FooterEntry } from './site-nav.js';

/** Section types the website knows (frontend/lib/custom-pages.ts). */
export const SECTION_TYPES = ['hero', 'header', 'text', 'split', 'cards', 'inventory', 'cta', 'stats', 'testimonials', 'faq', 'gallery', 'form', 'map', 'html', 'spacer'] as const;

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

/* ───────────── header menu (Pages & SEO › Header menu) ───────────── */

/** one entry of a website's header menu, as stored (SiteMenu.items) */
export type MenuItem = {
  id: string;
  /**
   * page = a custom page (by address) · default = a standard page of the design (Home, Inventory, About Us …; its
   * address is locked) · group = a dropdown title without a page of its own · link = any address
   */
  type: 'page' | 'default' | 'group' | 'link';
  slug?: string;
  /** default pages: home | inventory | used-cars … (site-nav.ts DEFAULT_PAGES) */
  key?: string;
  url?: string;
  /** menu text; empty = the page's menu text */
  label: string;
  hidden: boolean;
  /** dropdown entries (top level only): pages and links */
  children?: MenuItem[];
};
/** what the website draws: visible entries only, pages resolved (key = a standard page of the design) */
export type NavEntry = { label: string; slug?: string; url?: string; key?: string; children?: NavEntry[] };
/**
 * full = the menu holds the standard pages too and replaces the design's own menu links (Pages & SEO manages the
 * whole header) · append = only extra entries, after the design's own links (menus saved before this existed)
 */
export type MenuMode = 'full' | 'append';
export const menuModeOf = (items: MenuItem[]): MenuMode => (items.some((i) => i.type === 'default' || (i.children || []).some((c) => c.type === 'default')) ? 'full' : 'append');

const MAX_MENU_TOP = 30;
const MAX_MENU_CHILDREN = 15;
/** inventory, contact, about, home, blog, category:suvs … (they follow the theme), /path, #anchor, https://…, tel:, mailto: */
const MENU_URL = LINK_URL;

function cleanMenuItem(v: unknown, top: boolean): MenuItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const type = o.type === 'group' && top ? 'group' : o.type === 'link' ? 'link' : o.type === 'page' ? 'page' : o.type === 'default' ? 'default' : null;
  if (!type) return null;
  const item: MenuItem = { id: String(o.id || randomHex(6)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || randomHex(6), type, label: clean(o.label, 40), hidden: !!o.hidden };
  if (type === 'page') {
    const slug = String(o.slug || '').trim().toLowerCase();
    if (!SLUG.test(slug)) return null;
    item.slug = slug;
  }
  if (type === 'default') {
    const key = String(o.key || '');
    if (!DEFAULT_BY_KEY.has(key)) return null;
    item.key = key;
  }
  if (type === 'link') {
    const url = String(o.url || '').trim();
    if (!MENU_URL.test(url)) throw new BadRequestException(`"${url || '(empty)'}" is not a link the menu can use. Use a page of the website (/financing), https://… or a quick link.`);
    if (!item.label) throw new BadRequestException('Every link in the menu needs a menu text.');
    item.url = url;
  }
  if (type === 'group' && !item.label) throw new BadRequestException('Every dropdown needs a title.');
  if (top) {
    const kids = Array.isArray(o.children) ? o.children : [];
    if (kids.length > MAX_MENU_CHILDREN) throw new BadRequestException(`A dropdown can hold at most ${MAX_MENU_CHILDREN} entries.`);
    const children = kids.map((c) => cleanMenuItem(c, false)).filter((c): c is MenuItem => !!c);
    if (children.length || type === 'group') item.children = children;
  }
  return item;
}

/** the stored menu: two levels (top level + dropdown entries), known types, safe links, each standard page once */
export function cleanMenu(v: unknown): MenuItem[] {
  if (!Array.isArray(v)) throw new BadRequestException('The menu must be a list');
  if (v.length > MAX_MENU_TOP) throw new BadRequestException(`The menu can have at most ${MAX_MENU_TOP} top-level entries.`);
  const items = v.map((x) => cleanMenuItem(x, true)).filter((x): x is MenuItem => !!x);
  const seen = new Set<string>();
  const once = (it: MenuItem) => (it.type !== 'default' ? true : seen.has(it.key!) ? false : (seen.add(it.key!), true));
  return items.filter(once).map((it) => (it.children ? { ...it, children: it.children.filter(once) } : it));
}

/** the standard pages, in the order most designs show them (the ones designs do not show in the header are hidden) */
export function defaultMenuItems(): MenuItem[] {
  return DEFAULT_PAGES.map((d) => ({ id: randomHex(6), type: 'default' as const, key: d.key, label: '', hidden: !d.menu }));
}

type PublishedPage = Awaited<ReturnType<typeof publishedPagesFor>>[number];

/**
 * The header menu a website draws: the dealership's own menu, otherwise the menu for every dealership,
 * otherwise null (= automatic: the published pages with "Show in the menu", by order — as before).
 * Pages that are not published (or were deleted) drop out; a page with dropdown entries that is not published
 * becomes a plain dropdown title. Published pages with "Show in the menu" that the menu does not mention yet are
 * added at the end, so a newly published page still appears without editing the menu.
 */
export function resolveMenu(items: MenuItem[] | null, pages: PublishedPage[]): NavEntry[] | null {
  if (!items) return null;
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const mentioned = new Set<string>();
  const one = (it: MenuItem): NavEntry | null => {
    if (it.slug) mentioned.add(it.slug);
    if (it.hidden) return null;
    if (it.type === 'page') {
      const p = bySlug.get(it.slug || '');
      return p ? { label: it.label || p.navLabel || p.title, slug: p.slug } : null;
    }
    if (it.type === 'link') return it.url ? { label: it.label, url: it.url } : null;
    if (it.type === 'default') {
      const d = DEFAULT_BY_KEY.get(it.key || '');
      return d ? { label: it.label || d.label, url: d.url, key: d.key } : null;
    }
    return { label: it.label };
  };
  const out: NavEntry[] = [];
  for (const it of items) {
    (it.children || []).forEach((c) => c.slug && mentioned.add(c.slug));
    const e = one(it);
    const children = it.hidden ? [] : (it.children || []).map(one).filter((c): c is NavEntry => !!c);
    if (!e) {
      // an unpublished page that holds a dropdown: keep the dropdown under the page's menu text
      if (!it.hidden && (it.type === 'page' || it.type === 'default') && children.length) out.push({ label: it.label || it.slug || 'Menu', children });
      continue;
    }
    if (children.length) e.children = children;
    if (it.type === 'group' && !children.length) continue;
    out.push(e);
  }
  for (const p of pages) if (p.showInNav && !mentioned.has(p.slug)) out.push({ label: p.navLabel || p.title, slug: p.slug });
  return out;
}

async function storedMenu(prisma: PrismaService, tenantId: string | null) {
  return prisma.siteMenu.findFirst({ where: { tenantId } });
}

/** the header menu for a dealership's website (null = automatic) */
export async function publishedMenuFor(prisma: PrismaService, tenantId: string, pages: PublishedPage[]): Promise<NavEntry[] | null> {
  return (await publishedNavFor(prisma, tenantId, pages)).menu;
}

async function storedFooter(prisma: PrismaService, tenantId: string | null) {
  return prisma.siteFooter.findFirst({ where: { tenantId } });
}

/**
 * Header menu + footer for a dealership's website: its own, otherwise the ones for every dealership.
 * menu null = automatic (custom pages after the design's links) · footer null = the design's own footer links.
 */
export async function publishedNavFor(
  prisma: PrismaService,
  tenantId: string,
  pages: PublishedPage[],
): Promise<{ menu: NavEntry[] | null; menuMode: MenuMode; footer: FooterEntry[] | null }> {
  const row = (await storedMenu(prisma, tenantId)) ?? (await storedMenu(prisma, null));
  let menu: NavEntry[] | null = null;
  let menuMode: MenuMode = 'append';
  if (row) {
    try {
      const items = cleanMenu(row.items);
      menu = resolveMenu(items, pages);
      menuMode = menuModeOf(items);
    } catch {
      menu = null;
    }
  }
  let footer: FooterEntry[] | null = null;
  try {
    const f = (await storedFooter(prisma, tenantId)) ?? (await storedFooter(prisma, null));
    if (f) footer = resolveFooter(cleanFooter(f.columns), pages);
  } catch {
    footer = null;
  }
  return { menu, menuMode, footer };
}

/* ───────────── Text / Picture & Text: headings (H1–H6) + rich text ───────────── */

const HEADING_LEVELS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const SECTION_HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4']);

/**
 * content = [{ kind: "heading", level: "h1"…"h6", text } | { kind: "text", html }] — the headings and formatted text
 * of a Text or Picture & Text section (sections saved before keep title + body and are shown as before).
 * The formatted text is cleaned like a blog article (bold, italic, underline, highlight, lists, links …).
 */
function cleanContent(v: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .slice(0, 60)
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const o = x as Record<string, unknown>;
      const id = String(o.id || randomHex(6)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || randomHex(6);
      if (o.kind === 'heading') return { id, kind: 'heading', level: HEADING_LEVELS.has(String(o.level)) ? String(o.level) : 'h2', text: sanitizeInlineHtml(clean(o.text, 600), { max: 600 }) };
      return { id, kind: 'text', html: sanitizeRichHtml(o.html, 60_000) };
    });
}

/** keeps the section list a list of plain objects with a known type (inline HTML is sanitized) */
function cleanSections(v: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(v)) throw new BadRequestException('Sections must be a list');
  if (v.length > 80) throw new BadRequestException('A page can have at most 80 sections');
  const out = v
    .filter((s) => s && typeof s === 'object' && (SECTION_TYPES as readonly string[]).includes(String((s as { type?: unknown }).type)))
    .map((s) => {
      const o: Record<string, unknown> = { ...(s as Record<string, unknown>), id: String((s as { id?: unknown }).id || randomHex(6)).slice(0, 40) };
      if ('headingTag' in o) {
        const tag = String(o.headingTag ?? '').toLowerCase();
        if (SECTION_HEADING_TAGS.has(tag)) o.headingTag = tag;
        else delete o.headingTag;
      }
      if (o.type === 'header' && 'level' in o) {
        const lvl = String(o.level ?? '').toLowerCase();
        o.level = SECTION_HEADING_TAGS.has(lvl) ? lvl : 'h1';
      }
      if (o.type !== 'html') {
        for (const k of ['title', 'eyebrow', 'subtitle', 'intro', 'text'] as const) {
          if (typeof o[k] === 'string') o[k] = sanitizeInlineHtml(o[k], { max: 4000 });
        }
      }
      if ((o.type === 'text' || o.type === 'split') && 'content' in o) {
        const content = cleanContent(o.content);
        if (content) o.content = content;
        else delete o.content;
      }
      return o;
    });
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
    if (p.slug !== cur.slug) await this.renameInMenus(cur.slug, p.slug);
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

  /* ───────────── header menu ───────────── */

  /** the pages a menu can use: for a dealership its own + the shared ones (its own wins on the same address) */
  private async menuPages(tenantId: string | null) {
    const rows = await this.prisma.sitePage.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : { tenantId: null },
      select: { id: true, slug: true, title: true, navLabel: true, showInNav: true, navOrder: true, status: true, tenantId: true },
      orderBy: [{ navOrder: 'asc' }, { title: 'asc' }],
    });
    const bySlug = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!bySlug.has(r.slug) || r.tenantId) bySlug.set(r.slug, r);
    return [...bySlug.values()].sort((a, b) => a.navOrder - b.navOrder || a.title.localeCompare(b.title));
  }

  /**
   * the menu an admin starts from when nothing is saved: the design's standard pages (Home, Inventory, About Us, Blog,
   * Contact Us shown; Used Cars …, Financing, Trade-In hidden), then the published pages with "Show in the menu".
   * Until it is saved the website keeps the automatic menu.
   */
  private automatic(pages: { slug: string; showInNav: boolean; status: string }[]): MenuItem[] {
    const own = new Set(pages.map((p) => p.slug));
    const defaults = defaultMenuItems().filter((d) => !own.has(d.key!)); // a Pages & SEO page /financing is the Financing entry
    const custom = pages.filter((p) => p.status === 'PUBLISHED' && p.showInNav).map((p) => ({ id: randomHex(6), type: 'page' as const, slug: p.slug, label: '', hidden: false }));
    const contact = defaults.findIndex((d) => d.key === 'contact');
    return [...defaults.slice(0, contact), ...custom, ...defaults.slice(contact)];
  }

  /**
   * ?scope=<dealership id> | all — the menu to edit. A dealership without its own menu starts from the menu for
   * every dealership (or the automatic one); "source" says where it comes from.
   */
  async getMenu(scopeId: unknown) {
    const tenantId = await this.scope(scopeId);
    const pages = await this.menuPages(tenantId);
    const own = await storedMenu(this.prisma, tenantId);
    const shared = tenantId ? await storedMenu(this.prisma, null) : null;
    const from = own ?? shared;
    let items: MenuItem[];
    try {
      items = from ? cleanMenu(from.items) : this.automatic(pages);
    } catch {
      items = this.automatic(pages);
    }
    return {
      scope: tenantId || 'all',
      source: own ? 'own' : shared ? 'shared' : 'automatic',
      updatedAt: own?.updatedAt ?? null,
      updatedBy: own?.updatedBy ?? '',
      /** full = replaces the design's own menu links · append = after them (a menu saved before standard pages existed) */
      mode: menuModeOf(items),
      /** the standard pages a menu can hold (locked addresses) */
      defaults: DEFAULT_PAGES.map((d) => ({ key: d.key, label: d.label, url: d.url })),
      items,
      pages: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, navLabel: p.navLabel || p.title, showInNav: p.showInNav, status: p.status, shared: !p.tenantId })),
      /** what the website shows right now (published pages only) */
      preview: resolveMenu(items, pages.filter((p) => p.status === 'PUBLISHED').map((p) => ({ slug: p.slug, title: p.title, navLabel: p.navLabel || p.title, showInNav: p.showInNav, navOrder: 0, noindex: false }))),
    };
  }

  async saveMenu(b: Record<string, unknown>, u: AuthUser) {
    const tenantId = await this.scope(b.scope);
    const items = cleanMenu(b.items) as unknown as Prisma.InputJsonValue;
    const cur = await storedMenu(this.prisma, tenantId);
    if (cur) await this.prisma.siteMenu.update({ where: { id: cur.id }, data: { items, updatedBy: u.login } });
    else await this.prisma.siteMenu.create({ data: { tenantId, items, updatedBy: u.login } });
    await this.audit.record('menu.save', { tenantId, actor: u.login, detail: { scope: tenantId || 'all' } });
    return this.getMenu(tenantId || 'all');
  }

  /** back to the menu for every dealership (a dealership) or to the automatic menu (every dealership) */
  async resetMenu(scopeId: unknown, u: AuthUser) {
    const tenantId = await this.scope(scopeId);
    await this.prisma.siteMenu.deleteMany({ where: { tenantId } });
    await this.audit.record('menu.reset', { tenantId, actor: u.login, detail: { scope: tenantId || 'all' } });
    return this.getMenu(tenantId || 'all');
  }

  /* ───────────── footer ───────────── */

  /**
   * ?scope=<dealership id> | all — the footer to edit. Nothing saved = the design's own footer links on the website;
   * the editor then starts from a ready-made footer (Quick Links, Company, Legal) that is fully editable.
   */
  async getFooter(scopeId: unknown) {
    const tenantId = await this.scope(scopeId);
    const pages = await this.menuPages(tenantId);
    const own = await storedFooter(this.prisma, tenantId);
    const shared = tenantId ? await storedFooter(this.prisma, null) : null;
    const from = own ?? shared;
    let columns: FooterColumn[];
    try {
      columns = from ? cleanFooter(from.columns) : starterFooter(pages.filter((p) => p.status === 'PUBLISHED'));
    } catch {
      columns = starterFooter(pages.filter((p) => p.status === 'PUBLISHED'));
    }
    return {
      scope: tenantId || 'all',
      /** own / shared = the website shows these columns · design = nothing saved, the design's own footer links */
      source: own ? 'own' : shared ? 'shared' : 'design',
      updatedAt: own?.updatedAt ?? null,
      updatedBy: own?.updatedBy ?? '',
      columns,
      defaults: DEFAULT_PAGES.map((d) => ({ key: d.key, label: d.label, url: d.url })),
      pages: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, status: p.status, shared: !p.tenantId })),
    };
  }

  async saveFooter(b: Record<string, unknown>, u: AuthUser) {
    const tenantId = await this.scope(b.scope);
    const columns = cleanFooter(b.columns) as unknown as Prisma.InputJsonValue;
    const cur = await storedFooter(this.prisma, tenantId);
    if (cur) await this.prisma.siteFooter.update({ where: { id: cur.id }, data: { columns, updatedBy: u.login } });
    else await this.prisma.siteFooter.create({ data: { tenantId, columns, updatedBy: u.login } });
    await this.audit.record('footer.save', { tenantId, actor: u.login, detail: { scope: tenantId || 'all' } });
    return this.getFooter(tenantId || 'all');
  }

  /** back to the footer for every dealership (a dealership) or to the design's own footer links (every dealership) */
  async resetFooter(scopeId: unknown, u: AuthUser) {
    const tenantId = await this.scope(scopeId);
    await this.prisma.siteFooter.deleteMany({ where: { tenantId } });
    await this.audit.record('footer.reset', { tenantId, actor: u.login, detail: { scope: tenantId || 'all' } });
    return this.getFooter(tenantId || 'all');
  }

  /** a page's address changed: menus that link to it follow */
  private async renameInMenus(from: string, to: string) {
    const rows = await this.prisma.siteMenu.findMany({ select: { id: true, items: true } });
    for (const r of rows) {
      const json = JSON.stringify(r.items);
      if (!json.includes(`"slug":"${from}"`)) continue;
      const fix = (list: unknown): unknown => (Array.isArray(list) ? list.map((x) => (x && typeof x === 'object' ? { ...(x as object), ...((x as MenuItem).slug === from ? { slug: to } : {}), ...((x as MenuItem).children ? { children: fix((x as MenuItem).children) } : {}) } : x)) : list);
      await this.prisma.siteMenu.update({ where: { id: r.id }, data: { items: fix(r.items) as Prisma.InputJsonValue } });
    }
    const footers = await this.prisma.siteFooter.findMany({ select: { id: true, columns: true } });
    for (const f of footers) {
      if (!JSON.stringify(f.columns).includes(`"slug":"${from}"`)) continue;
      const cols = (Array.isArray(f.columns) ? f.columns : []).map((c) =>
        c && typeof c === 'object' && Array.isArray((c as { links?: unknown }).links)
          ? { ...(c as object), links: ((c as { links: { slug?: string }[] }).links).map((l) => (l && l.slug === from ? { ...l, slug: to } : l)) }
          : c,
      );
      await this.prisma.siteFooter.update({ where: { id: f.id }, data: { columns: cols as Prisma.InputJsonValue } });
    }
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
