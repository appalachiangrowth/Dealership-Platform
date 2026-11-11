'use client';

/**
 * AI Quick Add (photos / walkaround video) + "Just tell it" command bar — browser helpers.
 * Ported from AI Quick Add v4.2 (app.html). The heavy work on videos (looking through the video, picking the
 * sharpest moments, reading the sound) happens on the dealer's own device; only small pictures go to the AI.
 */
import { api } from './api';

export const aiApi = <T = any>(path: string, body?: unknown) => api<T>(`/dealer/ai/${path}`, body === undefined ? {} : { body });

export type AiStatus = { hasKey: boolean; provider: string; model: string; video: boolean; voice: boolean };

/* ---------- VIN ---------- */
export function vinOk(v: unknown): boolean {
  const s = String(v || '').toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return false;
  const m: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (/\d/.test(s[i]) ? Number(s[i]) : m[s[i]]) * w[i];
  return (sum % 11 === 10 ? 'X' : String(sum % 11)) === s[8];
}

/* ---------- photos ---------- */
export type Photo = {
  id: number;
  url: string; // object URL for the preview
  file: Blob; // the full picture that is uploaded when the vehicle is saved
  data: string; // small copy (base64 JPEG) for the AI
  angle: string | null;
  quality: number | null;
  t?: number; // video time
};

export const ANGLE_ORDER = ['front_left', 'front', 'front_right', 'right', 'rear_right', 'rear', 'rear_left', 'left', 'wheel', 'interior_front', 'dashboard', 'odometer', 'console', 'front_seats', 'rear_seats', 'trunk', 'engine', 'detail', 'damage', 'other', 'document', 'vin_label'];
export const ANGLE_LABEL: Record<string, string> = {
  front_left: 'Front ¾', front: 'Front', front_right: 'Front ¾ (right)', left: 'Left side', right: 'Right side', rear_left: 'Rear ¾ (left)', rear: 'Rear', rear_right: 'Rear ¾',
  wheel: 'Wheel', interior_front: 'Interior', dashboard: 'Dashboard', odometer: 'Odometer', console: 'Screen / console', front_seats: 'Front seats', rear_seats: 'Back seats',
  trunk: 'Trunk', engine: 'Engine', detail: 'Detail', damage: 'Damage', vin_label: 'VIN sticker', document: 'Paperwork', other: 'Other',
};

let PHOTO_ID = 0;
export const nextPhotoId = () => ++PHOTO_ID;

/** Small copy for the AI (fast and cheap); the original stays for the listing. */
export function shrink(file: Blob, name = 'photo'): Promise<Photo> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc);
      c.height = Math.round(img.height * sc);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      res({ id: nextPhotoId(), url, file, data: c.toDataURL('image/jpeg', 0.8).split(',')[1], angle: null, quality: null });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error(`${name} is not a readable image.`));
    };
    img.src = url;
  });
}

/** Standard dealer order: exterior walk-around → interior → trunk/engine → details. Best front ¾ first (cover). */
export function arrangePhotos(list: Photo[], coverId: number | null): Photo[] {
  const rank = (p: Photo) => {
    const i = ANGLE_ORDER.indexOf(p.angle || 'other');
    return i < 0 ? ANGLE_ORDER.indexOf('other') : i;
  };
  const sorted = list.slice().sort((a, b) => rank(a) - rank(b) || (b.quality || 0) - (a.quality || 0));
  let cover = coverId != null ? sorted.find((p) => p.id === coverId) || null : null;
  if (!cover || (cover.quality || 3) < 3) {
    const bonus: Record<string, number> = { front_left: 0.6, front_right: 0.5, front: 0 };
    const sc = (p: Photo) => (p.quality || 3) + (bonus[p.angle || ''] || 0);
    const cands = sorted.filter((p) => (p.angle || '') in bonus).sort((a, b) => sc(b) - sc(a));
    cover = cands[0] || cover;
  }
  if (cover) {
    sorted.splice(sorted.indexOf(cover), 1);
    sorted.unshift(cover);
  }
  return sorted;
}

/* ---------- walkaround video (all on the device) ---------- */
export type Vid = { el: HTMLVideoElement; url: string; dur: number; frames: { t: number; sc: number; data: string }[]; cands: { t: number; sc: number }[] };

export function seek(el: HTMLVideoElement, t: number) {
  return new Promise<void>((r) => {
    const h = () => {
      el.removeEventListener('seeked', h);
      r();
    };
    el.addEventListener('seeked', h);
    el.currentTime = t;
  });
}
export function grab(el: HTMLVideoElement, maxSide: number) {
  const sc = Math.min(1, maxSide / Math.max(el.videoWidth, el.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(el.videoWidth * sc);
  c.height = Math.round(el.videoHeight * sc);
  c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height);
  return c;
}
/** How sharp is the current video picture? (variance of edges on a small grey copy) */
export function sharpness(el: HTMLVideoElement) {
  const c = grab(el, 200);
  const w = c.width;
  const h = c.height;
  const d = c.getContext('2d')!.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let s = 0;
  let s2 = 0;
  let k = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      s += l;
      s2 += l * l;
      k++;
    }
  return k ? s2 / k - (s / k) * (s / k) : 0;
}

/**
 * Look at the video about once a second, score how sharp each moment is, then keep only the sharpest moment
 * from each part of the video. Only these ~18 pictures go to the AI.
 */
export async function extractFrames(file: Blob, onProgress: (pct: number) => void): Promise<Vid> {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.src = url;
  await new Promise<void>((res, rej) => {
    el.onloadeddata = () => res();
    el.onerror = () => rej(new Error("This video format can't be opened in this browser. Try MP4, or use Chrome."));
  });
  const dur = el.duration;
  if (!Number.isFinite(dur) || dur < 3) throw new Error('The video is too short. Film at least 30 seconds around the car.');
  const nc = Math.max(24, Math.min(90, Math.round(dur))); // moments looked at (on the device)
  const n = Math.max(15, Math.min(20, Math.round(dur / 5))); // pictures sent to the AI
  const cands: { t: number; sc: number }[] = [];
  for (let i = 0; i < nc; i++) {
    const t = Math.min(dur - 0.2, 0.3 + ((dur - 0.6) * i) / (nc - 1));
    await seek(el, t);
    cands.push({ t, sc: sharpness(el) });
    if (i % 4 === 0) onProgress(Math.round((i / nc) * 100));
  }
  const frames: Vid['frames'] = [];
  for (let gI = 0; gI < n; gI++) {
    const part = cands.slice(Math.floor((gI * nc) / n), Math.floor(((gI + 1) * nc) / n));
    if (!part.length) continue;
    const best = part.reduce((x, y) => (y.sc > x.sc ? y : x));
    await seek(el, best.t);
    frames.push({ t: best.t, sc: best.sc, data: grab(el, 448).toDataURL('image/jpeg', 0.72).split(',')[1] });
  }
  return { el, url, dur, frames, cands };
}

/** Look a little before and after a moment and keep the sharpest picture (no motion blur). */
export async function sharpestAt(vid: Vid, t: number, span: number[]) {
  let best: { t: number; sc: number } | null = null;
  for (const dt of span) {
    const tt = Math.max(0.05, Math.min(vid.dur - 0.1, t + dt));
    await seek(vid.el, tt);
    const sc = sharpness(vid.el);
    if (!best || sc > best.sc) best = { t: tt, sc };
  }
  await seek(vid.el, best!.t);
  return best!;
}
export async function bigFrame(vid: Vid, t: number, side: number, q: number, quick = false) {
  if (quick) await seek(vid.el, t);
  else await sharpestAt(vid, t, [-0.25, 0, 0.25]);
  const c = grab(vid.el, side);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', q));
  return { blob, data: c.toDataURL('image/jpeg', q).split(',')[1] };
}

/** The sound of a video / voice note as 16 kHz mono WAV (base64). { silent } when nobody talks. */
export async function extractAudio(file: Blob, maxSec: number): Promise<{ data?: string; silent?: boolean } | null> {
  const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC || !(window as any).OfflineAudioContext) return null;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const dur = Math.min(buf.duration, maxSec);
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(dur * rate), rate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start(0);
    const out = (await off.startRendering()).getChannelData(0);
    let sum = 0;
    for (let i = 0; i < out.length; i += 50) sum += out[i] * out[i];
    if (Math.sqrt(sum / (out.length / 50)) < 0.003) return { silent: true };
    const bytes = new Uint8Array(44 + out.length * 2);
    const dv = new DataView(bytes.buffer);
    const w = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i);
    };
    w(0, 'RIFF');
    dv.setUint32(4, 36 + out.length * 2, true);
    w(8, 'WAVE');
    w(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    w(36, 'data');
    dv.setUint32(40, out.length * 2, true);
    for (let i = 0; i < out.length; i++) {
      const v = Math.max(-1, Math.min(1, out[i]));
      dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return { data: btoa(bin) };
  } catch {
    return null;
  } finally {
    void ctx.close?.();
  }
}

/** The video parts' answers → one set of findings. */
export function mergeVideo(list: { r: any; off: number }[]) {
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const best = (key: string, test?: (v: any) => boolean) => {
    let b: any = null;
    list.forEach(({ r }) => {
      const v = r.findings[key];
      if (v && v.value != null && v.value !== '' && (!test || test(v)) && (!b || (rank[v.confidence] || 0) > (rank[b.confidence] || 0))) b = v;
    });
    return b;
  };
  const union = (key: string, nameKey: string) => {
    const seen: Record<string, 1> = {};
    const out: any[] = [];
    list.forEach(({ r }) =>
      (r.findings[key] || []).forEach((x: any) => {
        const id = String(x[nameKey] || '').toLowerCase();
        if (id && !seen[id]) {
          seen[id] = 1;
          out.push(x);
        }
      }),
    );
    return out;
  };
  const first = list[0].r.findings;
  const f: any = { ...first };
  f.vin_in_video = best('vin_in_video', (v) => vinOk(v.value)) || best('vin_in_video') || { value: null, confidence: 'low', evidence: 'not visible' };
  ['exterior_color', 'interior_color', 'interior_material', 'transmission', 'odometer_miles'].forEach((k) => {
    f[k] = best(k) || first[k] || { value: null, confidence: 'low', evidence: '' };
  });
  f.seen_vehicle = (list.find((x) => x.r.findings.seen_vehicle) || list[0]).r.findings.seen_vehicle || '';
  f.features = union('features', 'name');
  f.safety_features = union('safety_features', 'name');
  f.visible_condition_notes = union('visible_condition_notes', 'note');
  f.spoken_notes = [...new Set(([] as string[]).concat(...list.map((x) => x.r.findings.spoken_notes || [])))];
  f.frames = ([] as any[]).concat(...list.map(({ r, off }) => (r.findings.frames || []).map((x: any) => ({ ...x, n: x.n + off }))));
  f.vin_frames = ([] as number[]).concat(...list.map(({ r, off }) => (r.findings.vin_frames || []).map((n: number) => n + off)));
  f.odometer_frames = ([] as number[]).concat(...list.map(({ r, off }) => (r.findings.odometer_frames || []).map((n: number) => n + off)));
  return f;
}
