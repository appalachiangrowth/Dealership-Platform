/**
 * FRONT CONTROLLER — port of the old index.php. The request host decides WHICH dealership is served.
 *   /  /index.html  /used-cars.html …   → original theme page with the dealership's content
 *   /inventory.json                     → that dealership's published inventory (original format)
 *   /logo  /images/logo.png             → the dealer's logo, or the neutral "YOUR LOGO" badge
 *   /favicon.ico                        → the dealer's favicon (Business details), or a neutral icon (never a 404)
 *   /sitemap.xml  /robots.txt           → generated per dealership
 *   /used-cars-for-sale  /inventory/2022-ford-f150-lariat … → clean addresses from Platform Admin › SEO & URLs
 *                                         (old addresses answer with a 301; see lib/seo.ts)
 *   /inventory  /blog  /about-us  /contact-us … → every design page without .html (inventory.html → 301 → /inventory)
 * Photos (/uploads/…) are passed to the backend (next.config.ts), theme assets come from public/themes/.
 */
import { backend, hostOf, originOf, securityHeaders, siteErrorPage, statePage, withTenant } from '@/lib/backend';
import { loadTheme, themesInstalled, type Theme } from '@/lib/engine';
import { renderPage, type ThemeContext } from '@/lib/page';
import { absUrl, applyMeta, BLOG_POST_RE, blogPostPath, cleanPages, gonePage, headScripts, injectHead, resolveSeo, rewriteBlogLinks, rewriteStaticLinks, ruleRedirect, seoLinks, seoSkipped, templateForPath, type SeoLinks, type SeoMeta, type SeoResolve } from '@/lib/seo';
import { outsideScripts, rewriteHashLinks, runtimeScript, spaConf, spaHashForKey, spaMatch, virtualizeHtml, virtualizeJs } from '@/lib/spa';
import { allOn, blockedPaths, featureCss, featureOfPage, flagsOf, hideFeatures, hrefBlocked, markRoot, offText, themeFeatures } from '@/lib/features';
import { injectNav, renderCustomPage, type CustomPage, type NavItem } from '@/lib/custom-pages';
import { rel, siteTokens } from '@/lib/tokens';
import { applyFavicon, applyMediaMeta, cleanInventoryPosts, faviconResponse, richPostRuntime } from '@/lib/site-extras';
import { activityTrackerScript } from '@/lib/activity-tracker';
import { FIXED_TENANT } from '@/lib/backend';
import { existsSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, normalize } from 'path';

const MIME: Record<string, string> = {
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream',
};

async function themeAsset(r: string) {
  const root = join(process.cwd(), 'public');
  const file = normalize(join(root, r));
  const ext = (r.split('.').pop() || '').toLowerCase();
  if (!file.startsWith(join(root, 'themes')) || !/^themes\/[a-z0-9][a-z0-9-]*\/\d+\.\d+\.\d+\/assets\//.test(r) || !MIME[ext] || !existsSync(file) || !statSync(file).isFile()) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(new Uint8Array(await readFile(file)), { headers: { 'Content-Type': MIME[ext], 'Cache-Control': 'public, max-age=2592000', 'X-Content-Type-Options': 'nosniff' } });
}

/** a design script with location.hash → virtual hash (single-page designs, lib/spa.ts); kept in memory per file version */
const spaJs = new Map<string, { at: number; body: string }>();
async function spaAsset(r: string) {
  const root = join(process.cwd(), 'public');
  const file = normalize(join(root, r));
  if (!file.startsWith(join(root, 'themes')) || !/^themes\/[a-z0-9][a-z0-9-]*\/\d+\.\d+\.\d+\/assets\/[a-z0-9_\-\/.]+\.js$/i.test(r) || r.includes('..') || !existsSync(file)) {
    return new Response('Not found', { status: 404 });
  }
  const st = statSync(file);
  if (!st.isFile()) return new Response('Not found', { status: 404 });
  let hit = spaJs.get(file);
  if (!hit || hit.at !== st.mtimeMs) {
    hit = { at: st.mtimeMs, body: virtualizeJs(await readFile(file, 'utf8')) };
    spaJs.set(file, hit);
  }
  return new Response(hit.body, { headers: { 'Content-Type': MIME.js, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path?: string[] }> };

const LOGO_BADGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80"><rect x="2" y="2" width="296" height="76" rx="14" fill="rgba(140,150,166,.14)" stroke="#8C96A6" stroke-width="2.5" stroke-dasharray="9 7"/>' +
  '<g fill="none" stroke="#8C96A6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="26" y="22" width="40" height="36" rx="6"/><circle cx="38" cy="34" r="4"/><path d="m26 52 12-10 9 7 7-5 12 10"/></g>' +
  '<text x="84" y="50" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" letter-spacing="3" fill="#8C96A6">YOUR LOGO</text></svg>';

async function context(host: string, previewTheme?: string) {
  // one request can need the context twice (clean single-page addresses): reuse it for 2 s
  const key = previewTheme ? '' : host;
  const hit = key ? ctxMemo.get(key) : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (hit && Date.now() - hit.at < 2000) return { ctx: hit.ctx as any };
  const res = await backend('/public/theme-context', host, { query: previewTheme ? { theme: previewTheme } : {} });
  if (!res.ok) return { error: res };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (await res.json()) as any;
  if (key) {
    if (ctxMemo.size > 500) ctxMemo.clear();
    ctxMemo.set(key, { at: Date.now(), ctx });
  }
  return { ctx };
}
const ctxMemo = new Map<string, { at: number; ctx: ThemeContext }>();

/**
 * The header menu (Platform Admin › Pages & SEO › Header menu): top-level links and dropdowns. Without a saved menu
 * (or from an older API): the published custom pages that are "shown in the menu", in their order.
 */
function navItems(ctx: ThemeContext): NavItem[] {
  // Financing / Trade-In switched off in Platform Admin: their menu entries are left out
  const flags = flagsOf(ctx);
  if (allOn(flags)) return navItemsAll(ctx);
  const blocked = blockedPaths(flags, ctx);
  const keep = (n: NavItem): NavItem | null => {
    if ((n.slug && hrefBlocked(n.slug, flags, blocked)) || (n.url && hrefBlocked(n.url, flags, blocked)) || offText(n.label, flags)) return null;
    if (!n.children) return n;
    const children = n.children.map(keep).filter((c): c is NavItem => !!c);
    return children.length || n.slug || n.url ? { ...n, children: children.length ? children : undefined } : null;
  };
  return navItemsAll(ctx).map(keep).filter((n): n is NavItem => !!n);
}

function navItemsAll(ctx: ThemeContext): NavItem[] {
  if (Array.isArray(ctx.menu)) {
    const entry = (e: unknown, top: boolean): NavItem | null => {
      if (!e || typeof e !== 'object') return null;
      const o = e as { label?: unknown; slug?: unknown; url?: unknown; children?: unknown };
      const label = String(o.label || '').trim();
      if (!label) return null;
      const item: NavItem = { label };
      if (typeof o.slug === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(o.slug)) item.slug = o.slug;
      else if (typeof o.url === 'string' && o.url) item.url = o.url;
      if (top && Array.isArray(o.children)) {
        const kids = o.children.map((c) => entry(c, false)).filter((c): c is NavItem => !!c && !!(c.slug || c.url));
        if (kids.length) item.children = kids;
      }
      return item.slug || item.url || item.children ? item : null;
    };
    return ctx.menu.map((e) => entry(e, true)).filter((e): e is NavItem => !!e);
  }
  return (ctx.pages || []).filter((p) => p.showInNav).map((p) => ({ slug: p.slug, label: p.navLabel || p.title }));
}

/* ---------------- SEO & URLs ---------------- */

type SeoOpts = {
  seo: SeoResolve | null;
  meta?: SeoMeta;
  path?: string;
  vehicleId?: string;
  /** blog article shown on /blog/<slug>: the id the design's article page reads from ?id= */
  postId?: string;
  /** design template being shown (index.html of a single-page design = its shell) */
  template?: string;
  /** view a single-page design opens: hash or vehicle id */
  init?: { h?: string; v?: string };
  /** vehicle shown on this address, for the visitor activity tracker (lib/activity-tracker.ts) */
  track?: { vehicleId?: string; vehicleTitle?: string };
};

const NO_SEO: SeoLinks = { base: 'inventory', pages: {} };
/** the link map with every design page at its clean address (lib/seo.ts cleanPages) */
const cleanLinks = (theme: Theme | null, links?: SeoLinks | null): SeoLinks => {
  const l = links || NO_SEO;
  return { ...l, pages: cleanPages(theme, l) };
};

const customSlugs = (ctx: ThemeContext) => new Set((ctx.pages || []).map((p) => String(p.slug).toLowerCase()));

/**
 * title / description / canonical, clean links (pages, vehicles, index.html#… and single-page views), the virtual hash
 * for single-page designs (lib/spa.ts) and the small helper scripts. Nothing changes when SEO data is unavailable.
 */
async function finishHtml(html: string, ctx: ThemeContext, theme: Theme, host: string, origin: string, o?: SeoOpts): Promise<string> {
  // every public page (never the portal previews, which skip finishHtml) gets the visitor activity tracker;
  // the dealership is the one this site is pinned to (NEXT_PUBLIC_TENANT, lib/backend.ts) / resolved from the host
  const out = await finishPage(html, ctx, theme, host, origin, o);
  return injectHead(out, activityTrackerScript({ dealerSlug: ctx.tenant?.id || FIXED_TENANT, vehicleId: o?.track?.vehicleId, vehicleTitle: o?.track?.vehicleTitle }));
}

async function finishPage(html: string, ctx: ThemeContext, theme: Theme, host: string, origin: string, o?: SeoOpts): Promise<string> {
  // Financing / Trade-In switches (lib/features.ts): applied even when SEO data is unavailable
  const flags = flagsOf(ctx);
  const featuresOff = !allOn(flags);
  // every design page at its clean address (no .html); SEO & URLs settings win
  const links = cleanLinks(theme, o?.seo?.links);
  const blocked = blockedPaths(flags, ctx, links.pages, theme);
  const heuristics = themeFeatures(theme).heuristics;
  if (!o?.seo) {
    if (!featuresOff) return html;
    const out = markRoot(hideFeatures(html, flags, blocked, outsideScripts, heuristics), flags);
    return injectHead(out, featureCss(flags, theme) + runtimeScript({ conf: null, links, vehicles: {}, shell: false, flags, blocked, heuristics }));
  }
  const site = siteTokens(ctx.settings, origin).site_url;
  let out = html;
  if (o.path !== undefined) out = applyMeta(out, o.meta || {}, site + '/' + o.path, site);
  out = rewriteStaticLinks(rewriteBlogLinks(out), links);
  const conf = spaConf(theme, links, customSlugs(ctx), flags);
  out = rewriteHashLinks(out, conf);
  if (featuresOff) out = markRoot(hideFeatures(out, flags, blocked, outsideScripts, heuristics), flags);
  let vehicles: Record<string, string> | null = null;
  if (conf) {
    out = virtualizeHtml(out);
    vehicles = (await seoLinks(host))?.vehicles || {};
  }
  const shell = !!conf && (o.template || '') === 'index.html';
  return injectHead(
    out,
    headScripts({ base: !!o.path && o.path.includes('/'), vehicleId: o.vehicleId, postId: o.postId }) +
      featureCss(flags, theme) +
      runtimeScript({ conf, links, vehicles, shell, init: shell ? o.init : null, flags, blocked, heuristics }),
  );
}

/**
 * Old design addresses: /blog.html, /inventory.html?type=suv, /financing.html (a Pages & SEO page) → 301 to the clean
 * address (/blog, /inventory?type=suv, /financing). The query is kept (blog-post.html?id=7 → /blog-post?id=7).
 */
async function htmlRedirect(req: Request, url: URL, host: string, rawPath: string, seo: SeoResolve) {
  const { ctx, error } = await context(host);
  if (error) return null;
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const file = rawPath.toLowerCase();
  const pages = cleanLinks(theme, seo.links).pages;
  if ((theme.manifest.pages || []).some((p) => String(p.template).toLowerCase() === file)) {
    return pages[file] ? redirectTo(req, url, pages[file], 301, true) : null;
  }
  const slug = file.replace(/\.html?$/, '');
  if (customSlugs(ctx).has(slug)) return redirectTo(req, url, pages[slug] || '/' + slug, 301, true);
  return null;
}

/** a clean address of a design page (/blog → blog.html), with its title / description from SEO & URLs */
async function cleanThemePage(req: Request, host: string, rawPath: string, seo: SeoResolve) {
  const { ctx, error } = await context(host);
  if (error) return null;
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const template = templateForPath(theme, cleanLinks(theme, seo.links).pages, rawPath);
  if (!template) return null;
  // the page's SEO & URLs texts (an API from before clean addresses only knows the design address)
  const res = await resolveSeo(host, template);
  const meta = res?.type === 'page' ? res.page.meta : undefined;
  return themeResponse(req, host, ctx, theme, template, { seo, meta, path: rawPath.toLowerCase().replace(/^\/+|\/+$/g, '') });
}

/**
 * A page of a storefront feature switched off in Platform Admin (Financing / Trade-In): 302 to the home page.
 * 302, not 301, so turning the feature back on works at once.
 */
async function featureRedirect(req: Request, url: URL, host: string, rawPath: string, cleanPages: Record<string, string> = {}) {
  const { ctx, error } = await context(host);
  if (error) return null;
  const flags = flagsOf(ctx);
  if (allOn(flags)) return null;
  const p = rawPath.toLowerCase().replace(/^\/+|\/+$/g, '');
  let theme: Theme | null = null;
  try {
    theme = loadTheme(ctx.theme.id, ctx.theme.version);
  } catch {
    /* design files missing: names only */
  }
  return p && blockedPaths(flags, ctx, cleanLinks(theme, { base: '', pages: cleanPages }).pages, theme).has(p) ? redirectTo(req, url, '/', 302) : null;
}

/** 301 / 302 to a clean address on this website (keeps ?utm_… and ?tenant=, drops the old ?id=) */
function redirectTo(_req: Request, url: URL, to: string, status: 301 | 302 | 307, keepId = false) {
  const q = new URLSearchParams(url.search);
  if (!keepId) q.delete('id');
  const qs = q.toString();
  const target = to.startsWith('/') ? to : '/' + to;
  const hi = target.indexOf('#');
  const where = (hi < 0 ? target : target.slice(0, hi)) + (qs ? '?' + qs : '') + (hi < 0 ? '' : target.slice(hi));
  return new Response(null, {
    status,
    // a relative Location (allowed since RFC 7231) keeps the visitor on the same host and port, behind any proxy
    headers: { Location: where, 'Cache-Control': status === 301 ? 'public, max-age=300' : 'no-store' },
  });
}

/** 410 Gone (URL Redirects rule) with the dealership's name, logo and brand colour */
async function removedPage(req: Request, host: string, links: SeoLinks) {
  const { ctx } = await context(host);
  const s = (ctx?.settings || {}) as Record<string, unknown>;
  const t = siteTokens(s, originOf(req));
  const logo = rel(String(s.logo || ''));
  const colors = (ctx?.colors || {}) as Record<string, string>;
  let inventoryUrl = '/' + (links?.base || 'inventory');
  try {
    // the inventory page's own address when SEO & URLs gave it one
    if (ctx) {
      const theme = loadTheme(ctx.theme.id, ctx.theme.version);
      const pages = cleanLinks(theme, links).pages;
      inventoryUrl = pages['inventory.html'] || pages['inventory'] || inventoryUrl;
    }
  } catch {
    /* keep /inventory */
  }
  return gonePage({
    name: t.name,
    logo: logo && logo !== 'images/logo.png' ? (/^https?:\/\//i.test(logo) ? logo : '/' + logo.replace(/^\/+/, '')) : '',
    color: colors.primary || colors.accent || '',
    phone: t.phone,
    tel: t.tel,
    inventoryUrl,
  });
}

/** a design page rendered for a clean address */
async function themeResponse(req: Request, host: string, ctx: ThemeContext, theme: Theme, template: string, o: SeoOpts) {
  const origin = originOf(req);
  const t = siteTokens(ctx.settings, origin);
  const html = applyMediaMeta(applyFavicon(injectNav(renderPage(ctx, theme, template, origin, false, false), theme, navItems(ctx), '', t), ctx.settings?.faviconUrl), ctx.mediaMeta);
  // rich text blog articles: shown formatted in place of the design's plain paragraphs (lib/site-extras.ts)
  const out = injectHead(await finishHtml(html, ctx, theme, host, origin, { ...o, template }), richPostRuntime());
  return new Response(out, { headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }) });
}

/** the design's own title / description of a single-page view (seo.about.title …), for the server-rendered head */
function viewMeta(ctx: ThemeContext, key: string): SeoMeta {
  const group = ({ 'about-us': 'about', 'contact-us': 'contact', inventory: 'inventory', blog: 'blog' } as Record<string, string>)[key];
  const pick = (k: string) => {
    const v = String(ctx.values?.[k] || '').trim();
    return v && !v.includes('{') ? v : '';
  };
  return { title: group ? pick(`seo.${group}.title`) : '', description: group ? pick(`seo.${group}.description`) : '', ogTitle: '', ogDescription: '', ogImage: '', canonicalUrl: '' };
}

/**
 * Single-page designs: /about-us, /inventory, /contact, /blog/<post>, /financing … open the right view of the home
 * page (virtual hash, lib/spa.ts); older addresses of those views answer with a 301.
 */
async function spaRoute(req: Request, url: URL, host: string, rawPath: string, seo: SeoResolve) {
  if (!rawPath || rawPath.includes('..')) return null;
  const { ctx, error } = await context(host);
  if (error) return null;
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const slugs = customSlugs(ctx);
  const lowPath = rawPath.toLowerCase().replace(/\/+$/, '');
  if (slugs.has(lowPath) || (theme.manifest.pages || []).some((p) => p.template === lowPath)) return null;
  const conf = spaConf(theme, cleanLinks(theme, seo.links), slugs, flagsOf(ctx));
  if (!conf) return null;
  const m = spaMatch(conf, lowPath, url.search);
  if (!m) return null;
  if ('redirect' in m) return redirectTo(req, url, m.redirect, 301);
  const route = conf.routes.find((r) => m.hash.split('?')[0] === r.h);
  return themeResponse(req, host, ctx, theme, 'index.html', { seo, path: lowPath, meta: viewMeta(ctx, route?.k || ''), init: { h: m.hash } });
}

async function seoPage(req: Request, url: URL, host: string, seo: Extract<SeoResolve, { type: 'page' }>) {
  const { key, path, meta } = seo.page;
  {
    // a page of a switched-off storefront feature (Financing / Trade-In) → home
    const { ctx: c } = await context(host);
    const slug = key.startsWith('custom:') ? key.slice('custom:'.length) : key;
    const title = (c?.pages || []).find((p: { slug: string; title: string }) => p.slug === slug)?.title || '';
    const k = featureOfPage(slug, title);
    if (c && k && !flagsOf(c)[k]) return redirectTo(req, url, '/', 302);
  }
  if (key.startsWith('custom:')) return customPage(req, url, host, key.slice('custom:'.length), { seo, meta, path });
  const { ctx, error } = await context(host);
  if (error) return siteErrorPage(error);
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const own = key === 'home' ? { template: 'index.html' } : (theme.manifest.pages || []).find((p) => p.id === key);
  if (own) return themeResponse(req, host, ctx, theme, own.template, { seo, meta, path });
  // a single-page design: the page is a view of its home page
  const conf = spaConf(theme, cleanLinks(theme, seo.links), customSlugs(ctx), flagsOf(ctx));
  const hash = conf ? spaHashForKey(conf, key) : null;
  const fallback = viewMeta(ctx, key);
  const m = { ...meta, title: meta.title || fallback.title, description: meta.description || fallback.description };
  return themeResponse(req, host, ctx, theme, 'index.html', { seo, meta: m, path, init: hash ? { h: hash } : undefined });
}

async function vehiclePage(req: Request, host: string, seo: Extract<SeoResolve, { type: 'vehicle' }>) {
  const { ctx, error } = await context(host);
  if (error) return siteErrorPage(error);
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const own = (theme.manifest.pages || []).find((p) => p.id === 'vehicle' || p.template === 'vehicle.html');
  const { publicId, path, meta } = seo.vehicle;
  return themeResponse(req, host, ctx, theme, own ? own.template : 'index.html', {
    seo,
    meta,
    path,
    vehicleId: own ? publicId : undefined,
    // single-page designs open their vehicle view (virtual hash, lib/spa.ts)
    init: own ? undefined : { v: publicId },
    track: { vehicleId: seo.vehicle.id },
  });
}

/** the blog list's address (/blog, or the one set in SEO & URLs) */
async function blogListPath(host: string, seo: SeoResolve | null): Promise<string> {
  const { ctx } = await context(host);
  try {
    if (ctx) return cleanLinks(loadTheme(ctx.theme.id, ctx.theme.version), seo?.links).pages['blog.html'] || '/blog';
  } catch {
    /* design files missing */
  }
  return '/blog';
}

type PublicPost = { slug: string; title: string; excerpt?: string | null; coverImage?: string | null; metaTitle?: string | null; metaDescription?: string | null };

/**
 * A blog article at its clean address /blog/<slug>: the design's article page (blog-post.html) with the article's
 * title / description / canonical in <head>. An older address of the article (its id or imported id) answers with
 * a 301 to /blog/<slug>. null = the design has no article page (single-page designs open their blog view instead).
 */
async function blogPostPage(req: Request, url: URL, host: string, slug: string, seo: SeoResolve) {
  const { ctx, error } = await context(host);
  if (error) return siteErrorPage(error);
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const own = (theme.manifest.pages || []).find((p) => p.id === 'blog-post' || p.template === 'blog-post.html');
  if (!own) return null;
  const res = await backend(`/public/posts/${encodeURIComponent(slug)}`, host);
  if (res.status === 404) return statePage(404, 'Article not found', 'This article may have been removed or unpublished.');
  if (!res.ok) return siteErrorPage(res);
  const { post } = (await res.json()) as { post: PublicPost };
  if (post.slug && post.slug !== slug) return redirectTo(req, url, blogPostPath(post.slug), 301);
  const path = 'blog/' + post.slug;
  const site = siteTokens(ctx.settings, originOf(req)).site_url;
  const meta: SeoMeta = {
    title: (post.metaTitle || post.title || '').trim(),
    description: (post.metaDescription || post.excerpt || '').trim().slice(0, 320),
    ogTitle: post.title || '',
    ogDescription: (post.excerpt || '').trim().slice(0, 320),
    ogImage: post.coverImage ? absUrl(post.coverImage, site) : '',
    canonicalUrl: site + blogPostPath(post.slug),
  };
  return themeResponse(req, host, ctx, theme, own.template, { seo, meta, path, postId: post.slug });
}

/** a custom page: published copy, or the draft with ?pa_page_preview=<token> from Platform Admin */
async function customPage(req: Request, url: URL, host: string, slug: string, seoOpts?: SeoOpts) {
  const preview = url.searchParams.get('pa_page_preview') || '';
  const res = await backend(`/public/pages/${encodeURIComponent(slug)}`, host, { query: preview ? { preview } : {} });
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (body.code === 'unknown_site') return siteErrorPage(new Response(JSON.stringify(body), { status: 404 }));
    return statePage(404, 'Page not found', preview && body.message ? body.message : 'The page you are looking for does not exist.');
  }
  if (!res.ok) return siteErrorPage(res);
  const data = (await res.json()) as { page: CustomPage; preview: boolean };

  const requested = url.searchParams.get('pa_theme_preview') || url.searchParams.get('theme') || '';
  const themePreview = /^[a-z0-9][a-z0-9-]{1,39}$/.test(requested) && !!themesInstalled()[requested];
  const { ctx, error } = await context(host, themePreview ? requested : undefined);
  if (error) return siteErrorPage(error);
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);

  // inventory sections show the dealer's live vehicles (same list the theme pages use)
  let vehicles: Record<string, unknown>[] = [];
  if ((data.page.sections || []).some((s) => s && s.type === 'inventory')) {
    const inv = await backend('/public/inventory.json', host);
    if (inv.ok) vehicles = ((await inv.json()) as { vehicles?: Record<string, unknown>[] }).vehicles || [];
  }
  let html = applyMediaMeta(applyFavicon(renderCustomPage(ctx, theme, data.page, originOf(req), { vehicles, navPages: navItems(ctx), themePreview, preview: data.preview }), ctx.settings?.faviconUrl), ctx.mediaMeta);
  if (!data.preview && !themePreview) html = await finishHtml(html, ctx, theme, host, originOf(req), seoOpts);
  return new Response(html, {
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': data.preview || themePreview ? 'no-store' : 'no-cache' }),
  });
}

/** every answer keeps the dealership of a https://sites.…/?tenant=<id> visit (cookie + links), see withTenant */
export async function GET(req: Request, ctx: Ctx) {
  return withTenant(req, await page(req, ctx));
}

async function page(req: Request, { params }: Ctx) {
  const url = new URL(req.url);
  const host = hostOf(req);
  const rawPath = decodeURIComponent((await params).path?.join('/') || '').replace(/^\/+/, '');
  let r = rawPath;
  if (r === '' || r === 'index.php') r = 'index.html';

  /* design files installed from Platform Admin after the website was built (next start only serves public/ files that
     existed at build time): public/themes/<id>/<version>/assets/… */
  if (r.startsWith('themes/')) return themeAsset(r);

  /* ---------------- per-dealership files ---------------- */
  if (r === 'inventory.json') {
    const res = await backend('/public/inventory.json', host);
    if (!res.ok) return siteErrorPage(res);
    return new Response(cleanInventoryPosts(await res.text()), {
      headers: securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' }),
    });
  }

  if (r === 'favicon.ico') {
    const { ctx } = await context(host);
    return faviconResponse(ctx?.settings?.faviconUrl, url);
  }

  if (r === 'logo' || r === 'images/logo.png') {
    const { ctx, error } = await context(host);
    if (error) return siteErrorPage(error);
    const logo = rel(String(ctx.settings.logo || ''));
    if (logo && logo !== 'images/logo.png') return Response.redirect(new URL(logo.startsWith('http') ? logo : '/' + logo, url), 302);
    return new Response(LOGO_BADGE, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }

  /* the design's scripts for single-page designs, reading the virtual hash (lib/spa.ts) */
  if (r.startsWith('pa-spa/themes/')) return spaAsset(r.slice('pa-spa/'.length));

  /* title / description of one address, for single-page designs switching views: /pa-seo.json?path=/about-us */
  if (r === 'pa-seo.json' && url.searchParams.has('path')) {
    const p = String(url.searchParams.get('path') || '').replace(/^\/+/, '').slice(0, 300);
    const res = await resolveSeo(host, p);
    const meta = res?.type === 'page' ? res.page.meta : res?.type === 'vehicle' ? res.vehicle.meta : null;
    const body = meta ? { title: meta.title, description: meta.description, canonical: meta.canonicalUrl || originOf(req) + '/' + p } : {};
    return new Response(JSON.stringify(body), { headers: securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }) });
  }

  /* clean vehicle addresses for the link script (lib/spa.ts) */
  if (r === 'pa-seo.json') {
    const d = await seoLinks(host);
    return new Response(JSON.stringify(d ? { base: d.base, pages: d.pages, vehicles: d.vehicles } : { base: 'inventory', pages: {}, vehicles: {} }), {
      headers: securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' }),
    });
  }

  if (r === 'robots.txt' || r === 'sitemap.xml') {
    const { ctx, error } = await context(host);
    if (error) return siteErrorPage(error);
    const t = siteTokens(ctx.settings, originOf(req));
    if (r === 'robots.txt') {
      return new Response(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${t.site_url}/sitemap.xml\n`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    const theme = loadTheme(ctx.theme.id, ctx.theme.version);
    // clean addresses from Platform Admin › SEO & URLs (design addresses when there are none)
    const seo = await seoLinks(host);
    const clean = seo?.pages || {};
    // every design page at its clean address (no .html)
    const cmap = cleanPages(theme, { base: '', pages: clean });
    const at = (def: string) => (cmap[def.toLowerCase()] || '/' + def).replace(/^\/+/, '');
    const xmlEsc = (u: string) => u.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const seen = new Set<string>();
    // pages of storefront features switched off in Platform Admin (Financing / Trade-In) are left out
    const offPaths = blockedPaths(flagsOf(ctx), ctx, cmap, theme);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    const add = (path: string, lastmod?: string) => {
      const u = t.site_url + '/' + path.replace(/^\/+/, '');
      if (seen.has(u) || offPaths.has(path.replace(/^\/+/, '').toLowerCase())) return;
      seen.add(u);
      xml += `  <url><loc>${xmlEsc(u)}</loc>${lastmod ? `<lastmod>${xmlEsc(lastmod.slice(0, 10))}</lastmod>` : ''}</url>\n`;
    };
    for (const p of theme.manifest.pages || []) {
      if (!p.sitemap) continue;
      add(p.template === 'index.html' ? '' : at(p.template));
    }
    for (const p of (ctx as ThemeContext).pages || []) {
      if (p.noindex) continue;
      add(at(p.slug));
    }
    for (const p of seo?.sitemap.pages || []) add(p.path); // e.g. a single-page design's inventory with its own address
    for (const v of seo?.sitemap.vehicles || []) add(v.path, v.updatedAt);
    // published blog articles at /blog/<slug>
    try {
      const sm = await backend('/public/sitemap', host, { signal: AbortSignal.timeout(5000) });
      if (sm.ok) {
        const d = (await sm.json()) as { posts?: { slug: string; updatedAt?: string }[] };
        for (const p of d.posts || []) if (p.slug) add(blogPostPath(p.slug).slice(1), p.updatedAt);
      }
    } catch {
      /* sitemap without articles */
    }
    return new Response(xml + '</urlset>\n', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  /* ---------------- SEO & URLs: clean addresses, 301s for old ones, titles / descriptions ---------------- */
  // path + whole query: URL Redirects rules (Platform Admin › SEO & URLs) can match "/brochure?dealer=1&id=2"
  const seo = seoSkipped(url) ? null : await resolveSeo(host, rawPath, r === 'vehicle.html' ? url.searchParams.get('id') || undefined : undefined, url.search);
  // URL Redirects come before everything else: their exact status (301 / 302 / 307) to their destination, or 410 Gone
  if (seo?.type === 'gone') return removedPage(req, host, seo.links);
  if (seo?.type === 'redirect' && seo.manual) return ruleRedirect(seo.to, seo.status);
  // blog articles live at /blog/<slug>: older blog-post.html?id=<slug> and /blog-post?id=<slug> answer with a 301
  if (!seoSkipped(url) && BLOG_POST_RE.test(rawPath)) {
    const id = (url.searchParams.get('id') || '').trim();
    return redirectTo(req, url, id ? blogPostPath(id) : await blogListPath(host, seo), 301);
  }
  if (!seoSkipped(url) && /^blog\/[^/]+\/?$/i.test(rawPath)) {
    const article = await blogPostPage(req, url, host, rawPath.replace(/^blog\/|\/+$/gi, ''), seo ? (seo.type === 'redirect' ? { type: 'none', links: seo.links } : seo) : { type: 'none', links: NO_SEO });
    if (article) return article;
  }
  // /index.html → / (a #view after it is kept by the browser and turned into its clean address on the page)
  if ((rawPath === 'index.html' || rawPath === 'index.php') && !seoSkipped(url)) return redirectTo(req, url, '/', 301);
  if (!seoSkipped(url) && rawPath) {
    const off = await featureRedirect(req, url, host, rawPath);
    if (off) return off;
  }
  if (seo && seo.type !== 'redirect' && rawPath) {
    // a clean address set in SEO & URLs for a switched-off feature's page
    const off = await featureRedirect(req, url, host, rawPath, seo.links.pages);
    if (off) return off;
  }
  if (seo?.type === 'redirect') return redirectTo(req, url, seo.to, seo.status);
  // clean addresses work even with an API that has no SEO & URLs yet (previews keep the design's own addresses)
  const seoOn: SeoResolve | null = seo || (seoSkipped(url) ? null : { type: 'none', links: NO_SEO });
  if (seoOn && /^[a-z0-9][a-z0-9-]*\.html?$/i.test(rawPath) && rawPath.toLowerCase() !== 'vehicle.html') {
    const go = await htmlRedirect(req, url, host, rawPath, seoOn);
    if (go) return go;
  }
  if (seo?.type === 'vehicle') return vehiclePage(req, host, seo);
  if (seo?.type === 'page') return seoPage(req, url, host, seo);
  if (seoOn && rawPath && /^[a-z0-9][a-z0-9\-\/]*$/i.test(rawPath)) {
    const page = await cleanThemePage(req, host, rawPath, seoOn);
    if (page) return page;
  }
  if (seoOn && /^[a-z0-9][a-z0-9\-\/.]*$/i.test(rawPath)) {
    const spa = await spaRoute(req, url, host, rawPath, seoOn);
    if (spa) return spa;
  }

  /* ---------------- custom pages: /financing (or /financing.html when no theme page has that name) ---------------- */
  if (/^[a-z0-9][a-z0-9-]*$/.test(r)) return customPage(req, url, host, r, { seo: seoOn });

  /* ---------------- theme pages ---------------- */
  if (!/^[a-z0-9][a-z0-9\-]*\.html$/.test(r)) return statePage(404, 'Page not found', 'The page you are looking for does not exist.');

  // admin "Design & colours" preview: ?pa_theme_preview=<design>  (also ?theme=<design>)
  const requested = url.searchParams.get('pa_theme_preview') || url.searchParams.get('theme') || '';
  const themePreview = /^[a-z0-9][a-z0-9-]{1,39}$/.test(requested) && !!themesInstalled()[requested];
  const { ctx, error } = await context(host, themePreview ? requested : undefined);
  if (error) return siteErrorPage(error);

  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const page = (theme.manifest.pages || []).find((p) => p.template === r);
  if (!page) return customPage(req, url, host, r.replace(/\.html$/, ''), { seo: seoOn });

  // ?pa_live=1 — live preview inside the Dealership Portal editors (texts / colours update while typing)
  const live = url.searchParams.get('pa_live') === '1';
  // menu links of the custom pages (not in the editor preview: the dealer edits the theme's own texts there)
  let html = injectNav(renderPage(ctx, theme, r, originOf(req), themePreview, live), theme, live ? [] : navItems(ctx), '', siteTokens(ctx.settings, originOf(req)));
  if (!themePreview && !live) html = await finishHtml(html, ctx, theme, host, originOf(req), { seo: seoOn, template: r, path: r === 'index.html' ? '' : undefined });
  html = injectHead(applyMediaMeta(applyFavicon(html, ctx.settings?.faviconUrl), ctx.mediaMeta), richPostRuntime());
  return new Response(html, {
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': themePreview || live ? 'no-store' : 'no-cache' }),
  });
}
