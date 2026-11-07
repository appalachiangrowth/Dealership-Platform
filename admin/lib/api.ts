'use client';

const getBaseUrl = () => {
  if (typeof window !== 'undefined') return '/api';
  const raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://5.183.35.10:4000';
  return raw.replace(/[<>[\]()]/g, '').trim().replace(/\/+$/, '');
};

export const API_URL = getBaseUrl();
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
      if (!location.pathname.startsWith('/login')) location.href = '/login';
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

/** Public website address of a dealership. */
export function siteUrl(t: { id: string; domains?: string[]; siteUrl?: string }) {
  let pattern = process.env.NEXT_PUBLIC_SITE_PATTERN || 'http://{id}.localhost:3002';
  // older settings pointed at port 3000, which is now the Dealership Portal (or 3001, this admin): the websites are on 3002
  const port = (u: string) => (u.match(/:(\d+)(?:\/|$)/) || [])[1] || '';
  const pp = port(pattern.replace('{id}', 'x'));
  if (pp && (pp === port(DEALER_PORTAL_URL) || pp === port(PLATFORM_ADMIN_URL))) pattern = 'http://{id}.localhost:3002';
  // On this computer always open the local website app, never the live domain / old address saved in Business details
  if (isLocalAdmin()) return pattern.replace('{id}', t.id);
  if (t.siteUrl) return t.siteUrl;
  const d = t.domains?.[0];
  if (d && !d.endsWith('localhost')) return `https://${d}`;
  return pattern.replace('{id}', t.id);
}

/** The admin itself is running on this computer (localhost) — dealer websites are then the local website app too. */
export function isLocalAdmin() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}
