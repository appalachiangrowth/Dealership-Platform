import { adminOrigins } from './page';
export const API = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/+$/, '');

/** The website host decides which dealership is shown (like the old index.php). */
export function hostOf(req: Request): string {
  const url = new URL(req.url);
  const tenantParam = url.searchParams.get('pa_tenant') || url.searchParams.get('tenant');
  if (tenantParam) return `${tenantParam}.localhost`;
  let host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(',')[0].trim().toLowerCase();
  host = host.replace(/:\d+$/, '');
  if ((host === 'localhost' || host === '127.0.0.1') && process.env.DEFAULT_TENANT) host = `${process.env.DEFAULT_TENANT}.localhost`;
  return host;
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
