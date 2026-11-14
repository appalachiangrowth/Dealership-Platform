/**
 * FRONT CONTROLLER — port of the old index.php. The request host decides WHICH dealership is served.
 *   /  /index.html  /used-cars.html …   → original theme page with the dealership's content
 *   /inventory.json                     → that dealership's published inventory (original format)
 *   /logo  /images/logo.png             → the dealer's logo, or the neutral "YOUR LOGO" badge
 *   /sitemap.xml  /robots.txt           → generated per dealership
 *   /used-cars-for-sale  /inventory/2022-ford-f150-lariat … → clean addresses from Platform Admin › SEO & URLs
 *                                         (old addresses answer with a 301; see lib/seo.ts)
 * Photos (/uploads/…) are passed to the backend (next.config.ts), theme assets come from public/themes/.
 */
import { backend, hostOf, originOf, securityHeaders, siteErrorPage, statePage, withTenant } from '@/lib/backend';
import { loadTheme, themesInstalled, type Theme } from '@/lib/engine';
import { renderPage, type ThemeContext } from '@/lib/page';
import { applyMeta, headScripts, injectHead, resolveSeo, rewriteStaticLinks, seoLinks, seoSkipped, type SeoMeta, type SeoResolve } from '@/lib/seo';
import { rewriteHashLinks, runtimeScript, spaConf, spaHashForKey, spaMatch, virtualizeHtml, virtualizeJs } from '@/lib/spa';
import { injectNav, renderCustomPage, type CustomPage, type NavItem } from '@/lib/custom-pages';
import { rel, siteTokens } from '@/lib/tokens';
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
  /** design template being shown (index.html of a single-page design = its shell) */
  template?: string;
  /** view a single-page design opens: hash or vehicle id */
  init?: { h?: string; v?: string };
};

const customSlugs = (ctx: ThemeContext) => new Set((ctx.pages || []).map((p) => String(p.slug).toLowerCase()));

/**
 * title / description / canonical, clean links (pages, vehicles, index.html#… and single-page views), the virtual hash
 * for single-page designs (lib/spa.ts) and the small helper scripts. Nothing changes when SEO data is unavailable.
 */
async function finishHtml(html: string, ctx: ThemeContext, theme: Theme, host: string, origin: string, o?: SeoOpts): Promise<string> {
  if (!o?.seo) return html;
  const site = siteTokens(ctx.settings, origin).site_url;
  let out = html;
  if (o.path !== undefined) out = applyMeta(out, o.meta || {}, site + '/' + o.path, site);
  out = rewriteStaticLinks(out, o.seo.links);
  const conf = spaConf(theme, o.seo.links, customSlugs(ctx));
  out = rewriteHashLinks(out, conf);
  let vehicles: Record<string, string> | null = null;
  if (conf) {
    out = virtualizeHtml(out);
    vehicles = (await seoLinks(host))?.vehicles || {};
  }
  const shell = !!conf && (o.template || '') === 'index.html';
  return injectHead(
    out,
    headScripts({ base: !!o.path && o.path.includes('/'), vehicleId: o.vehicleId }) +
      runtimeScript({ conf, links: o.seo.links, vehicles, shell, init: shell ? o.init : null }),
  );
}

/** 301 / 302 to a clean address on this website (keeps ?utm_… and ?tenant=, drops the old ?id=) */
function redirectTo(_req: Request, url: URL, to: string, status: 301 | 302) {
  const q = new URLSearchParams(url.search);
  q.delete('id');
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

/** a design page rendered for a clean address */
async function themeResponse(req: Request, host: string, ctx: ThemeContext, theme: Theme, template: string, o: SeoOpts) {
  const origin = originOf(req);
  const t = siteTokens(ctx.settings, origin);
  const html = injectNav(renderPage(ctx, theme, template, origin, false, false), theme, navItems(ctx), '', t);
  const out = await finishHtml(html, ctx, theme, host, origin, { ...o, template });
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
  const conf = spaConf(theme, seo.links, slugs);
  if (!conf) return null;
  const m = spaMatch(conf, lowPath, url.search);
  if (!m) return null;
  if ('redirect' in m) return redirectTo(req, url, m.redirect, 301);
  const route = conf.routes.find((r) => m.hash.split('?')[0] === r.h);
  return themeResponse(req, host, ctx, theme, 'index.html', { seo, path: lowPath, meta: viewMeta(ctx, route?.k || ''), init: { h: m.hash } });
}

async function seoPage(req: Request, url: URL, host: string, seo: Extract<SeoResolve, { type: 'page' }>) {
  const { key, path, meta } = seo.page;
  if (key.startsWith('custom:')) return customPage(req, url, host, key.slice('custom:'.length), { seo, meta, path });
  const { ctx, error } = await context(host);
  if (error) return siteErrorPage(error);
  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const own = key === 'home' ? { template: 'index.html' } : (theme.manifest.pages || []).find((p) => p.id === key);
  if (own) return themeResponse(req, host, ctx, theme, own.template, { seo, meta, path });
  // a single-page design: the page is a view of its home page
  const conf = spaConf(theme, seo.links, customSlugs(ctx));
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
  });
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
  let html = renderCustomPage(ctx, theme, data.page, originOf(req), { vehicles, navPages: navItems(ctx), themePreview, preview: data.preview });
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
    return new Response(await res.text(), {
      headers: securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' }),
    });
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
    const at = (def: string) => (clean[def.toLowerCase()] ? clean[def.toLowerCase()].replace(/^\/+/, '') : def);
    const xmlEsc = (u: string) => u.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const seen = new Set<string>();
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    const add = (path: string, lastmod?: string) => {
      const u = t.site_url + '/' + path.replace(/^\/+/, '');
      if (seen.has(u)) return;
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
    return new Response(xml + '</urlset>\n', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  /* ---------------- SEO & URLs: clean addresses, 301s for old ones, titles / descriptions ---------------- */
  // /index.html → / (a #view after it is kept by the browser and turned into its clean address on the page)
  if ((rawPath === 'index.html' || rawPath === 'index.php') && !seoSkipped(url)) return redirectTo(req, url, '/', 301);
  const seo = seoSkipped(url) ? null : await resolveSeo(host, rawPath, r === 'vehicle.html' ? url.searchParams.get('id') || undefined : undefined);
  if (seo?.type === 'redirect') return redirectTo(req, url, seo.to, seo.status);
  if (seo?.type === 'vehicle') return vehiclePage(req, host, seo);
  if (seo?.type === 'page') return seoPage(req, url, host, seo);
  if (seo && /^[a-z0-9][a-z0-9\-\/.]*$/i.test(rawPath)) {
    const spa = await spaRoute(req, url, host, rawPath, seo);
    if (spa) return spa;
  }

  /* ---------------- custom pages: /financing (or /financing.html when no theme page has that name) ---------------- */
  if (/^[a-z0-9][a-z0-9-]*$/.test(r)) return customPage(req, url, host, r, { seo });

  /* ---------------- theme pages ---------------- */
  if (!/^[a-z0-9][a-z0-9\-]*\.html$/.test(r)) return statePage(404, 'Page not found', 'The page you are looking for does not exist.');

  // admin "Design & colours" preview: ?pa_theme_preview=<design>  (also ?theme=<design>)
  const requested = url.searchParams.get('pa_theme_preview') || url.searchParams.get('theme') || '';
  const themePreview = /^[a-z0-9][a-z0-9-]{1,39}$/.test(requested) && !!themesInstalled()[requested];
  const { ctx, error } = await context(host, themePreview ? requested : undefined);
  if (error) return siteErrorPage(error);

  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const page = (theme.manifest.pages || []).find((p) => p.template === r);
  if (!page) return customPage(req, url, host, r.replace(/\.html$/, ''), { seo });

  // ?pa_live=1 — live preview inside the Dealership Portal editors (texts / colours update while typing)
  const live = url.searchParams.get('pa_live') === '1';
  // menu links of the custom pages (not in the editor preview: the dealer edits the theme's own texts there)
  let html = injectNav(renderPage(ctx, theme, r, originOf(req), themePreview, live), theme, live ? [] : navItems(ctx), '', siteTokens(ctx.settings, originOf(req)));
  if (!themePreview && !live) html = await finishHtml(html, ctx, theme, host, originOf(req), { seo, template: r });
  return new Response(html, {
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': themePreview || live ? 'no-store' : 'no-cache' }),
  });
}
