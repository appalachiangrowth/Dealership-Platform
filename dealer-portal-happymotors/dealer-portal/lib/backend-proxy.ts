import http from 'node:http';
import https from 'node:https';

/**
 * Server-side proxy from this app to the backend: /api/*, /uploads/* and /themes/* (route handlers in app/).
 *
 * Built on node:http / node:https instead of fetch() (undici), because on Hostinger's runner fetch() could hang for
 * 8–80 s while the backend itself answers in ~10 ms:
 *   - undici keeps sockets open and re-uses them. The backend (Node) closes an idle keep-alive socket after ~5 s and
 *     container NAT can drop it silently; a request sent on such a dead socket waits until a timeout.
 *     → every request here opens its own fresh connection (no agent / no keep-alive): ~10 ms on this route.
 *   - fetch() hides the real network error behind "fetch failed" and nothing was logged.
 *     → errors keep their exact code (ECONNREFUSED, ETIMEDOUT, ECONNRESET…) and are logged with [api-proxy].
 *
 * Rules: IPv4 only (family 4); hop-by-hop headers are not forwarded; the body is buffered once and sent with an exact
 * Content-Length (GET / HEAD never send one); connect limit 5 s; answer limit by request kind (below); the timer is
 * always cleared; a timeout answers 504 and a network error 502, both as JSON, right away.
 *
 *   GET / HEAD                     15 s
 *   POST / PUT / PATCH / DELETE    25 s
 *   AI, imports, uploads, Facebook / CarGurus actions, theme installs, CSV exports   180 s
 *   /uploads/*, /themes/* files     20 s
 *
 * Every failure, and every request slower than 2 s, is written to the runtime log, e.g.
 *   [api-proxy] GET http://5.183.35.10:4000/dealer/dashboard -> 504 15003ms timeout (no answer within 15 s)
 *   [api-proxy] POST http://5.183.35.10:4000/dealer/vehicles -> 502 3ms ECONNREFUSED connect ECONNREFUSED 5.183.35.10:4000
 */

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://5.183.35.10:4000').replace(/[<>[\]()]/g, '').trim().replace(/\/+$/, '');
const BASE = (() => {
  try {
    return new URL(BACKEND_URL);
  } catch {
    return new URL('http://5.183.35.10:4000');
  }
})();
const IS_HTTPS = BASE.protocol === 'https:';
const BASE_PATH = BASE.pathname.replace(/\/+$/, '');

const CONNECT_MS = 5_000;
const READ_MS = 15_000;
const WRITE_MS = 25_000;
const LONG_MS = 180_000;
const FILE_MS = 20_000;
const SLOW_MS = 2_000;

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
  /^\/platform\/seo\/[^/]+\/(vehicles\/regenerate|redirects\/import)$/,
  /\.(csv|xml)$/,
  /\/export(\.csv)?$/,
];

function timeoutFor(method: string, path: string) {
  if (LONG.some((re) => re.test(path))) return LONG_MS;
  return method === 'GET' || method === 'HEAD' ? READ_MS : WRITE_MS;
}

/** never forwarded to the backend (hop-by-hop, or recalculated here) */
const DROP_REQ = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect', 'content-length', 'accept-encoding']);
/** never passed back to the browser (hop-by-hop, or recalculated here) */
const DROP_RES = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'proxy-connection', 'trailer', 'upgrade']);

function json(status: number, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ statusCode: status, message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function log(kind: 'error' | 'slow', method: string, url: string, status: number, ms: number, detail = '') {
  const line = `[api-proxy] ${method} ${url} -> ${status} ${ms}ms${detail ? ' ' + detail : ''}`;
  if (kind === 'error') console.error(line);
  else console.log(line);
}

type Upstream = { status: number; statusText: string; headers: http.IncomingHttpHeaders; body: Buffer };
class ProxyError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** one request on its own fresh IPv4 connection; resolves with the whole answer, or rejects with a ProxyError */
function send(method: string, path: string, headers: Record<string, string | string[]>, body: Buffer | null, totalMs: number, clientSignal?: AbortSignal): Promise<Upstream> {
  return new Promise((resolve, reject) => {
    const lib = IS_HTTPS ? https : http;
    let done = false;
    let connectTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;
    const finish = (err: ProxyError | null, value?: Upstream) => {
      if (done) return;
      done = true;
      if (connectTimer) clearTimeout(connectTimer);
      if (totalTimer) clearTimeout(totalTimer);
      clientSignal?.removeEventListener?.('abort', onClientAbort);
      if (err) {
        req.destroy();
        reject(err);
      } else resolve(value!);
    };
    const onClientAbort = () => finish(new ProxyError('the browser cancelled the request', 'CLIENT_ABORT', 499));

    const req = lib.request({
      protocol: BASE.protocol,
      hostname: BASE.hostname,
      port: BASE.port || (IS_HTTPS ? 443 : 80),
      path: BASE_PATH + path,
      method,
      headers,
      family: 4, // IPv4 only
      agent: false, // a fresh connection every time: never a stale pooled socket
      servername: IS_HTTPS ? BASE.hostname : undefined,
    });

    totalTimer = setTimeout(() => finish(new ProxyError(`no answer within ${Math.round(totalMs / 1000)} s`, 'TIMEOUT', 504)), totalMs);
    connectTimer = setTimeout(() => finish(new ProxyError(`could not connect within ${CONNECT_MS / 1000} s`, 'CONNECT_TIMEOUT', 504)), CONNECT_MS);
    req.on('socket', (sock) => {
      if (!sock.connecting) {
        if (connectTimer) clearTimeout(connectTimer);
      } else sock.once(IS_HTTPS ? 'secureConnect' : 'connect', () => connectTimer && clearTimeout(connectTimer));
    });
    if (clientSignal?.aborted) return onClientAbort();
    clientSignal?.addEventListener?.('abort', onClientAbort);

    req.on('error', (e: NodeJS.ErrnoException) => {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      finish(new ProxyError(e.message, e.code || cause || 'ERROR', 502));
    });
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('aborted', () => finish(new ProxyError('the backend closed the connection mid-answer', 'ECONNRESET', 502)));
      res.on('error', (e: NodeJS.ErrnoException) => finish(new ProxyError(e.message, e.code || 'ERROR', 502)));
      res.on('end', () => finish(null, { status: res.statusCode || 502, statusText: res.statusMessage || '', headers: res.headers, body: Buffer.concat(chunks) }));
    });

    if (body && body.length) req.end(body);
    else req.end();
  });
}

/**
 * Forward one request. `prefix` is put in front of the path on the backend ('' for /api/…, '/uploads' or '/themes'
 * for the static files the backend serves).
 */
export async function proxy(req: Request, segments: string[] | undefined, prefix = ''): Promise<Response> {
  const started = Date.now();
  const incoming = new URL(req.url);
  const path = prefix + '/' + (segments || []).map((s) => encodeURIComponent(s)).join('/');
  const method = req.method.toUpperCase();
  const target = path + incoming.search;
  const shown = BACKEND_URL + target;

  const headers: Record<string, string | string[]> = {};
  req.headers.forEach((v, k) => {
    if (!DROP_REQ.has(k.toLowerCase())) headers[k] = v;
  });
  headers['host'] = BASE.host;
  headers['connection'] = 'close';
  headers['accept-encoding'] = 'identity'; // the answer is passed on byte for byte
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  if (ip) headers['x-forwarded-for'] = ip;
  headers['x-forwarded-host'] = incoming.host;
  headers['x-forwarded-proto'] = incoming.protocol.replace(':', '');

  // the body is read completely first (never streamed): an exact Content-Length, nothing left waiting
  let body: Buffer | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = Buffer.from(await req.arrayBuffer());
    } catch (e) {
      log('error', method, shown, 400, Date.now() - started, `BODY_READ ${(e as Error).message}`);
      return json(400, 'The request body could not be read.');
    }
    headers['content-length'] = String(body.length);
  }

  const ms = prefix ? FILE_MS : timeoutFor(method, path);
  try {
    const up = await send(method, target, headers, body, ms, req.signal);
    const elapsed = Date.now() - started;
    if (elapsed > SLOW_MS || up.status >= 500) log(up.status >= 500 ? 'error' : 'slow', method, shown, up.status, elapsed, up.status >= 500 ? 'backend answered with an error' : 'slow');
    const out = new Headers();
    for (const [k, v] of Object.entries(up.headers)) {
      if (v === undefined || DROP_RES.has(k.toLowerCase())) continue;
      if (Array.isArray(v)) for (const x of v) out.append(k, x);
      else out.set(k, String(v));
    }
    const noBody = method === 'HEAD' || up.status === 204 || up.status === 304;
    return new Response(noBody ? null : new Uint8Array(up.body), { status: up.status, statusText: up.statusText, headers: out });
  } catch (e) {
    const err = e instanceof ProxyError ? e : new ProxyError((e as Error).message, 'ERROR', 502);
    const elapsed = Date.now() - started;
    log('error', method, shown, err.status, elapsed, `${err.code} ${err.message}`);
    if (err.code === 'CLIENT_ABORT') return json(499, 'Request cancelled.');
    if (err.status === 504) return json(504, `The server took too long to answer (${err.message}). Please try again.`, { code: err.code });
    return json(502, `The server could not be reached (${err.code}).`, { code: err.code });
  }
}
