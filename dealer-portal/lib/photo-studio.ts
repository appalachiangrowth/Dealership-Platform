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
