/**
 * SEO & URLs (Platform Admin › SEO & URLs) on the dealer websites:
 *   · asks the backend how to answer an address (clean page address, clean vehicle address, 301, or nothing special)
 *   · writes the page's <title>, description, canonical and OpenGraph tags into the server-rendered HTML
 *   · points the design's links (used-cars.html, vehicle.html?id=…, #/vehicle/…) at the clean addresses
 * Every step is optional: when the backend has no SEO data (or is an older version) the page is returned unchanged.
 */
import { backend, securityHeaders } from './backend';
import { h } from './php';
import { outsideScripts } from './spa';
import type { Theme } from './engine';

export interface SeoMeta {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonicalUrl: string;
  /** Platform Admin › Pages & URLs › Main keyword → <meta name="keywords"> */
  keywords?: string;
  /** Platform Admin › Pages & URLs › Schema markup (JSON-LD) → <script type="application/ld+json"> */
  schemaMarkup?: string;
}

export interface SeoLinks {
  /** first part of every vehicle address: /<base>/<slug> */
  base: string;
  /** design address ("used-cars.html", "financing") → clean address ("/used-cars-for-sale") */
  pages: Record<string, string>;
}

export type SeoResolve =
  /** manual = a URL Redirects rule (Platform Admin › SEO & URLs): sent exactly to `to` with its own status */
  | { type: 'redirect'; to: string; status: 301 | 302 | 307; manual?: boolean; links: SeoLinks }
  /** a URL Redirects rule of type 410: the address was removed for good */
  | { type: 'gone'; links: SeoLinks }
  | { type: 'page'; page: { key: string; path: string; meta: SeoMeta }; links: SeoLinks }
  | { type: 'vehicle'; vehicle: { id: string; publicId: string; slug: string; path: string; meta: SeoMeta }; links: SeoLinks }
  | { type: 'none'; links: SeoLinks };

/** Previews from the portals render exactly as before (no redirects, no rewriting). */
export function seoSkipped(url: URL): boolean {
  return ['pa_live', 'pa_theme_preview', 'pa_page_preview', 'theme'].some((k) => url.searchParams.has(k));
}

/** `search` = the address's whole query ("?dealer=1&id=2"): URL Redirects rules can match on it */
export async function resolveSeo(host: string, path: string, id?: string, search?: string): Promise<SeoResolve | null> {
  try {
    const query: Record<string, string> = { path };
    if (id) query.id = id;
    if (search && search !== '?') query.search = search.slice(0, 2000);
    const res = await backend('/public/seo/resolve', host, { query, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as SeoResolve;
    return data && typeof data === 'object' && 'type' in data && data.links ? data : null;
  } catch {
    return null;
  }
}

export interface SeoLinkData extends SeoLinks {
  vehicles: Record<string, string>;
  sitemap: { pages: { key: string; path: string }[]; vehicles: { path: string; updatedAt: string }[] };
}

export async function seoLinks(host: string): Promise<SeoLinkData | null> {
  try {
    const res = await backend('/public/seo/links', host, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as SeoLinkData;
  } catch {
    return null;
  }
}

/** A URL Redirects rule with type 301 / 302 / 307: exactly that status, to exactly the destination. */
export function ruleRedirect(to: string, status: 301 | 302 | 307): Response {
  const target = /^https?:\/\//i.test(to) ? to : '/' + to.replace(/^\/+/, '');
  return new Response(null, {
    status,
    // a relative Location keeps the visitor on the same host and port, behind any proxy
    headers: { Location: target, 'Cache-Control': status === 301 ? 'public, max-age=300' : 'no-store' },
  });
}

/**
 * A URL Redirects rule with type 410: "410 Gone" + noindex, so Google Search Console drops the address, with a
 * dealership-branded page and a button back to the inventory.
 */
export function gonePage(o: { name: string; logo: string; color: string; phone: string; tel: string; inventoryUrl: string }): Response {
  const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(o.color) ? o.color : '#1d4ed8';
  const name = o.name || 'Our dealership';
  const logo = o.logo ? `<img class="logo" src="${h(o.logo)}" alt="${h(name)}">` : `<div class="brand">${h(name)}</div>`;
  const call = o.phone && o.tel ? `<a class="ghost" href="tel:${h(o.tel)}">Call ${h(o.phone)}</a>` : '';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Page removed | ${h(name)}</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f4f6fa;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1b33;text-align:center;padding:32px 20px}
.card{background:#fff;border:1px solid #e3e8f0;border-radius:20px;box-shadow:0 10px 30px rgba(15,27,51,.06);padding:40px 32px;max-width:520px;width:100%}
.logo{max-height:56px;max-width:220px;object-fit:contain;margin:0 auto 24px;display:block}.brand{font-weight:800;font-size:20px;margin-bottom:24px;color:${color}}
.code{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color};background:${color}14;border-radius:999px;padding:4px 12px;margin-bottom:14px}
h1{font-size:26px;line-height:1.25;margin:0 0 10px}p{color:#5b6b85;margin:0 auto 28px;max-width:400px}
.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}a{text-decoration:none;font-weight:600;border-radius:12px;padding:12px 22px}
.btn{background:${color};color:#fff}.btn:hover{filter:brightness(1.08)}.ghost{border:1px solid #d5dce8;color:#0f1b33}.ghost:hover{background:#f4f6fa}
footer{margin-top:22px;font-size:13px;color:#8a97ad}</style></head>
<body><main class="card">${logo}<div class="code">410 · Removed</div><h1>This page or vehicle has been permanently removed</h1>
<p>The vehicle may have been sold, or the page no longer exists. Browse our current inventory to find something similar.</p>
<div class="actions"><a class="btn" href="${h(o.inventoryUrl || '/inventory')}">Browse inventory</a><a class="ghost" href="/">Home page</a>${call}</div></main>
<footer>&copy; ${new Date().getFullYear()} ${h(name)}</footer></body></html>`;
  return new Response(html, {
    status: 410,
    headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' }),
  });
}

/** "/uploads/x.jpg" or "uploads/x.jpg" → "https://dealer.com/uploads/x.jpg" */
export function absUrl(u: string, siteUrl: string): string {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return siteUrl.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
}

/**
 * JSON-LD text → safe contents for <script type="application/ld+json"> ("" when it is not a JSON object / list of
 * objects). Re-serialised, with "<", ">", "&" and line separators escaped so it can never close the script tag.
 */
export function jsonLd(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    const data = JSON.parse(text) as unknown;
    const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x);
    if (!(isObj(data) || (Array.isArray(data) && data.length > 0 && data.every(isObj)))) return '';
    return JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  } catch {
    return '';
  }
}

function setTag(head: string, find: RegExp, tag: string): string {
  return find.test(head) ? head.replace(find, () => tag) : head + tag;
}

/**
 * Writes the title / description / canonical / OpenGraph / keywords tags and the page's JSON-LD into <head>. Empty values keep the design's own
 * tags; `canonical` is always set (the page's clean address unless Platform Admin set another one).
 */
export function applyMeta(html: string, meta: Partial<SeoMeta>, canonical: string, siteUrl: string): string {
  const end = html.search(/<\/head\s*>/i);
  if (end < 0) return html;
  let head = html.slice(0, end);
  const rest = html.slice(end);
  const title = (meta.title || '').trim();
  const desc = (meta.description || '').trim();
  const ogTitle = (meta.ogTitle || title).trim();
  const ogDesc = (meta.ogDescription || desc).trim();
  const ogImage = absUrl((meta.ogImage || '').trim(), siteUrl);
  const canon = (meta.canonicalUrl || canonical).trim();

  if (title) head = setTag(head, /<title[^>]*>[\s\S]*?<\/title>/i, `<title>${h(title)}</title>`);
  if (desc) head = setTag(head, /<meta\s[^>]*name=["']description["'][^>]*>/i, `<meta name="description" content="${h(desc)}">`);
  if (canon) {
    head = setTag(head, /<link\s[^>]*rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${h(canon)}">`);
    head = setTag(head, /<meta\s[^>]*property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${h(canon)}">`);
  }
  if (ogTitle) {
    head = setTag(head, /<meta\s[^>]*property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${h(ogTitle)}">`);
    head = setTag(head, /<meta\s[^>]*name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${h(ogTitle)}">`);
  }
  if (ogDesc) {
    head = setTag(head, /<meta\s[^>]*property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${h(ogDesc)}">`);
    head = setTag(head, /<meta\s[^>]*name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${h(ogDesc)}">`);
  }
  if (ogImage) head = setTag(head, /<meta\s[^>]*property=["']og:image["'][^>]*>/i, `<meta property="og:image" content="${h(ogImage)}">`);
  const keywords = (meta.keywords || '').trim();
  if (keywords) head = setTag(head, /<meta\s[^>]*name=["']keywords["'][^>]*>/i, `<meta name="keywords" content="${h(keywords)}">`);
  const ld = jsonLd(meta.schemaMarkup);
  if (ld) head += `<script type="application/ld+json" data-pa-schema>${ld}</script>`;
  return head + rest;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Static links in the HTML (menus, footers, breadcrumbs): href="used-cars.html" → href="/used-cars-for-sale" */
export function rewriteStaticLinks(html: string, links: SeoLinks): string {
  const entries = Object.entries(links.pages || {}).filter(([from, to]) => from && to && to !== '/' + from);
  if (!entries.length) return html;
  const map = new Map(entries.map(([from, to]) => [from.toLowerCase(), to]));
  const alt = entries.map(([from]) => escRe(from)).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp(`(<a\\s[^>]*?href=)(["'])(?:\\.\\/|\\/)?(${alt})((?:[?#][^"']*)?)\\2`, 'gi');
  return outsideScripts(html, (part) =>
    part.replace(re, (_m, pre: string, q: string, from: string, tail: string) => `${pre}${q}${h(map.get(from.toLowerCase()) || '/' + from)}${tail}${q}`),
  );
}

/** Puts `snippet` right after <head …> (before the design's own scripts). */
export function injectHead(html: string, snippet: string): string {
  if (!snippet) return html;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + snippet) : snippet + html;
}

const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Scripts for the top of <head> (link rewriting and single-page designs: lib/spa.ts runtimeScript):
 *  · base      — <base href="/"> for addresses with a "/" (/inventory/2022-ford-f150) so the design's relative
 *                files (themes/…, inventory.json, api/lead.php) still load
 *  · vehicleId — the design's vehicle page reads ?id= from the address; on a clean address it gets the id here
 */
export function headScripts(o: { base?: boolean; vehicleId?: string }): string {
  let out = '';
  if (o.base) out += '<base href="/">';
  if (o.vehicleId) {
    out +=
      `<script data-pa>(function(){var I=${js(o.vehicleId)},U=window.URLSearchParams;window.PA_VEHICLE_ID=I;if(!U)return;` +
      `function P(i){var p=new U(i);try{if(i===location.search&&!p.get("id"))p.set("id",I)}catch(e){}return p}` +
      `P.prototype=U.prototype;try{Object.setPrototypeOf(P,U)}catch(e){}window.URLSearchParams=P})();</script>`;
  }
  return out;
}

/* ───────────────── clean addresses for every design page (no .html) ───────────────── */

/** design pages that are opened with ?id= and have their own clean address (vehicles: /inventory/<slug>) */
const NO_DEFAULT_CLEAN = new Set(['index.html', 'vehicle.html']);
/** design page names whose clean address differs from the file name */
const CLEAN_ALIAS: Record<string, string> = { about: 'about-us' };

/** "contact-us.html" → "/contact-us", "about.html" → "/about-us" (when the design has no about-us.html) */
export function defaultCleanPath(template: string, templates: Set<string>): string {
  const base = template.replace(/\.html?$/i, '').toLowerCase();
  const alias = CLEAN_ALIAS[base];
  return '/' + (alias && !templates.has(alias + '.html') ? alias : base);
}

/**
 * Every link map the website uses: design address → clean address. Addresses set in Platform Admin › SEO & URLs
 * win; every other design page gets its file name without .html (/inventory, /blog, /about-us, /financing …).
 */
export function cleanPages(theme: Theme | null | undefined, links: SeoLinks): Record<string, string> {
  const out: Record<string, string> = {};
  const pages = theme?.manifest.pages || [];
  const templates = new Set(pages.map((p) => String(p.template || '').toLowerCase()));
  for (const p of pages) {
    const t = String(p.template || '').toLowerCase();
    if (!t.endsWith('.html') || NO_DEFAULT_CLEAN.has(t) || t.includes('/')) continue;
    out[t] = defaultCleanPath(t, templates);
  }
  for (const [from, to] of Object.entries(links.pages || {})) out[from.toLowerCase()] = to;
  return out;
}

/** the design template shown at a clean address ("/blog" → "blog.html"), or null */
export function templateForPath(theme: Theme, pages: Record<string, string>, rawPath: string): string | null {
  const want = '/' + rawPath.toLowerCase().replace(/^\/+|\/+$/g, '');
  if (want === '/') return null;
  const own = new Set((theme.manifest.pages || []).map((p) => String(p.template || '').toLowerCase()));
  for (const [from, to] of Object.entries(pages)) if (own.has(from) && to.toLowerCase() === want) return from;
  return null;
}
