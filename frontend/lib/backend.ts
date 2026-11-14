import { adminOrigins } from './page';
export const API = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

const TENANT_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** cookie that keeps the dealership while a visitor clicks around https://sites.…/?tenant=<id> */
export const TENANT_COOKIE = 'pa_tenant';

function cookieOf(req: Request, name: string): string {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

/**
 * The dealership chosen by the address (?tenant= / ?pa_tenant=) or, on the following pages, API calls and form posts
 * of the same visit, by the pa_tenant cookie. '' = none (the host decides).
 */
export function tenantOf(req: Request): { id: string; fromQuery: boolean } {
  const url = new URL(req.url);
  const q = (url.searchParams.get('pa_tenant') || url.searchParams.get('tenant') || '').trim().toLowerCase();
  if (TENANT_ID.test(q)) return { id: q, fromQuery: true };
  const c = cookieOf(req, TENANT_COOKIE).trim().toLowerCase();
  if (TENANT_ID.test(c)) return { id: c, fromQuery: false };
  return { id: '', fromQuery: false };
}

/** The website host decides which dealership is shown (like the old index.php). */
export function hostOf(req: Request): string {
  const t = tenantOf(req);
  if (t.id) return `${t.id}.localhost`;
  let host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase();
  host = host.replace(/:\d+$/, '');
  const isDirectIpOrLocal = host === 'localhost' || host === '127.0.0.1' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  if (isDirectIpOrLocal && process.env.DEFAULT_TENANT) host = `${process.env.DEFAULT_TENANT}.localhost`;
  return host;
}

/**
 * Keeps ?tenant=<id> working on the shared website address (https://sites.…):
 *  · remembers the dealership in a cookie, so inventory.json, api/lead.php, the logo … of the same visit find it
 *  · in HTML pages, a small script adds ?tenant=<id> to every link on this site and to the page's own fetch / XHR calls
 * Pages on a dealer's own domain (no ?tenant= and no cookie) are returned unchanged.
 */
export async function withTenant(req: Request, res: Response): Promise<Response> {
  const t = tenantOf(req);
  if (!t.id) return res;
  const headers = new Headers(res.headers);
  if (t.fromQuery) {
    const https = (req.headers.get('x-forwarded-proto') || new URL(req.url).protocol).startsWith('https');
    // SameSite=None (+Secure) so the cookie also works inside the portals' preview frames
    headers.append('Set-Cookie', `${TENANT_COOKIE}=${encodeURIComponent(t.id)}; Path=/; Max-Age=2592000; HttpOnly; ${https ? 'SameSite=None; Secure' : 'SameSite=Lax'}`);
  }
  const type = headers.get('content-type') || '';
  if (!type.startsWith('text/html') || !res.body) return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  const html = await res.text();
  const script = `<script>(function(){var T=${JSON.stringify(t.id)};function add(u){try{if(!u)return u;var s=String(u);if(/^(#|mailto:|tel:|javascript:|data:|blob:)/i.test(s))return u;var x=new URL(s,document.baseURI||location.href);if(x.origin!==location.origin||/^.(themes|uploads|_next)./.test(x.pathname))return u;if(x.searchParams.has("tenant")||x.searchParams.has("pa_tenant"))return u;x.searchParams.set("tenant",T);return x.pathname+x.search+x.hash}catch(e){return u}}function fix(el,at){var v=el.getAttribute(at);if(v==null)return;var n=add(v);if(n!==v)el.setAttribute(at,n)}function all(){var a=document.querySelectorAll("a[href]");for(var i=0;i<a.length;i++)fix(a[i],"href");var f=document.querySelectorAll("form[action]");for(var j=0;j<f.length;j++)fix(f[j],"action")}document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a)fix(a,"href")},true);document.addEventListener("submit",function(e){if(e.target&&e.target.getAttribute&&e.target.getAttribute("action"))fix(e.target,"action")},true);var F=window.fetch;if(F)window.fetch=function(i,o){if(typeof i==="string"||i instanceof URL)i=add(String(i));return F.call(this,i,o)};var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){var a=Array.prototype.slice.call(arguments);a[1]=add(u);return O.apply(this,a)};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",all);else all();})();</script>`;
  const out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + script) : script + html;
  headers.delete('content-length');
  return new Response(out, { status: res.status, statusText: res.statusText, headers });
}

/** http(s)://dealer-domain — like the old pa_host(): lower-case, port removed. */
export function originOf(req: Request): string {
  const raw = (req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost').split(',')[0].trim();
  const host = raw.replace(/:\d+$/, '').toLowerCase().replace(/[^a-z0-9.\-]/g, '');
  const proto = (req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '') || 'http').split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

export async function backend(path: string, host: string, init: RequestInit & { query?: Record<string, string> } = {}) {
  const qs = new URLSearchParams({ host, ...(init.query || {}) });
  return fetch(`${API}${path}?${qs}`, { cache: 'no-store', ...init });
}

export function securityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // Dealership Portal + Platform Admin (other origins) show the website in their design / content preview.
  const admins = adminOrigins().join(' ');
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `frame-ancestors 'self' ${admins}`,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extra,
  };
}

/** The neutral page shown for an unknown address or a suspended dealership (pa_stop / pa_unknown_site_page). */
export function statePage(status: number, title: string, text: string) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f6fa;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1b33;text-align:center;padding:24px}h1{font-size:26px;margin:0 0 8px}p{color:#5b6b85;margin:0;max-width:440px}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
  return new Response(html, { status, headers: securityHeaders({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }) });
}

/** Turns a backend error (unknown site / suspended) into the matching page. */
export async function siteErrorPage(res: Response) {
  const body = await res.json().catch(() => ({}) as Record<string, string>);
  if (res.status === 403) return statePage(503, 'Temporarily unavailable', body.message || 'This website is temporarily unavailable.');
  if (res.status === 404) return statePage(404, 'Coming soon', 'A new dealership website is being set up at this address. Please check back shortly.');
  return statePage(502, 'Something went wrong', 'Please try again in a moment.');
}
