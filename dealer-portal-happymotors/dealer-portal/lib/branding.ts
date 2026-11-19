'use client';

/**
 * PHOTO BRANDING in the browser — port of the old platform/lib/brand.php (GD) to canvas:
 *  - automatic bands drawn from Business details: top = logo (or name) left + address right with a pin,
 *    bottom = phone + website with icons; drawn at 2× (2896 px) and scaled to 1448 px like the old code
 *  - the dealer's own PNG bands replace the automatic ones
 *  - main photo: 4:3 canvas as wide as the top band (min 1448 px), the photo fills the middle (cover crop)
 *  - a clean copy (max 1600 px) is kept so the photo can be redone when the bands change
 *  - brandRun(): works through the photos that still need the current bands, a few at a time, with a small
 *    progress pill at the bottom of the screen (like the old portal)
 */
import { api, API_URL, auth } from './api';

export type BrandDetails = { name: string; street: string; cityLine: string; phone: string; site: string; logo: string; color: string };
type Job = { kind: 'b' | 'p'; vehicleId: string; url: string; source: string; orig: string; src: string; lay: number[] | null };
type Drawable = HTMLCanvasElement | ImageBitmap;

const FONT = 'Poppins, "Plus Jakarta Sans", Inter, Arial, sans-serif';
/** GD sizes are points (96 dpi) → pixels */
const pt = (n: number) => Math.round((n * 4) / 3);

/* ---------------- loading pictures (through the API so the canvas may read them) ---------------- */

export async function loadPicture(url: string): Promise<ImageBitmap> {
  const headers: Record<string, string> = { Authorization: `Bearer ${auth.token()}` };
  const tenant = auth.supportTenant();
  if (tenant) headers['X-Tenant-Id'] = tenant;
  const res = await fetch(`${API_URL}/dealer/branding/source?url=${encodeURIComponent(url)}`, { headers, cache: 'no-store' });
  if (!res.ok) {
    let msg = `could not be loaded (${res.status})`;
    try {
      const j = await res.json();
      msg = (Array.isArray(j.message) ? j.message.join(', ') : j.message) || msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  try {
    return await createImageBitmap(await res.blob());
  } catch {
    throw new Error('photo could not be read');
  }
}

/* ---------------- automatic bands ---------------- */

function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}
/** navy on light bands, white on dark ones */
function ink(c: [number, number, number]): string {
  const l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  return l > 0.6 ? 'rgb(15,43,76)' : '#ffffff';
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function down(big: HTMLCanvasElement, w: number, h: number) {
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(big, 0, 0, w, h);
  return c;
}

function pin(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string, bg: string) {
  g.fillStyle = col;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(cx - r * 0.86, cy + r * 0.5);
  g.lineTo(cx + r * 0.86, cy + r * 0.5);
  g.lineTo(cx, cy + r * 2.1);
  g.closePath();
  g.fill();
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, r * 0.4, 0, Math.PI * 2);
  g.fill();
}
function phone(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string, bg: string) {
  g.fillStyle = col;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  // handset (Material "call" glyph, 24×24) in the band colour
  const p = new Path2D('M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z');
  const s = (r * 1.1) / 24;
  g.save();
  g.translate(cx - 12 * s, cy - 12 * s);
  g.scale(s, s);
  g.fillStyle = bg;
  g.fill(p);
  g.restore();
}
function globe(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string) {
  const t = Math.max(3, r * 0.12);
  g.strokeStyle = col;
  g.lineWidth = t;
  g.beginPath();
  g.arc(cx, cy, r - t / 2, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.ellipse(cx, cy, r * 0.45 - t / 2, r - t / 2, 0, 0, Math.PI * 2);
  g.stroke();
  const dy = r * 0.5;
  const hw = Math.sqrt(Math.max(0, r * r - dy * dy)) - t;
  g.beginPath();
  g.moveTo(cx - r + t, cy);
  g.lineTo(cx + r - t, cy);
  g.moveTo(cx, cy - r + t);
  g.lineTo(cx, cy + r - t);
  g.moveTo(cx - hw, cy - dy);
  g.lineTo(cx + hw, cy - dy);
  g.moveTo(cx - hw, cy + dy);
  g.lineTo(cx + hw, cy + dy);
  g.stroke();
}
function roundRect(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number) {
  g.beginPath();
  g.moveTo(x1 + r, y1);
  g.arcTo(x2, y1, x2, y2, r);
  g.arcTo(x2, y2, x1, y2, r);
  g.arcTo(x1, y2, x1, y1, r);
  g.arcTo(x1, y1, x2, y1, r);
  g.closePath();
  g.fill();
}

export async function fontsReady() {
  try {
    await Promise.all([document.fonts.load(`500 ${pt(40)}px Poppins`), document.fonts.load(`700 ${pt(66)}px Poppins`)]);
  } catch {
    /* system font is used */
  }
}

/** Top band: logo (or dealership name) left, address right with a map pin. 1448 × 160. */
export function drawHeader(d: BrandDetails, logo: ImageBitmap | null): HTMLCanvasElement {
  const W = 2896;
  const H = 320;
  const P = 112;
  const bgc = rgb(d.color);
  const c = ink(bgc);
  const bg = `rgb(${bgc.join(',')})`;
  const cv = canvas(W, H);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  const lines = [d.street, d.cityLine].filter(Boolean);
  let right = W - P;
  if (lines.length) {
    g.font = `500 ${pt(40)}px ${FONT}`;
    const tw = Math.max(...lines.map((l) => g.measureText(l).width));
    const tx = right - tw;
    const lh = 62;
    const y0 = H / 2 - (lh * lines.length) / 2 + 46;
    g.fillStyle = c;
    lines.forEach((l, i) => g.fillText(l, tx, y0 + i * lh));
    const dx = tx - 44;
    g.fillRect(dx, H / 2 - 56, 4, 112);
    pin(g, dx - 72, H / 2 - 16, 30, c, bg);
    right = dx - 130;
  }
  let logoDone = false;
  if (logo) {
    // dark band: the logo sits on a white rounded plate so a dark logo stays readable
    const plate = c === '#ffffff';
    const pad = plate ? 26 : 0;
    const maxH = plate ? 210 : 220;
    const maxW = Math.min(1100, right - P - 40 - 2 * pad);
    const sc = Math.min(maxH / logo.height, maxW / logo.width);
    const lw = Math.max(1, logo.width * sc);
    const lhh = Math.max(1, logo.height * sc);
    const y = (H - lhh) / 2;
    if (plate) {
      g.fillStyle = '#ffffff';
      roundRect(g, P - pad, y - pad, P + lw + pad, y + lhh + pad, 30);
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(logo, P, y, lw, lhh);
    logoDone = true;
  }
  if (!logoDone && d.name) {
    let fs = 66;
    g.font = `700 ${pt(fs)}px ${FONT}`;
    while (fs > 30 && g.measureText(d.name).width > right - P - 40) {
      fs -= 4;
      g.font = `700 ${pt(fs)}px ${FONT}`;
    }
    g.fillStyle = c;
    g.fillText(d.name, P, H / 2 + pt(fs) * 0.38);
  }
  return down(cv, 1448, 160);
}

/** Bottom band: phone and website with icons. 1448 × 119. */
export function drawFooter(d: BrandDetails): HTMLCanvasElement {
  const W = 2896;
  const H = 238;
  const bgc = rgb(d.color);
  const c = ink(bgc);
  const bg = `rgb(${bgc.join(',')})`;
  const cv = canvas(W, H);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const cy = H / 2;
  const groups: ['phone' | 'globe', string][] = [];
  if (d.phone) groups.push(['phone', d.phone]);
  if (d.site) groups.push(['globe', d.site]);
  const centers = groups.length === 2 ? [0.34, 0.7] : [0.5];
  groups.forEach(([icon, text], i) => {
    const fs = pt(icon === 'globe' ? 40 : 46);
    g.font = `500 ${fs}px ${FONT}`;
    const tw = g.measureText(text).width;
    const gw = 52 * 2 + 40 + 4 + 40 + tw;
    const x = W * centers[i] - gw / 2;
    if (icon === 'phone') phone(g, x + 52, cy, 52, c, bg);
    else globe(g, x + 52, cy, 46, c);
    const dx = x + 104 + 40;
    g.fillStyle = c;
    g.fillRect(dx, cy - 34, 4, 68);
    g.fillText(text, dx + 44, cy + fs * 0.36);
  });
  return down(cv, 1448, 119);
}

/* ---------------- bands in use ---------------- */

export type BrandView = {
  enabled: boolean;
  details: BrandDetails;
  header: { custom: boolean; url: string };
  footer: { custom: boolean; url: string };
  version: string;
  pending: number;
  failed: number;
  failedList: { url: string; reason: string }[];
};

/** The bands in use: the dealer's own PNGs, else the automatic bands. */
export async function bandsFor(v: BrandView): Promise<{ header: Drawable; footer: Drawable }> {
  await fontsReady();
  const logo = !v.header.custom && v.details.logo ? await loadPicture(v.details.logo).catch(() => null) : null;
  const header = v.header.custom ? await loadPicture(v.header.url) : drawHeader(v.details, logo);
  const footer = v.footer.custom ? await loadPicture(v.footer.url) : drawFooter(v.details);
  return { header, footer };
}

/* ---------------- branding one photo ---------------- */

function toJpeg(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('could not save'))), 'image/jpeg', q));
}

/** pa_brand_apply: 4:3 canvas as wide as the top band (min 1448 px); photo fills the middle, centred cover crop. */
export function applyBands(photo: Drawable, header: Drawable, footer: Drawable) {
  const CW = Math.max(1448, header.width);
  const HH = Math.round((header.height * CW) / header.width);
  const FH = Math.round((footer.height * CW) / footer.width);
  const CH = Math.round((CW * 3) / 4);
  const PH = CH - HH - FH;
  if (PH < CH / 3) throw new Error('the bands are too tall');
  const out = canvas(CW, CH);
  const g = out.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, CW, CH);
  g.imageSmoothingQuality = 'high';
  const sc = Math.max(CW / photo.width, PH / photo.height);
  const cw = CW / sc;
  const ch = PH / sc;
  const sx = Math.max(0, (photo.width - cw) / 2);
  const sy = Math.max(0, (photo.height - ch) / 2);
  g.drawImage(photo, sx, sy, Math.min(cw, photo.width), Math.min(ch, photo.height), 0, HH, CW, PH);
  g.drawImage(header, 0, 0, CW, HH);
  g.drawImage(footer, 0, CH - FH, CW, FH);
  return { canvas: out, lay: [CW, CH, HH, FH] };
}

function cleanCopy(photo: Drawable) {
  const sc = Math.min(1, 1600 / Math.max(photo.width, photo.height));
  const c = canvas(Math.max(1, Math.round(photo.width * sc)), Math.max(1, Math.round(photo.height * sc)));
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(photo, 0, 0, c.width, c.height);
  return c;
}

/** pa_brand_unbrand without a clean copy: cut the photo out of the branded picture. */
function cutOut(branded: Drawable, lay: number[] | null) {
  const L = lay && lay.length === 4 && lay[0] ? lay : [1448, 1086, 160, 119];
  const k = branded.width / L[0];
  const y = Math.round(L[2] * k);
  const hh = Math.max(1, Math.round((L[1] - L[2] - L[3]) * k));
  const c = canvas(branded.width, hh);
  c.getContext('2d')!.drawImage(branded, 0, y, branded.width, hh, 0, 0, branded.width, hh);
  return c;
}

async function upload(blob: Blob, name: string): Promise<string> {
  const form = new FormData();
  form.append('files', new File([blob], name, { type: 'image/jpeg' }));
  const r = await api<{ files: { url: string }[]; errors: { error: string }[] }>('/dealer/media', { form });
  if (!r.files[0]) throw new Error(r.errors[0]?.error || 'could not save');
  return r.files[0].url;
}

async function runJob(j: Job, bands: { header: Drawable; footer: Drawable }, version: string) {
  if (j.kind === 'p') {
    // no longer the main photo: back to its clean copy
    let to = j.orig;
    if (!to) to = await upload(await toJpeg(cutOut(await loadPicture(j.url), j.lay), 0.9), 'photo.jpg');
    await api('/dealer/branding/done', { body: { kind: 'p', vehicleId: j.vehicleId, from: j.url, to } });
    return;
  }
  const photo = await loadPicture(j.source);
  const { canvas: out, lay } = applyBands(photo, bands.header, bands.footer);
  const orig = j.orig || (await upload(await toJpeg(cleanCopy(photo), 0.9), 'photo_o.jpg'));
  const to = await upload(await toJpeg(out, 0.88), 'photo_b.jpg');
  await api('/dealer/branding/done', { body: { kind: 'b', vehicleId: j.vehicleId, from: j.url, to, orig, src: j.src, lay, version } });
}

/* ---------------- brandRun: a few photos at a time with a progress pill ---------------- */

let busy = false;
const listeners = new Set<() => void>();
export const onBrandingChange = (f: () => void): (() => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

function pill() {
  let el = document.getElementById('brandPill');
  if (!el) {
    el = document.createElement('div');
    el.id = 'brandPill';
    el.setAttribute('style', 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;background:#0b2340;color:#fff;font:600 13px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:10px 16px;border-radius:999px;box-shadow:0 10px 30px rgba(2,8,23,.3);max-width:92vw;transition:opacity .3s');
    document.body.appendChild(el);
  }
  return el;
}
function hidePill(ms: number) {
  setTimeout(() => {
    const el = document.getElementById('brandPill');
    if (el) el.remove();
  }, ms);
}

/**
 * Adds the bands to every main photo that does not have the current bands yet (new uploads, CSV / XML photo links,
 * photos from before branding, after a band change) and puts former main photos back to their clean copy.
 * Safe to call any time: it does nothing when branding is off or every photo is up to date.
 */
export async function brandRun(onDone?: (done: number, failed: number) => void) {
  if (busy || typeof window === 'undefined' || !auth.token()) return;
  busy = true;
  let done = 0;
  let failed = 0;
  let el: HTMLElement | null = null;
  try {
    let first = await api<{ jobs: Job[]; remaining: number; version: string }>('/dealer/branding/jobs?max=4');
    if (!first.jobs.length) return;
    const view = await api<BrandView>('/dealer/branding');
    let bands = await bandsFor(view);
    let version = view.version;
    const tried = new Set<string>();
    el = pill();
    el.textContent = 'Adding your branding bands to photos…';
    for (let round = 0; round < 500 && first.jobs.length; round++) {
      if (first.version !== version) {
        const v = await api<BrandView>('/dealer/branding');
        bands = await bandsFor(v);
        version = v.version;
      }
      let progress = false;
      for (const j of first.jobs) {
        const key = `${j.kind}|${j.vehicleId}|${j.url}`;
        if (tried.has(key)) continue; // never redo a photo twice in one run
        tried.add(key);
        try {
          await runJob(j, bands, version);
          done++;
          progress = true;
        } catch (e) {
          failed++;
          progress = true;
          await api('/dealer/branding/failed', { body: { url: j.url, reason: (e as Error).message } }).catch(() => {});
        }
        el.textContent = `Branding photos… ${done} done${first.remaining - done - failed > 0 ? `, ${Math.max(0, first.remaining - done - failed)} to go` : ''}`;
      }
      if (!progress) break;
      first = await api('/dealer/branding/jobs?max=4');
    }
    el.textContent = `${done ? `✓ Branding added to ${done} photo${done === 1 ? '' : 's'}` : 'Photos checked'}${failed ? ` · ${failed} could not be branded (see Website content › Photo branding)` : ''}`;
    hidePill(failed ? 9000 : 4500);
  } catch (e) {
    if (el) {
      el.textContent = `Photo branding stopped: ${(e as Error).message}`;
      hidePill(7000);
    }
  } finally {
    busy = false;
    listeners.forEach((f) => f());
    onDone?.(done, failed);
  }
}
