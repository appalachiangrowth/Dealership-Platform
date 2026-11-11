/**
 * Builds one theme page exactly like the old index.php did: tokens, window.SITE, structured data,
 * design colours, preview bar, canonical/OG tags, then the template engine.
 */
import { colorVarMap, designCss, renderSource, renderTemplate, type Theme } from './engine';
import { liveScript } from './live';
import { h, jsonHex } from './php';
import { absSiteUrl, rel, siteTokens, siteTokensDisplay } from './tokens';

export interface ThemeContext {
  tenant: { id: string; name: string };
  theme: { id: string; version: string };
  values: Record<string, string>;
  settings: Record<string, any>;
  colors: Record<string, string>;
  features: Record<string, boolean>;
  /** published custom pages (Platform Admin › Pages & SEO): menu links + sitemap */
  pages?: { slug: string; title: string; navLabel: string; showInNav: boolean; navOrder: number; noindex: boolean }[];
}

/** Custom pages: render this template text instead of a theme file, at this address, with these extra values. */
export interface RenderOverride {
  source: string;
  path: string;
  raw?: Record<string, string>;
}

/** Dealership Portal + Platform Admin addresses that may drive the live preview (ADMIN_URL, comma-separated). */
export function adminOrigins(): string[] {
  const fromEnv = (process.env.ADMIN_URL || '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const defaults = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];
  return Array.from(new Set([...defaults, ...fromEnv]));
}

export function renderPage(ctx: ThemeContext, theme: Theme, r: string, origin: string, themePreview: boolean, live = false, override?: RenderOverride): string {
  const values: Record<string, string> = ctx.values || {};
  const realTokens = siteTokens(ctx.settings, origin);
  const tokens = siteTokensDisplay(realTokens, ctx.settings);

  // window.SITE (same keys and order as the old platform)
  const site: Record<string, unknown> = { ...tokens };
  delete site._missing;
  site.tenant = ctx.tenant.id;
  site.theme = { id: theme.id, version: theme.version, url: theme.url };
  site.features = { facebook: !!ctx.features.facebook, blog: !!ctx.features.blog };
  site.preview = false;

  // structured data for Google: real details only, never placeholders
  const rt = realTokens;
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    name: rt.name !== '' ? rt.name : null,
    url: rt.site_url + '/',
    telephone: rt.tel !== '' ? rt.tel : null,
    email: rt.email !== '' ? rt.email : null,
    priceRange: '$$',
    image: (/^https?:\/\//.test(rt.logo) ? '' : rt.site_url + '/') + rt.logo,
    address: { '@type': 'PostalAddress', streetAddress: rt.street, addressLocality: rt.city, addressRegion: rt.state, postalCode: rt.zip, addressCountry: rt.country },
  };
  for (const k of Object.keys(ld)) if (ld[k] === null) delete ld[k];
  if (rt.lat !== '' && rt.lng !== '') ld.geo = { '@type': 'GeoCoordinates', latitude: parseFloat(rt.lat) || 0, longitude: parseFloat(rt.lng) || 0 };
  const same = ['facebook', 'instagram', 'google', 'youtube', 'tiktok'].map((k) => rt[k]).filter((v) => v !== '');
  if (same.length) ld.sameAs = same;

  const raw: Record<string, string> = {
    DESIGN: designCss(theme, ctx.colors || {}),
    SITE_JSON: '<script>window.SITE=' + jsonHex(site) + ';</script>',
    LD_JSON: '<script type="application/ld+json">' + jsonHex(ld) + '</script>',
    ROBOTS: themePreview || live ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow">',
    PREVIEW_BAR: themePreview && !live
      ? '<div style="position:fixed;left:12px;bottom:12px;z-index:99999;background:#7c2d12;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:9px 12px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none">Theme preview — not activated</div>'
      : '',
    CANONICAL: h(tokens.site_url + '/' + (override ? override.path : r === 'index.html' ? '' : r)),
    OG_IMAGE: h(absSiteUrl(values['seo.home.share_image'] ? rel(values['seo.home.share_image']) : tokens.logo, tokens.site_url)),
  };
  if (override?.raw) Object.assign(raw, override.raw);

  const rctx = { values, tokens, raw, features: ctx.features || {}, live };
  const html = override ? renderSource(theme, override.source, rctx) : renderTemplate(theme, r, rctx);
  if (!live) return html;
  // editor preview: the portal can change texts / colours live and point at the text being edited
  const script = liveScript({ colorMap: colorVarMap(theme), origins: adminOrigins() });
  return /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, script + '</body>') : html + script;
}
