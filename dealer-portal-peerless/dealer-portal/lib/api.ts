'use client';

/** The portal runs under a sub-path (https://peerlessautosales.com/admin). '' when served at the root. */
export const BASE_PATH = String(process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

/** Single-dealer deployment: the one dealership this portal and its website belong to. */
export const FIXED_TENANT = String(process.env.NEXT_PUBLIC_TENANT || '').trim().toLowerCase();

function getApiUrl(): string {
  // Speed: once the API has its own HTTPS address (e.g. https://api.appalachiangrowthsolutions.com,
  // set as NEXT_PUBLIC_API_URL before `npm run build`), the browser calls it directly instead of
  // going through this website's /api proxy — one network hop less on every request.
  // Without an https:// address everything keeps going through /api as before.
  const direct = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    return direct.startsWith('https://') ? direct : `${BASE_PATH}/api`;
  }
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://5.183.35.10:4000';
  // Sanitize any accidental brackets, parentheses, or trailing slashes
  return raw.replace(/[<>[\]()]/g, '').trim().replace(/\/+$/, '');
}

export const API_URL = getApiUrl();
export const API_BASE_URL = API_URL;

/** Dealership Portal (dealers log in here) and Platform Admin (platform owners) are two separate apps. */
export const DEALER_PORTAL_URL = (process.env.NEXT_PUBLIC_DEALER_PORTAL_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const PLATFORM_ADMIN_URL = (process.env.NEXT_PUBLIC_PLATFORM_ADMIN_URL || 'http://localhost:3001').replace(/\/+$/, '');

const TOKEN_KEY = 'dp_token';
const SUPPORT_KEY = 'dp_support_tenant';

export const auth = {
  token: () => (typeof window === 'undefined' ? '' : localStorage.getItem(TOKEN_KEY) || ''),
  setToken: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SUPPORT_KEY);
  },
  /** Platform owner working inside one dealership ("support mode") */
  supportTenant: () => (typeof window === 'undefined' ? '' : sessionStorage.getItem(SUPPORT_KEY) || ''),
  setSupportTenant: (id: string) => (id ? sessionStorage.setItem(SUPPORT_KEY, id) : sessionStorage.removeItem(SUPPORT_KEY)),
};

export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; tenant?: string | false; raw?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenant = opts.tenant === false ? '' : opts.tenant || auth.supportTenant();
  if (tenant && path.startsWith('/dealer/')) headers['X-Tenant-Id'] = tenant;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(API_URL + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' });
  if (opts.raw && res.ok) return (await res.text()) as T;
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
      auth.clear();
      if (!location.pathname.startsWith(`${BASE_PATH}/login`)) location.href = `${BASE_PATH}/login`;
    }
    const msg = (data && (Array.isArray(data.message) ? data.message.join(', ') : data.message)) || res.statusText || 'Something went wrong';
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/** Download a protected file (CSV, XML) with the login token. */
export async function download(path: string, filename: string) {
  const text = await api<string>(path, { raw: true });
  const blob = new Blob([text], { type: filename.endsWith('.xml') ? 'application/xml' : 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Absolute URL for an uploaded photo ("/uploads/…" lives on the API). */
export function mediaUrl(u?: string | null) {
  if (!u) return '';
  return u.startsWith('/uploads/') || u.startsWith('/themes/') ? API_URL + u : u;
}

/** The Peerless website. This portal is the Peerless-only build (https://peerlessautosales1.com/admin). */
export const PEERLESS_SITE_URL = 'https://www.peerlessautosales1.com';

/**
 * The address of the dealership website: NEXT_PUBLIC_FRONTEND_URL, else https://www.peerlessautosales1.com
 * (http://localhost:3002 when the portal itself runs on localhost). Takes the first real http(s) address in
 * the setting, so a value pasted as a Markdown link like "[http://x](http://x)" still works, and NEVER
 * returns a relative path.
 */
export function frontendBase(): string {
  const raw = String(process.env.NEXT_PUBLIC_FRONTEND_URL || '');
  const m = raw.match(/https?:\/\/[^\s)\]"'<>]+/i);
  if (m) return m[0].replace(/\/+$/, '');
  return isLocalAdmin() ? 'http://localhost:3002' : PEERLESS_SITE_URL;
}

/**
 * Where the website lives. This is a single-dealer deployment: every "View website" link and every
 * Design / Content / Pages preview uses frontendBase() itself, with clean addresses (no ?tenant=, no
 * dealer sub-domain). Only a local test setup without a pinned dealer (no NEXT_PUBLIC_TENANT and no
 * NEXT_PUBLIC_FRONTEND_URL, on localhost) still picks the dealership with ?tenant=.
 */
export function siteBase(_t: { id: string; domains?: string[]; siteUrl?: string }): { base: string; shared: boolean } {
  const configured = /https?:\/\//i.test(String(process.env.NEXT_PUBLIC_FRONTEND_URL || ''));
  const shared = !FIXED_TENANT && !configured && isLocalAdmin();
  return { base: frontendBase(), shared };
}

/**
 * Public address of a dealership page: siteUrl(t) for the home page, siteUrl(t, 'index.html?pa_live=1#/blog') for others.
 * Always absolute. On the shared website app the dealership is chosen with ?tenant=…, merged correctly with the
 * page's own query and #hash (never "…?tenant=x/index.html").
 */
export function siteUrl(t: { id: string; domains?: string[]; siteUrl?: string }, path = '') {
  const { base, shared } = siteBase(t);
  let p = String(path || '').replace(/^\/+/, '');
  let hash = '';
  const hi = p.indexOf('#');
  if (hi >= 0) {
    hash = p.slice(hi);
    p = p.slice(0, hi);
  }
  let query = '';
  const qi = p.indexOf('?');
  if (qi >= 0) {
    query = p.slice(qi + 1);
    p = p.slice(0, qi);
  }
  const qs = new URLSearchParams(query);
  if (shared && !qs.has('tenant') && !qs.has('pa_tenant')) qs.set('tenant', t.id);
  const q = qs.toString();
  return `${base}/${p}${q ? `?${q}` : ''}${hash}`;
}

/** The admin itself is running on this computer (localhost) — dealer websites are then the local website app too. */
export function isLocalAdmin() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}
