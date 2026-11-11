'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, API_URL, auth } from './api';

/** FB Poster: one Facebook login per dealer user, running in a browser on the server. */

export type FbItem = { name: string; url: string };
export type FbResult = { url: string; name: string; status: string; note?: string; error?: string };
export type FbJob = {
  runId?: string; status: 'running' | 'finished'; total: number; ok: number; failed: number; cancelled: boolean;
  startedAt: number; finishedAt: number | null; nextAt: number | null; results: FbResult[];
};
export type FbLog = { seq: number; at: number; msg: string };
export type FbState = {
  browserOpen: boolean;
  loggedIn: boolean | null;
  busy: boolean;
  busyWhat: string;
  view: boolean;
  url: string;
  job: FbJob | null;
  mp: { active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[]; running: boolean; report: unknown };
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

  const refresh = useCallback(async () => {
    try {
      const s = await api<FbState & { logs: FbLog[] }>(`/dealer/facebook/state?log=${logSeq.current}`);
      if (!alive.current) return;
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

  useEffect(() => {
    alive.current = true;
    const loop = async () => {
      await refresh();
      if (!alive.current) return;
      timer.current = setTimeout(loop, document.hidden ? 8000 : 1500);
    };
    void loop();
    return () => {
      alive.current = false;
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
