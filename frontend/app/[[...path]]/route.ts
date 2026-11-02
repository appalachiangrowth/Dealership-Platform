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
import { renderPage } from '@/lib/page';
import { rel, siteTokens } from '@/lib/tokens';

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

export async function GET(req: Request, { params }: Ctx) {
  const url = new URL(req.url);
  const host = hostOf(req);
  let r = decodeURIComponent((await params).path?.join('/') || '').replace(/^\/+/, '');
  if (r === '' || r === 'index.php') r = 'index.html';

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
    return new Response(xml + '</urlset>\n', { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }

  /* ---------------- theme pages ---------------- */
  if (!/^[a-z0-9][a-z0-9\-]*\.html$/.test(r)) return statePage(404, 'Page not found', 'The page you are looking for does not exist.');

  // admin "Design & colours" preview: ?pa_theme_preview=<design>  (also ?theme=<design>)
  const requested = url.searchParams.get('pa_theme_preview') || url.searchParams.get('theme') || '';
  const themePreview = /^[a-z0-9][a-z0-9-]{1,39}$/.test(requested) && !!themesInstalled()[requested];
  const { ctx, error } = await context(host, themePreview ? requested : undefined);
  if (error) return siteErrorPage(error);

  const theme = loadTheme(ctx.theme.id, ctx.theme.version);
  const page = (theme.manifest.pages || []).find((p) => p.template === r);
  if (!page) return statePage(404, 'Page not found', 'The page you are looking for does not exist.');

  // ?pa_live=1 — live preview inside the Dealership Portal editors (texts / colours update while typing)
  const live = url.searchParams.get('pa_live') === '1';
  const html = renderPage(ctx, theme, r, originOf(req), themePreview, live);
  return new Response(html, {
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': themePreview || live ? 'no-store' : 'no-cache' }),
  });
}
