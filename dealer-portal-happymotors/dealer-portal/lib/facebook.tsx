'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, API_URL, auth } from './api';

/** FB Poster: one Facebook login per dealer user, running in a browser on the server. */

export type FbItem = { name: string; url: string };
export type FbResult = { url: string; name: string; status: string; note?: string; error?: string };
export type FbJob = {
  runId?: string; status: 'queued' | 'running' | 'finished'; total: number; ok: number; failed: number; cancelled: boolean;
  /** the vehicle this post is for (empty for posts from FB Poster) */
  label?: string;
  startedAt: number; finishedAt: number | null; nextAt: number | null; results: FbResult[];
};
export type FbLog = { seq: number; at: number; msg: string };

/** one vehicle of the Marketplace batch (the progress bar at the top of every page) */
export type MpBatchItem = {
  id: string; action: string; verb: string; name: string; position: number;
  status: 'queued' | 'running' | 'done' | 'attention' | 'failed' | 'cancelled';
  step: string; error: string; outcome: string; tries: number;
  queuedAt: number; startedAt: number | null; endedAt: number | null;
};
/** every vehicle queued for Marketplace since the queue was last empty */
export type MpBatch = {
  id: number; startedAt: number; finishedAt: number | null; nextAt: number | null;
  total: number; done: number; attention: number; failed: number; cancelled: number; queued: number; running: number;
  items: MpBatchItem[];
};
export type FbState = {
  browserOpen: boolean;
  loggedIn: boolean | null;
  busy: boolean;
  busyWhat: string;
  view: boolean;
  url: string;
  job: FbJob | null;
  mp: { active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[]; running: boolean; report: unknown; batch?: MpBatch | null };
  /** Page posts waiting for the current one to finish */
  postQueue?: { runId?: string; label: string; total: number }[];
  logSeq: number;
  account: {
    fbUserId: string; fbName: string; connectedAt: string | null; actingAs: { url?: string; name?: string; verified?: boolean };
    pages: FbItem[]; groups: FbItem[]; proxy: string;
  };
  screen: { width: number; height: number };
};

type Ctx = {
  state: FbState | null;
  logs: FbLog[];
  error: string;
  refresh: () => Promise<void>;
  /** live browser panel open in the portal */
  viewOpen: boolean;
  setViewOpen: (v: boolean) => void;
};

/**
 * GET /dealer/facebook/state, shared: while one request for the same query is on its way, every other caller
 * (FB Poster page, activity bar, Post-to-Facebook popup) gets that same answer instead of starting another request.
 */
const inflight = new Map<string, Promise<unknown>>();
export function fbState<T = FbState & { logs: FbLog[] }>(query = ''): Promise<T> {
  let p = inflight.get(query) as Promise<T> | undefined;
  if (!p) {
    p = api<T>(`/dealer/facebook/state${query}`).finally(() => inflight.delete(query));
    inflight.set(query, p);
  }
  return p;
}

/** something is running on the dealer's Facebook browser (worth following closely) */
export const fbBusy = (s: Partial<FbState> | null | undefined) =>
  !!s && (!!s.busy || s.job?.status === 'running' || !!s.postQueue?.length || !!s.mp?.active || !!s.mp?.queue?.length || !!s.mp?.running || !!(s.mp?.batch && !s.mp.batch.finishedAt));

const FbCtx = createContext<Ctx>({ state: null, logs: [], error: '', refresh: async () => {}, viewOpen: false, setViewOpen: () => {} });
export const useFb = () => useContext(FbCtx);

export function FbProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FbState | null>(null);
  const [logs, setLogs] = useState<FbLog[]>([]);
  const [error, setError] = useState('');
  const [viewOpen, setViewOpen] = useState(false);
  const logSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const busyRef = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const s = await fbState(`?log=${logSeq.current}`);
      if (!alive.current) return;
      busyRef.current = fbBusy(s);
      // the server restarted: its log numbering starts again
      if (s.logSeq < logSeq.current) {
        logSeq.current = 0;
        setLogs(s.logs);
      } else if (s.logs.length) setLogs((l) => [...l, ...s.logs].slice(-300));
      logSeq.current = s.logSeq;
      const { logs: _l, ...rest } = s;
      void _l;
      setState(rest);
      setError('');
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, []);

  // poll: every 3 s while something runs or the live browser is open, every 15 s otherwise; paused while the tab is hidden
  const viewRef = useRef(false);
  viewRef.current = viewOpen;
  useEffect(() => {
    alive.current = true;
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!alive.current || document.visibilityState !== 'visible') return; // resumes on visibilitychange
      timer.current = setTimeout(loop, busyRef.current || viewRef.current ? 3000 : 15000);
    };
    const loop = async () => {
      if (document.visibilityState === 'visible') await refresh();
      schedule();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loop();
      else if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void loop();
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  return <FbCtx.Provider value={{ state, logs, error, refresh, viewOpen, setViewOpen }}>{children}</FbCtx.Provider>;
}

/** fetch with the login token (for pictures: live view frames, problem screenshots) */
export async function fbFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenant = auth.supportTenant();
  if (tenant) headers['X-Tenant-Id'] = tenant;
  return fetch(API_URL + path, { ...init, headers, cache: 'no-store' });
}

/**
 * FB Poster live view over one WebSocket (pictures in, clicks / typing out).
 * Goes straight to the API when NEXT_PUBLIC_API_URL is an https:// address (wss://…), otherwise to this site's own
 * /api path on the same domain (Nginx passes that one path straight to the API: Next.js cannot carry WebSockets).
 * The login token travels as a WebSocket sub-protocol, never in the URL. null = no WebSocket here (use HTTP).
 */
export function fbViewSocket(): { url: string; protocols: string[] } | null {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return null;
  const base = /^https?:\/\//i.test(API_URL)
    ? API_URL.replace(/^http/i, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}${API_URL.startsWith('/') ? API_URL : `/${API_URL}`}`;
  const protocols = ['fbview'];
  const token = auth.token();
  if (token) protocols.push(`bearer.${token}`);
  const tenant = auth.supportTenant();
  if (tenant) protocols.push(`tenant.${tenant}`);
  return { url: `${base.replace(/\/+$/, '')}/dealer/facebook/view/ws`, protocols };
}

export const fb = {
  post: <T = unknown>(path: string, body?: unknown) => api<T>(`/dealer/facebook/${path}`, { method: 'POST', body: body ?? {} }),
  put: <T = unknown>(path: string, body?: unknown) => api<T>(`/dealer/facebook/${path}`, { method: 'PUT', body: body ?? {} }),
  get: <T = unknown>(path: string) => api<T>(`/dealer/facebook/${path}`),
  del: <T = unknown>(path: string) => api<T>(`/dealer/facebook/${path}`, { method: 'DELETE' }),
};

/** "screenshot mp_unconfirmed_1793…png" in a log line → the file name */
export function screenshotIn(text: string): string | null {
  const m = String(text || '').match(/\b([a-z_]+_\d{10,}\.png)\b/i);
  return m ? m[1] : null;
}

export function FacebookIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export type FbPostingConfig = {
  configured: boolean;
  page: FbItem | null;
  includePage: boolean;
  groups: FbItem[];
  collection: { id: string; name: string } | null;
  captionTemplate?: string;
  hashtags?: string;
  delayMin?: number;
  delayMax?: number;
  updatedAt?: string;
};

const STORAGE_KEY = 'fb_posting_config';

export function getSavedFbPostingConfig(): FbPostingConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveFbPostingConfig(cfg: FbPostingConfig) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {}
}
