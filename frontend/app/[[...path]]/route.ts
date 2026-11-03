/**
 * FRONT CONTROLLER — port of the old index.php. The request host decides WHICH dealership is served.
 *   /  /index.html  /used-cars.html …   → original theme page with the dealership's content
 *   /inventory.json                     → that dealership's published inventory (original format)
 *   /logo  /images/logo.png             → the dealer's logo, or the neutral "YOUR LOGO" badge
 *   /sitemap.xml  /robots.txt           → generated per dealership
 * Photos (/uploads/…) are passed to the backend (next.config.ts), theme assets come from public/themes/.
 */
import { backend, hostOf, originOf, securityHeaders, siteErrorPage, statePage } from '@/lib/backend';
import { loadTheme, themesInstalled } from '@/lib/engine';
import { renderPage, type ThemeContext } from '@/lib/page';
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

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path?: string[] }> };

const LOGO_BADGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80"><rect x="2" y="2" width="296" height="76" rx="14" fill="rgba(140,150,166,.14)" stroke="#8C96A6" stroke-width="2.5" stroke-dasharray="9 7"/>' +
  '<g fill="none" stroke="#8C96A6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="26" y="22" width="40" height="36" rx="6"/><circle cx="38" cy="34" r="4"/><path d="m26 52 12-10 9 7 7-5 12 10"/></g>' +
  '<text x="84" y="50" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="700" letter-spacing="3" fill="#8C96A6">YOUR LOGO</text></svg>';

async function context(host: string, previewTheme?: string) {
  const res = await backend('/public/theme-context', host, { query: previewTheme ? { theme: previewTheme } : {} });
  if (!res.ok) return { error: res };
  return { ctx: await res.json() };
}

/** menu links for the published custom pages (Platform Admin › Pages & SEO) that are "shown in the menu" */
function navItems(ctx: ThemeContext): NavItem[] {
  return (ctx.pages || []).filter((p) => p.showInNav).map((p) => ({ slug: p.slug, label: p.navLabel || p.title }));
}

/** a custom page: published copy, or the draft with ?pa_page_preview=<token> from Platform Admin */
async function customPage(req: Request, url: URL, host: string, slug: string) {
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
  const html = renderCustomPage(ctx, theme, data.page, originOf(req), { vehicles, navPages: navItems(ctx), themePreview, preview: data.preview });
  return new Response(html, {
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': data.preview || themePreview ? 'no-store' : 'no-cache' }),
  });
}

export async function GET(req: Request, { params }: Ctx) {
  const url = new URL(req.url);
  const host = hostOf(req);
  let r = decodeURIComponent((await params).path?.join('/') || '').replace(/^\/+/, '');
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
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const p of theme.manifest.pages || []) {
      if (!p.sitemap) continue;
      const u = t.site_url + '/' + (p.template === 'index.html' ? '' : p.template);
      xml += `  <url><loc>${u.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')}</loc></url>\n`;
    }
    for (const p of (ctx as ThemeContext).pages || []) {
      if (p.noindex) continue;
      xml += `  <url><loc>${(t.site_url + '/' + p.slug).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</loc></url>\n`;
    }
    return new Response(xml + '</urlset>\n', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  /* ---------------- custom pages: /financing (or /financing.html when no theme page has that name) ---------------- */
  if (/^[a-z0-9][a-z0-9-]*$/.test(r)) return customPage(req, url, host, r);

  /* ---------------- theme pages ---------------- */
  if (!/^[a-z0-9][a-z0-9\-]*\.html$/.test(r)) return statePage(404, 'Page not found', 'The page you are looking for does not exist.');

  // admin "Design & colours" preview: ?pa_theme_preview=<design>  (also ?theme=<design>)
  const requested = url.searchParams.get('pa_theme_preview') || url.searchParams.get('theme') || '';
  const themePreview = /^[a-z0-9][a-z0-9-]{1,39}$/.test(requested) && !!themesInstalled()[requested];
  const { ctx, error } = await context(host, themePreview ? requested : undefined);
  if (error) return siteErrorPage(error);

  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const page = (theme.manifest.pages || []).find((p) => p.template === r);
  if (!page) return customPage(req, url, host, r.replace(/\.html$/, ''));

  // ?pa_live=1 — live preview inside the Dealership Portal editors (texts / colours update while typing)
  const live = url.searchParams.get('pa_live') === '1';
  // menu links of the custom pages (not in the editor preview: the dealer edits the theme's own texts there)
  const html = injectNav(renderPage(ctx, theme, r, originOf(req), themePreview, live), theme, live ? [] : navItems(ctx));
  return new Response(html, {
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': themePreview || live ? 'no-store' : 'no-cache' }),
  });
}
