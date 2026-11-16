/**
 * Server-side proxy from this app to the backend (replaces the `/api/:path*`, `/uploads/:path*` and `/themes/:path*`
 * rewrites in next.config.ts).
 *
 * Why: a rewrite waits for the backend with no limit of its own. On shared hosting (Hostinger / LiteSpeed) every
 * request that hangs keeps a Node worker busy, and enough of them hit the account's process limit (HTTP 503).
 * Here every upstream call has a hard deadline (AbortController) and the timer is always cleared; a request that
 * runs out of time gets a quick 504 JSON answer instead of hanging.
 *
 *   GET / HEAD                      8 s   (dashboards, /dealer/facebook/state, badge counts…)
 *   POST / PUT / PATCH / DELETE    25 s   (saves, uploads)
 *   AI, imports, photo uploads,
 *   Facebook / CarGurus actions,
 *   theme installs, CSV exports   180 s   (known long-running work; same limit the old rewrite had)
 */

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://5.183.35.10:4000').replace(/[<>[\]()]/g, '').trim().replace(/\/+$/, '');

const READ_MS = 8_000;
const WRITE_MS = 25_000;
const LONG_MS = 180_000;

/** paths (after /api) that legitimately take long */
const LONG = [
  /^\/dealer\/ai\//,
  /^\/dealer\/media(\/|$)/,
  /^\/dealer\/vehicles\/(import|bulk)$/,
  /^\/dealer\/feeds\//,
  /^\/platform\/cargurus\//,
  /^\/api\/cargurus\//,
  /^\/dealer\/facebook\/(connect|switch-account|forget|post|pages\/load|warm|view\/(start|stop|nav|input)|mp\/)/,
  /^\/platform\/themes\/(install|custom|activate-tenant|rollback-tenant)$/,
  /^\/dealer\/site-pages\/media$/,
  /^\/dealer\/branding\//,
  /^\/public\/seo\/[^/]+\/vehicles\/regenerate$/,
  /^\/platform\/seo\/[^/]+\/(vehicles\/regenerate|redirects\/import)$/,
  /\.(csv|xml)$/,
  /\/export(\.csv)?$/,
];

function timeoutFor(method: string, path: string) {
  if (LONG.some((re) => re.test(path))) return LONG_MS;
  return method === 'GET' || method === 'HEAD' ? READ_MS : WRITE_MS;
}

/** request headers that must not be forwarded as they are */
const DROP_REQ = ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'expect', 'accept-encoding'];
/** response headers that no longer match the body we send (fetch already decoded / buffered it) */
const DROP_RES = ['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'];

function json(status: number, message: string) {
  return new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Forward one request. `prefix` is put in front of the path on the backend ('' for /api/…, '/uploads' or '/themes'
 * for the static files the backend serves).
 */
export async function proxy(req: Request, segments: string[] | undefined, prefix = ''): Promise<Response> {
  const incoming = new URL(req.url);
  const path = prefix + '/' + (segments || []).map((s) => encodeURIComponent(s)).join('/');
  const target = BACKEND_URL + path + incoming.search;
  const method = req.method.toUpperCase();

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!DROP_REQ.includes(k.toLowerCase())) headers.set(k, v);
  });
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  // the body is read before the clock starts, so a slow upload from the browser is not counted against the backend
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = await req.arrayBuffer();
    } catch {
      return json(400, 'The request body could not be read.');
    }
  }

  // pictures and theme files: 20 s; API calls: by method / path (see the table above)
  const ms = prefix ? 20_000 : timeoutFor(method, path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  // the browser gave up (page closed, navigation): stop waiting on the backend too
  const onClientAbort = () => ctrl.abort();
  req.signal?.addEventListener?.('abort', onClientAbort);
  try {
    const res = await fetch(target, { method, headers, body, signal: ctrl.signal, redirect: 'manual', cache: 'no-store' });
    // the whole answer is read inside the deadline, so a backend that stalls half-way cannot hold this worker either
    const data = method === 'HEAD' ? null : await res.arrayBuffer();
    const out = new Headers();
    res.headers.forEach((v, k) => {
      if (!DROP_RES.includes(k.toLowerCase()) && k.toLowerCase() !== 'set-cookie') out.set(k, v);
    });
    const cookies = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    for (const c of cookies) out.append('set-cookie', c);
    return new Response(data, { status: res.status, statusText: res.statusText, headers: out });
  } catch (e) {
    if (ctrl.signal.aborted) {
      if (req.signal?.aborted) return json(499, 'Request cancelled.');
      return json(504, `The server took too long to answer (more than ${Math.round(ms / 1000)} s). Please try again.`);
    }
    return json(502, `The server could not be reached: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener?.('abort', onClientAbort);
  }
}
