'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * "Auto White Studio Background" (Vehicle Photo Studio Enhancer) — shared by the photo uploader and the import.
 * The switch is ON by default and remembered in this browser. Whether the server has the feature installed comes from
 * GET /dealer/media/enhancer; when it is not installed, photos are simply saved as they are.
 */
const KEY = 'autoWhiteStudio';

export function useStudioSwitch(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === '0') setOn(false);
    } catch {
      /* no storage: stays on */
    }
  }, []);
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(KEY, v ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };
  return [on, set];
}

export type StudioStatus = { available: boolean; reason: string } | null;

let cached: Promise<StudioStatus> | null = null;
/** Is the enhancer installed on the server? null while loading (or when an older server does not know it). */
export function useStudioStatus(): StudioStatus {
  const [st, setSt] = useState<StudioStatus>(null);
  useEffect(() => {
    cached ??= api<{ available: boolean; reason?: string }>('/dealer/media/enhancer')
      .then((r) => ({ available: !!r.available, reason: r.reason || '' }))
      .catch(() => {
        cached = null;
        return null;
      });
    let live = true;
    void cached.then((r) => live && setSt(r));
    return () => {
      live = false;
    };
  }, []);
  return st;
}

export type PhotoJob = {
  state: 'running' | 'done';
  total: number;
  done: number;
  converted: number;
  enhanced: number;
  kept: number;
  failed: number;
  vehicles: number;
  notes: { url: string; reason: string }[];
};

/* ---------------- Photo Studio: background scenes, before / after preview, apply ---------------- */

export type StudioBackground = { id: string; name: string; desc: string; thumb: string };
export type StudioInfo = { available: boolean; reason: string; default: string; backgrounds: StudioBackground[] };
/** the background picked: a scene id, "transparent", or "custom" with the dealer's own photo */
export type StudioChoice = { id: string; customUrl?: string };

let infoCache: Promise<StudioInfo | null> | null = null;
/** the scenes the server offers (and whether the cut-out is installed); null while loading */
export function useStudioInfo(): StudioInfo | null {
  const [info, setInfo] = useState<StudioInfo | null>(null);
  useEffect(() => {
    infoCache ??= api<StudioInfo>('/dealer/media/studio').catch(() => {
      infoCache = null;
      return null;
    });
    let live = true;
    void infoCache.then((r) => live && setInfo(r));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

const BG_KEY = 'photoStudioBackground';
/** the last background picked (remembered in this browser, so the next photos are one click) */
export function useStudioChoice(): [StudioChoice, (c: StudioChoice) => void] {
  const [c, setC] = useState<StudioChoice>({ id: 'cyclorama' });
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(BG_KEY) || 'null');
      if (v && typeof v.id === 'string') setC({ id: v.id, customUrl: typeof v.customUrl === 'string' ? v.customUrl : undefined });
    } catch {
      /* nothing remembered */
    }
  }, []);
  const set = (v: StudioChoice) => {
    setC(v);
    try {
      localStorage.setItem(BG_KEY, JSON.stringify(v));
    } catch {
      /* not remembered */
    }
  };
  return [c, set];
}

const body = (source: string, c: StudioChoice) => ({ source, background: c.id, customBackground: c.id === 'custom' ? c.customUrl || '' : undefined });

export type StudioPreview = { ok: true; before: string; after: string; width: number; height: number; cached: boolean } | { ok: false; reason: string };
/** before / after images for one photo on one background (nothing is saved) */
export const studioPreview = (source: string, c: StudioChoice) => api<StudioPreview>('/dealer/media/studio/preview', { body: body(source, c) });

export type StudioApplied = { ok: true; url: string; width: number; height: number } | { ok: false; reason: string };
/** the full-size photo on the background, saved as a new photo of the dealer */
export const studioApply = (source: string, c: StudioChoice) => api<StudioApplied>('/dealer/media/studio/apply', { body: body(source, c) });

/** query string for uploads that go straight onto the chosen background */
export const studioUploadQuery = (c: StudioChoice) =>
  `enhance=1&background=${encodeURIComponent(c.id)}${c.id === 'custom' && c.customUrl ? `&customBackground=${encodeURIComponent(c.customUrl)}` : ''}`;
