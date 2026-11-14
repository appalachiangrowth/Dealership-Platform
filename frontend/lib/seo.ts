/**
 * SEO & URLs (Platform Admin › SEO & URLs) on the dealer websites:
 *   · asks the backend how to answer an address (clean page address, clean vehicle address, 301, or nothing special)
 *   · writes the page's <title>, description, canonical and OpenGraph tags into the server-rendered HTML
 *   · points the design's links (used-cars.html, vehicle.html?id=…, #/vehicle/…) at the clean addresses
 * Every step is optional: when the backend has no SEO data (or is an older version) the page is returned unchanged.
 */
import { backend } from './backend';
import { h } from './php';

export interface SeoMeta {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonicalUrl: string;
}

export interface SeoLinks {
  /** first part of every vehicle address: /<base>/<slug> */
  base: string;
  /** design address ("used-cars.html", "financing") → clean address ("/used-cars-for-sale") */
  pages: Record<string, string>;
}

export type SeoResolve =
  | { type: 'redirect'; to: string; status: 301 | 302; links: SeoLinks }
  | { type: 'page'; page: { key: string; path: string; meta: SeoMeta }; links: SeoLinks }
  | { type: 'vehicle'; vehicle: { id: string; publicId: string; slug: string; path: string; meta: SeoMeta }; links: SeoLinks }
  | { type: 'none'; links: SeoLinks };

/** Previews from the portals render exactly as before (no redirects, no rewriting). */
export function seoSkipped(url: URL): boolean {
  return ['pa_live', 'pa_theme_preview', 'pa_page_preview', 'theme'].some((k) => url.searchParams.has(k));
}

export async function resolveSeo(host: string, path: string, id?: string): Promise<SeoResolve | null> {
  try {
    const res = await backend('/public/seo/resolve', host, { query: { path, ...(id ? { id } : {}) }, signal: AbortSignal.timeout(4000) });
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

/** "/uploads/x.jpg" or "uploads/x.jpg" → "https://dealer.com/uploads/x.jpg" */
export function absUrl(u: string, siteUrl: string): string {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return siteUrl.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
}

function setTag(head: string, find: RegExp, tag: string): string {
  return find.test(head) ? head.replace(find, () => tag) : head + tag;
}

/**
 * Writes the title / description / canonical / OpenGraph tags into <head>. Empty values keep the design's own
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
  return html.replace(re, (_m, pre: string, q: string, from: string, tail: string) => `${pre}${q}${h(map.get(from.toLowerCase()) || '/' + from)}${tail}${q}`);
}

/** Puts `snippet` right after <head …> (before the design's own scripts). */
export function injectHead(html: string, snippet: string): string {
  if (!snippet) return html;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + snippet) : snippet + html;
}

const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Scripts for the top of <head>:
 *  · base   — <base href="/"> for addresses with a "/" (/inventory/2022-ford-f150) so the design's relative
 *             files (themes/…, inventory.json, api/lead.php) still load
 *  · vehicleId — the design's vehicle page reads ?id= from the address; on a clean address it gets the id here
 *  · hash   — single-page designs (Classic, VroomFox) open the right section (#/inventory, #/vehicle/<id> …)
 *  · links  — the design builds vehicle / page links in JavaScript: they are pointed at the clean addresses
 */
export function headScripts(o: { base?: boolean; vehicleId?: string; hash?: string; links?: SeoLinks | null }): string {
  let out = '';
  if (o.base) out += '<base href="/">';
  if (o.vehicleId) {
    out +=
      `<script>(function(){var I=${js(o.vehicleId)},U=window.URLSearchParams;window.PA_VEHICLE_ID=I;if(!U)return;` +
      `function P(i){var p=new U(i);try{if(i===location.search&&!p.get("id"))p.set("id",I)}catch(e){}return p}` +
      `P.prototype=U.prototype;try{Object.setPrototypeOf(P,U)}catch(e){}window.URLSearchParams=P})();</script>`;
  }
  if (o.hash) out += `<script>if(!location.hash)history.replaceState(history.state,"",location.pathname+location.search+${js(o.hash)});</script>`;
  if (o.links) {
    const pages = Object.fromEntries(Object.entries(o.links.pages || {}).map(([k, v]) => [k.toLowerCase(), v]));
    out +=
      `<script>(function(){var P=${js(pages)},B=${js(o.links.base || 'inventory')},V=null,busy=0;` +
      `function m(h){if(!h||/^(mailto:|tel:|sms:|javascript:|data:)/i.test(h))return null;try{var u=new URL(h,document.baseURI);if(u.origin!==location.origin)return null;` +
      `var p=u.pathname.replace(/^\\/+/,"").toLowerCase();` +
      `if(/(^|\\/)vehicle\\.html$/.test(p)){var id=u.searchParams.get("id");if(id&&V&&V[id]){u.searchParams.delete("id");return "/"+B+"/"+V[id]+u.search+u.hash}return null}` +
      `if(p===""||p==="index.html"){var x=/^#\\/vehicle\\/(.+)$/.exec(u.hash);if(x&&V){var k=decodeURIComponent(x[1]);if(V[k])return "/"+B+"/"+V[k]}return null}` +
      `if(P[p])return P[p]+u.search+u.hash}catch(e){}return null}` +
      `function f(a){var h=a.getAttribute("href"),n=m(h);if(n&&n!==h)a.setAttribute("href",n)}` +
      `function all(){busy=0;var a=document.querySelectorAll("a[href]");for(var i=0;i<a.length;i++)f(a[i])}` +
      `function soon(){if(!busy){busy=1;(window.requestAnimationFrame||setTimeout)(all)}}` +
      `document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a)f(a)},true);` +
      `function go(){all();try{new MutationObserver(soon).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}}` +
      `if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();` +
      `try{fetch("/pa-seo.json",{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.vehicles){V=d.vehicles;if(d.base)B=d.base;soon()}}).catch(function(){})}catch(e){}` +
      `})();</script>`;
  }
  return out;
}

/** Hash routes of single-page designs: what to open when one of their "pages" has a clean address. */
export function hashFor(pageKey: string, hashRoutes: Record<string, string> | undefined, spa: boolean): string {
  const short = pageKey.replace(/-us$/, '');
  if (hashRoutes && (hashRoutes[pageKey] || hashRoutes[short])) return hashRoutes[pageKey] || hashRoutes[short];
  if (!spa) return '';
  return ({ inventory: '#/inventory', 'used-cars': '#/inventory', about: '#/about', contact: '#/contact', blog: '#/blog' } as Record<string, string>)[short] || '';
}
