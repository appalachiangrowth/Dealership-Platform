import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { existsSync } from 'fs';
import { cpus } from 'os';
import { isAbsolute, join } from 'path';

/**
 * VEHICLE PHOTO STUDIO ENHANCER (Auto White Background)
 *
 * Cuts the vehicle out of a photo and puts it on a pure white (#FFFFFF) studio background with padding and a soft
 * ground shadow. Everything runs on this server, offline, with no paid service:
 *  - sharp            (Apache-2.0) image decoding, resizing and compositing
 *  - onnxruntime-node (MIT)        runs the segmentation model on the CPU
 *  - ISNet "general use" model (Apache-2.0, the model rembg uses; ~170 MB file, downloaded once with
 *    `npm run photo-model`, stored in backend/models/)
 *
 * SAFE BY DESIGN: enhance() never throws. When anything is missing (packages not installed, model not downloaded),
 * the photo is not a vehicle exterior (interior, close-up, nothing found), processing fails or takes too long, the
 * caller gets { enhanced: false, reason } and keeps the original photo — creating or importing a vehicle never fails
 * because of this feature.
 *
 * Settings (backend .env, all optional):
 *  PHOTO_ENHANCER=off              switch the feature off on this server
 *  PHOTO_MODEL_PATH=…              model file (default backend/models/isnet-general-use.onnx)
 *  PHOTO_ENHANCER_THREADS=2        CPU threads for one photo (default: half the cores, max 4)
 *  PHOTO_ENHANCER_TIMEOUT_MS=45000 longest time one photo may take before the original is kept
 */

export type EnhanceResult =
  | { enhanced: true; buffer: Buffer; mime: 'image/jpeg'; ext: 'jpeg'; width: number; height: number; ms: number }
  | { enhanced: false; reason: string };

export type EnhancerStatus = { available: boolean; reason?: string; model: string };

/* minimal shapes of the two native packages (imported at run time so the API also starts without them) */
type SharpImg = {
  rotate(): SharpImg;
  resize(w?: number | null, h?: number | null, o?: Record<string, unknown>): SharpImg;
  removeAlpha(): SharpImg;
  toColourspace(c: string): SharpImg;
  ensureAlpha(): SharpImg;
  extract(r: { left: number; top: number; width: number; height: number }): SharpImg;
  joinChannel(c: Buffer, o?: Record<string, unknown>): SharpImg;
  composite(l: Record<string, unknown>[]): SharpImg;
  flatten(o: { background: string }): SharpImg;
  blur(s: number): SharpImg;
  raw(): SharpImg;
  png(): SharpImg;
  jpeg(o?: Record<string, unknown>): SharpImg;
  toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number; pages?: number; format?: string }>;
};
type SharpFn = ((input?: Buffer | Record<string, unknown>, o?: Record<string, unknown>) => SharpImg) & { concurrency?(n: number): number; cache?(o: boolean): void };
type OrtTensor = { data: Float32Array | ArrayLike<number>; dims: readonly number[] };
type OrtSession = { inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>; release?(): Promise<void> };
type Ort = {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(path: string, o?: Record<string, unknown>): Promise<OrtSession> };
};

/** module names in variables: TypeScript does not need the packages installed to compile */
const SHARP = 'sharp';
const ORT = 'onnxruntime-node';

const SIZE = 1024; // ISNet input
const MEAN = [0.485, 0.456, 0.406]; // same pre-processing as rembg's "isnet-general-use" session (std 1.0)
const WORK_MAX = 2048; // longest side the photo is processed at
const OUT_W = 1600; // final photo: 1600 × 1200 (4:3, what dealers and CarGurus use)
const OUT_H = 1200;
const IDLE_UNLOAD_MS = 10 * 60_000; // free the model's memory after 10 minutes without photos

type Task = { run: () => Promise<void>; high: boolean };

@Injectable()
export class VehiclePhotoEnhancerService implements OnModuleDestroy {
  private readonly log = new Logger('PhotoEnhancer');
  private sharp: SharpFn | null = null;
  private ort: Ort | null = null;
  private session: Promise<OrtSession> | null = null;
  private loadError = '';
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly queue: Task[] = [];
  private running = false;

  readonly modelPath = (() => {
    const p = process.env.PHOTO_MODEL_PATH || join('models', 'isnet-general-use.onnx');
    return isAbsolute(p) ? p : join(process.cwd(), p);
  })();
  private readonly threads = Math.max(1, Number(process.env.PHOTO_ENHANCER_THREADS) || Math.min(4, Math.floor(cpus().length / 2) || 1));
  private readonly timeoutMs = Math.max(5000, Number(process.env.PHOTO_ENHANCER_TIMEOUT_MS) || 45_000);

  onModuleDestroy() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    void this.unload();
  }

  /** Is the feature installed on this server? (shown next to the switch in the portals) */
  async status(): Promise<EnhancerStatus> {
    const model = this.modelPath;
    if (/^(off|0|false|no)$/i.test(process.env.PHOTO_ENHANCER || '')) return { available: false, reason: 'switched off on the server (PHOTO_ENHANCER=off)', model };
    if (!(await this.loadSharp())) return { available: false, reason: 'the "sharp" package is not installed on the server', model };
    if (!(await this.loadOrt())) return { available: false, reason: 'the "onnxruntime-node" package is not installed on the server', model };
    if (!existsSync(model)) return { available: false, reason: 'the background-removal model is not downloaded yet (run: npm run photo-model)', model };
    if (this.loadError) return { available: false, reason: this.loadError, model };
    return { available: true, model };
  }

  /**
   * Enhance one photo. Never throws. priority 'high' = a dealer waiting in the upload screen (goes before import jobs).
   * maxWaitMs: give up (keep the original) when the photo cannot start within this time because others are queued.
   */
  async enhance(input: Buffer, opts: { priority?: 'high' | 'low'; maxWaitMs?: number } = {}): Promise<EnhanceResult> {
    try {
      const st = await this.status();
      if (!st.available) return { enhanced: false, reason: st.reason || 'not available' };
      return await this.schedule(input, opts.priority !== 'low', opts.maxWaitMs ?? (opts.priority === 'low' ? 0 : 60_000));
    } catch (e) {
      return { enhanced: false, reason: (e as Error).message || 'failed' };
    }
  }

  /* ---------------- queue: one photo at a time (the model already uses several CPU threads) ---------------- */

  private schedule(input: Buffer, high: boolean, maxWaitMs: number): Promise<EnhanceResult> {
    return new Promise<EnhanceResult>((resolve) => {
      let settled = false;
      const finish = (r: EnhanceResult) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      let waitTimer: NodeJS.Timeout | null = null;
      const task: Task = {
        high,
        run: async () => {
          if (waitTimer) clearTimeout(waitTimer);
          if (settled) return; // gave up waiting
          const t0 = Date.now();
          // the photo keeps running when the time is up (the CPU cannot be interrupted), but the caller is answered
          const timer = setTimeout(() => finish({ enhanced: false, reason: `took longer than ${Math.round(this.timeoutMs / 1000)} s` }), this.timeoutMs);
          try {
            const r = await this.process(input);
            finish(r.enhanced ? { ...r, ms: Date.now() - t0 } : r);
          } catch (e) {
            this.log.warn(`photo kept as it was: ${(e as Error).message}`);
            finish({ enhanced: false, reason: (e as Error).message || 'failed' });
          } finally {
            clearTimeout(timer);
          }
        },
      };
      if (maxWaitMs > 0)
        waitTimer = setTimeout(() => {
          const i = this.queue.indexOf(task);
          if (i >= 0) this.queue.splice(i, 1);
          finish({ enhanced: false, reason: 'the server is busy enhancing other photos' });
        }, maxWaitMs);
      // dealers waiting in the upload screen go before background import photos
      if (high) {
        const firstLow = this.queue.findIndex((t) => !t.high);
        if (firstLow < 0) this.queue.push(task);
        else this.queue.splice(firstLow, 0, task);
      } else this.queue.push(task);
      void this.pump();
    });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try {
      while (this.queue.length) await this.queue.shift()!.run();
    } finally {
      this.running = false;
      this.idleTimer = setTimeout(() => void this.unload(), IDLE_UNLOAD_MS);
      this.idleTimer.unref?.();
    }
  }

  /* ---------------- loading ---------------- */

  private async loadSharp(): Promise<SharpFn | null> {
    if (this.sharp) return this.sharp;
    try {
      const m = (await import(SHARP)) as { default?: SharpFn };
      this.sharp = (m.default ?? (m as unknown as SharpFn)) as SharpFn;
      return this.sharp;
    } catch {
      return null;
    }
  }

  private async loadOrt(): Promise<Ort | null> {
    if (this.ort) return this.ort;
    try {
      const m = (await import(ORT)) as Ort & { default?: Ort };
      this.ort = m.InferenceSession ? m : (m.default as Ort);
      return this.ort;
    } catch {
      return null;
    }
  }

  private getSession(): Promise<OrtSession> {
    if (!this.session) {
      const ort = this.ort!;
      this.session = ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: this.threads,
        interOpNumThreads: 1,
      }).then((s) => {
        this.log.log(`background-removal model loaded (${this.threads} threads)`);
        return s;
      }).catch((e: Error) => {
        this.session = null;
        this.loadError = `the background-removal model could not be loaded: ${e.message}`;
        throw new Error(this.loadError);
      });
    }
    return this.session;
  }

  private async unload() {
    if (this.running || !this.session) return;
    const s = this.session;
    this.session = null;
    await s.then((x) => x.release?.()).catch(() => undefined);
  }

  /* ---------------- the work ---------------- */

  /** exported for tests: decode → mask → checks → white studio photo */
  async process(input: Buffer): Promise<EnhanceResult> {
    const sharp = await this.loadSharp();
    if (!sharp || !(await this.loadOrt())) return { enhanced: false, reason: 'image packages are not installed' };
    const meta = await sharp(input, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return { enhanced: false, reason: 'the photo could not be read' };
    if ((meta.pages ?? 1) > 1 || meta.format === 'gif') return { enhanced: false, reason: 'animated photos are kept as they are' };
    if (Math.min(meta.width, meta.height) < 200) return { enhanced: false, reason: 'the photo is too small' };

    // 1) the photo upright (EXIF), at most 2048 px, as raw RGB
    const work = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(WORK_MAX, WORK_MAX, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .toColourspace('srgb') // grey-scale photos too: always 3 channels
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = work.info.width;
    const H = work.info.height;
    if (work.info.channels !== 3) return { enhanced: false, reason: 'unsupported colour format' };

    // 2) model input: 1024 × 1024, values / max, minus the mean, channels first
    const small = await sharp(work.data, { raw: { width: W, height: H, channels: 3 } })
      .resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = small.data;
    let max = 1;
    for (let i = 0; i < px.length; i++) if (px[i] > max) max = px[i];
    const plane = SIZE * SIZE;
    const tensor = new Float32Array(3 * plane);
    for (let i = 0, p = 0; p < plane; p++, i += 3) {
      tensor[p] = px[i] / max - MEAN[0];
      tensor[plane + p] = px[i + 1] / max - MEAN[1];
      tensor[2 * plane + p] = px[i + 2] / max - MEAN[2];
    }

    // 3) run the model; output 0 = mask 1 × 1 × 1024 × 1024, min–max scaled to 0…255
    const session = await this.getSession();
    const ort = this.ort!;
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]) });
    const pred = out[session.outputNames[0]].data;
    let mi = Infinity;
    let ma = -Infinity;
    for (let i = 0; i < plane; i++) {
      const v = pred[i];
      if (v < mi) mi = v;
      if (v > ma) ma = v;
    }
    if (!(ma - mi > 1e-6)) return { enhanced: false, reason: 'no vehicle found in the photo' };
    const m8 = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) m8[i] = Math.round(((pred[i] - mi) / (ma - mi)) * 255);
    const maskBig = await sharp(m8, { raw: { width: SIZE, height: SIZE, channels: 1 } })
      .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('b-w') // keep ONE channel (sharp would otherwise return RGB)
      .raw()
      .toBuffer();
    if (maskBig.length !== W * H) return { enhanced: false, reason: 'mask size mismatch' };

    // 4) clean the mask: faint background noise → 0 (keeps the white pure), nearly solid → 255, soft edges kept
    const alpha = Buffer.alloc(W * H);
    for (let i = 0; i < alpha.length; i++) {
      const v = maskBig[i];
      alpha[i] = v < 20 ? 0 : v > 235 ? 255 : Math.round(((v - 20) / 215) * 255);
    }
    const box = subjectBox(alpha, W, H);
    if (!box) return { enhanced: false, reason: 'no vehicle found in the photo' };
    const check = isExteriorShot(box, W, H);
    if (check) return { enhanced: false, reason: check };

    // 5) edge clean-up: the soft edge pixels still hold some of the old background colour (a grey / green halo on
    //    white). Their colour is taken from the solid vehicle pixels next to them instead (alpha stays soft).
    const rgb = await decontaminateEdges(sharp, work.data, alpha, W, H);

    // 6) the cut-out vehicle (RGBA) cropped to its box
    // (two steps: in one pipeline sharp would crop the photo before adding the mask channel)
    const full = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
      .raw()
      .toBuffer();
    const rgba = await sharp(full, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: box.x0, top: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 })
      .png()
      .toBuffer();

    // 7) size and place it: at most 84 % of the width and 70 % of the height, centred, standing at 84 % of the height
    const bw = box.x1 - box.x0 + 1;
    const bh = box.y1 - box.y0 + 1;
    const k = Math.min((OUT_W * 0.84) / bw, (OUT_H * 0.7) / bh);
    const sw = Math.max(1, Math.round(bw * k));
    const sh = Math.max(1, Math.round(bh * k));
    const left = Math.round((OUT_W - sw) / 2);
    const top = Math.max(0, Math.min(OUT_H - sh, Math.round(OUT_H * 0.84 - sh)));
    const subject = await sharp(rgba).resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();

    // 8) soft ground shadow under the vehicle (blurred ellipse), so it does not float
    const groundY = top + sh;
    const shadowSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}">` +
        `<ellipse cx="${OUT_W / 2}" cy="${groundY - Math.round(sh * 0.02)}" rx="${Math.round(sw * 0.47)}" ry="${Math.max(6, Math.round(sh * 0.055))}" fill="#000" fill-opacity="0.32"/>` +
        `</svg>`,
    );
    const shadow = await sharp(shadowSvg).blur(Math.max(4, Math.round(sh * 0.035))).png().toBuffer();

    const jpg = await sharp({ create: { width: OUT_W, height: OUT_H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
      .composite([
        { input: shadow, left: 0, top: 0 },
        { input: subject, left, top },
      ])
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    return { enhanced: true, buffer: jpg, mime: 'image/jpeg', ext: 'jpeg', width: OUT_W, height: OUT_H, ms: 0 };
  }
}

/**
 * Colour of every half-transparent edge pixel = average colour of the solid vehicle pixels around it
 * (blur of colour×solid ÷ blur of solid). Solid and fully transparent pixels are not changed.
 */
async function decontaminateEdges(sharp: SharpFn, rgb: Buffer, alpha: Buffer, W: number, H: number): Promise<Buffer> {
  const n = W * H;
  let edges = 0;
  for (let i = 0; i < n; i++) if (alpha[i] > 0 && alpha[i] < 255) edges++;
  if (!edges) return rgb;
  const solid = Buffer.alloc(n);
  const masked = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    if (alpha[i] === 255) {
      solid[i] = 255;
      masked[i * 3] = rgb[i * 3];
      masked[i * 3 + 1] = rgb[i * 3 + 1];
      masked[i * 3 + 2] = rgb[i * 3 + 2];
    }
  }
  const sigma = Math.max(2, Math.round(Math.max(W, H) / 400));
  const bm = await sharp(masked, { raw: { width: W, height: H, channels: 3 } }).blur(sigma).raw().toBuffer();
  const bs = await sharp(solid, { raw: { width: W, height: H, channels: 1 } }).blur(sigma).toColourspace('b-w').raw().toBuffer();
  if (bm.length !== n * 3 || bs.length !== n) return rgb;
  const out = Buffer.from(rgb);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a === 0 || a === 255 || bs[i] < 8) continue;
    const k = 255 / bs[i];
    out[i * 3] = Math.min(255, Math.round(bm[i * 3] * k));
    out[i * 3 + 1] = Math.min(255, Math.round(bm[i * 3 + 1] * k));
    out[i * 3 + 2] = Math.min(255, Math.round(bm[i * 3 + 2] * k));
  }
  return out;
}

/** Box around the vehicle; rows / columns with only a few stray pixels (reflections, noise) do not count. */
export function subjectBox(alpha: Buffer, W: number, H: number): { x0: number; y0: number; x1: number; y1: number; coverage: number } | null {
  const cols = new Uint32Array(W);
  const rows = new Uint32Array(H);
  let solid = 0;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) {
      if (alpha[o + x] >= 128) {
        cols[x]++;
        rows[y]++;
        solid++;
      }
    }
  }
  const coverage = solid / (W * H);
  if (coverage < 0.03) return null;
  const minCol = Math.max(2, Math.round(H * 0.01));
  const minRow = Math.max(2, Math.round(W * 0.01));
  let x0 = 0;
  while (x0 < W && cols[x0] < minCol) x0++;
  let x1 = W - 1;
  while (x1 > x0 && cols[x1] < minCol) x1--;
  let y0 = 0;
  while (y0 < H && rows[y0] < minRow) y0++;
  let y1 = H - 1;
  while (y1 > y0 && rows[y1] < minRow) y1--;
  if (x0 >= x1 || y0 >= y1) return null;
  return { x0, y0, x1, y1, coverage };
}

/** Interior, close-up and detail photos are kept as they are: a white background only suits a whole vehicle. */
export function isExteriorShot(b: { x0: number; y0: number; x1: number; y1: number; coverage: number }, W: number, H: number): string {
  const edge = Math.max(2, Math.round(Math.min(W, H) * 0.006));
  const touches = [b.x0 <= edge, b.y0 <= edge, b.x1 >= W - 1 - edge, b.y1 >= H - 1 - edge].filter(Boolean).length;
  if (b.coverage > 0.8 || touches === 4 || (touches === 3 && b.coverage > 0.5)) return 'looks like an interior or close-up photo (kept as it is)';
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (bw < W * 0.2 && bh < H * 0.2) return 'the vehicle is too small in the photo';
  return '';
}
