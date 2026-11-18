import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { cpus } from 'os';
import { isAbsolute, join } from 'path';
import { CUSTOM, CUSTOM_LAYOUT, DEFAULT_PRESET, PRESET_MAP, PRESETS, TRANSPARENT, TRANSPARENT_LAYOUT, type StudioPreset } from './studio-backgrounds.js';

/**
 * VEHICLE PHOTO STUDIO (background replacement)
 *
 * 1. CUT-OUT (slow part, once per photo, cached): the vehicle is separated from its background with a segmentation
 *    model, then the mask is cleaned so ONLY the whole vehicle stays:
 *      - stray pieces (other cars, poles, lot clutter) not attached to the vehicle are removed,
 *      - faint left-overs around it are cleared (no halo, no "ghost" of the old background),
 *      - closed holes inside the vehicle (windows the model left out) are filled, so the glass keeps its own
 *        reflections instead of turning white or showing the new background through it,
 *      - the soft anti-aliased edge stays, and its colour is taken from the vehicle (no grey / green fringe),
 *      - the vehicle gets a gentle, uniform exposure / contrast correction (same curve on R, G and B: the paint
 *        colour and plate are not changed, nothing is painted or generated).
 * 2. COMPOSITE (fast, well under a second): the cut-out is placed on one of the studio scenes (studio-backgrounds.ts),
 *    a custom photo, or nothing (transparent PNG), standing on the floor line, with
 *      - a contact shadow traced from the real bottom outline (darkest under the tyres, lighter under the body),
 *      - a soft ambient shadow, and on shiny floors a fading reflection,
 *      - the scene's light matched with a small exposure gain.
 *    Switching scenes re-uses the cached cut-out: no second segmentation.
 *
 * Runs on this server, offline: sharp (Apache-2.0), onnxruntime-node (MIT) and the ISNet "general use" model
 * (Apache-2.0, ~170 MB, `npm run photo-model`, stored in backend/models/).
 *
 * SAFE BY DESIGN: enhance() / cutout() never throw: when anything is missing or the photo is not a whole vehicle
 * (interior, close-up), the caller gets { enhanced: false, reason } and keeps the original photo.
 *
 * Settings (backend .env, all optional):
 *  PHOTO_ENHANCER=off              switch the feature off on this server
 *  PHOTO_MODEL_PATH=…              model file (default backend/models/isnet-general-use.onnx)
 *  PHOTO_ENHANCER_THREADS=2        CPU threads for one photo (default: half the cores, max 4)
 *  PHOTO_ENHANCER_TIMEOUT_MS=45000 longest time one photo may take before the original is kept
 */

export type EnhanceResult =
  | { enhanced: true; buffer: Buffer; mime: 'image/jpeg' | 'image/png'; ext: 'jpeg' | 'png'; width: number; height: number; ms: number }
  | { enhanced: false; reason: string };

export type EnhancerStatus = { available: boolean; reason?: string; model: string };

/** what the vehicle is put on: a preset id, "transparent", or "custom" with the dealer's photo */
export type BackgroundChoice = { background?: string; custom?: Buffer | null };

/** the cleaned, cut-out vehicle (kept in a small cache so other backgrounds are instant) */
export interface Cutout {
  key: string;
  /** the photo as it was processed (upright, ≤ 2048 px), JPEG — for the "before" view */
  workJpeg: Buffer;
  W: number;
  H: number;
  /** vehicle box in the processed photo */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** the vehicle only, cropped to the box, RGBA PNG */
  png: Buffer;
  bw: number;
  bh: number;
  ms: number;
}
export type CutoutResult = { ok: true; cutout: Cutout; cached: boolean } | { ok: false; reason: string };

/* minimal shapes of the two native packages (imported at run time so the API also starts without them) */
type SharpImg = {
  rotate(): SharpImg;
  flip(): SharpImg;
  resize(w?: number | null, h?: number | null, o?: Record<string, unknown>): SharpImg;
  removeAlpha(): SharpImg;
  toColourspace(c: string): SharpImg;
  ensureAlpha(a?: number): SharpImg;
  extract(r: { left: number; top: number; width: number; height: number }): SharpImg;
  joinChannel(c: Buffer, o?: Record<string, unknown>): SharpImg;
  composite(l: Record<string, unknown>[]): SharpImg;
  flatten(o: { background: string }): SharpImg;
  blur(s?: number): SharpImg;
  raw(): SharpImg;
  png(o?: Record<string, unknown>): SharpImg;
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
const OUT_MIN = 1600; // final photo: long side 1600 … 2400 px, the photo's own aspect ratio (4:3 … 2.1:1)
const OUT_MAX = 2400;
const IDLE_UNLOAD_MS = 10 * 60_000; // free the model's memory after 10 minutes without photos
const CACHE_SIZE = 20; // cut-outs kept for "try another background"

type Task = { run: () => Promise<void>; high: boolean };
type Layout = Omit<StudioPreset, 'svg' | 'id' | 'name' | 'desc'>;

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
  private readonly cache = new Map<string, Cutout>();
  private readonly bgCache = new Map<string, Buffer>();

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

  /** the studio scenes the portal offers (plus "transparent" and "custom") */
  backgrounds() {
    return PRESETS.map((p) => ({ id: p.id, name: p.name, desc: p.desc }));
  }

  /** a scene as a JPEG (thumbnail 480 × 360 for the picker, or any size) */
  async backgroundImage(id: string, w = 480, h = 360): Promise<Buffer | null> {
    const p = PRESET_MAP.get(id);
    const sharp = await this.loadSharp();
    if (!p || !sharp) return null;
    return sharp(await this.sceneRaw(p, w, h)).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  }

  /**
   * Enhance one photo: cut out + put on the chosen background (default: white cyclorama studio). Never throws.
   * priority 'high' = a dealer waiting in the upload screen (goes before import jobs).
   * maxWaitMs: give up (keep the original) when the photo cannot start within this time because others are queued.
   */
  async enhance(input: Buffer, opts: { priority?: 'high' | 'low'; maxWaitMs?: number } & BackgroundChoice = {}): Promise<EnhanceResult> {
    const c = await this.cutout(input, opts);
    if (!c.ok) return { enhanced: false, reason: c.reason };
    try {
      const r = await this.render(c.cutout, opts);
      return { enhanced: true, buffer: r.buffer, mime: r.mime, ext: r.ext, width: r.width, height: r.height, ms: c.cutout.ms };
    } catch (e) {
      return { enhanced: false, reason: (e as Error).message || 'failed' };
    }
  }

  /** the cleaned cut-out of the vehicle (cached by the photo's bytes). Never throws. */
  async cutout(input: Buffer, opts: { priority?: 'high' | 'low'; maxWaitMs?: number } = {}): Promise<CutoutResult> {
    try {
      const key = createHash('sha1').update(input).digest('hex');
      const hit = this.cache.get(key);
      if (hit) {
        this.cache.delete(key);
        this.cache.set(key, hit); // most recently used
        return { ok: true, cutout: hit, cached: true };
      }
      const st = await this.status();
      if (!st.available) return { ok: false, reason: st.reason || 'not available' };
      const r = await this.schedule(() => this.segment(input, key), opts.priority !== 'low', opts.maxWaitMs ?? (opts.priority === 'low' ? 0 : 60_000));
      if (r.ok) {
        this.cache.set(key, r.cutout);
        while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
      }
      return r;
    } catch (e) {
      return { ok: false, reason: (e as Error).message || 'failed' };
    }
  }

  /* ---------------- queue: one photo at a time (the model already uses several CPU threads) ---------------- */

  private schedule(job: () => Promise<CutoutResult>, high: boolean, maxWaitMs: number): Promise<CutoutResult> {
    return new Promise<CutoutResult>((resolve) => {
      let settled = false;
      const finish = (r: CutoutResult) => {
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
          // the photo keeps running when the time is up (the CPU cannot be interrupted), but the caller is answered
          const timer = setTimeout(() => finish({ ok: false, reason: `took longer than ${Math.round(this.timeoutMs / 1000)} s` }), this.timeoutMs);
          try {
            finish(await job());
          } catch (e) {
            this.log.warn(`photo kept as it was: ${(e as Error).message}`);
            finish({ ok: false, reason: (e as Error).message || 'failed' });
          } finally {
            clearTimeout(timer);
          }
        },
      };
      if (maxWaitMs > 0)
        waitTimer = setTimeout(() => {
          const i = this.queue.indexOf(task);
          if (i >= 0) this.queue.splice(i, 1);
          finish({ ok: false, reason: 'the server is busy enhancing other photos' });
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

  protected async loadSharp(): Promise<SharpFn | null> {
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
      })
        .then((s) => {
          this.log.log(`background-removal model loaded (${this.threads} threads)`);
          return s;
        })
        .catch((e: Error) => {
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

  /* ---------------- 1. cut-out ---------------- */

  /** the model's foreground mask (0…255, W × H) for the processed photo — replaceable in tests */
  protected async predictMask(rgb: Buffer, W: number, H: number): Promise<Buffer | null> {
    const sharp = this.sharp!;
    const small = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
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
    if (!(ma - mi > 1e-6)) return null;
    const m8 = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) m8[i] = Math.round(((pred[i] - mi) / (ma - mi)) * 255);
    const big = await sharp(m8, { raw: { width: SIZE, height: SIZE, channels: 1 } })
      .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('b-w') // keep ONE channel (sharp would otherwise return RGB)
      .raw()
      .toBuffer();
    return big.length === W * H ? big : null;
  }

  /** decode → mask → clean-up → checks → colour → cut-out */
  async segment(input: Buffer, key = ''): Promise<CutoutResult> {
    const t0 = Date.now();
    const sharp = await this.loadSharp();
    if (!sharp) return { ok: false, reason: 'image packages are not installed' };
    const meta = await sharp(input, { failOn: 'none' }).metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: 'the photo could not be read' };
    if ((meta.pages ?? 1) > 1 || meta.format === 'gif') return { ok: false, reason: 'animated photos are kept as they are' };
    if (Math.min(meta.width, meta.height) < 200) return { ok: false, reason: 'the photo is too small' };

    // the photo upright (EXIF), at most 2048 px, as raw RGB
    const work = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(WORK_MAX, WORK_MAX, { fit: 'inside', withoutEnlargement: true })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = work.info.width;
    const H = work.info.height;
    if (work.info.channels !== 3) return { ok: false, reason: 'unsupported colour format' };

    const raw = await this.predictMask(work.data, W, H);
    if (!raw) return { ok: false, reason: 'no vehicle found in the photo' };
    const alpha = await refineMask(sharp, raw, W, H);
    if (!alpha) return { ok: false, reason: 'no vehicle found in the photo' };
    const box = subjectBox(alpha, W, H);
    if (!box) return { ok: false, reason: 'no vehicle found in the photo' };
    const check = isExteriorShot(box, W, H);
    if (check) return { ok: false, reason: check };

    // edge colour from the vehicle itself (no fringe of the old background), then the gentle exposure correction
    const rgb = await decontaminateEdges(sharp, work.data, alpha, W, H);
    autoTone(rgb, alpha);

    const bw = box.x1 - box.x0 + 1;
    const bh = box.y1 - box.y0 + 1;
    // (two steps: in one pipeline sharp would crop the photo before adding the mask channel)
    const full = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
      .raw()
      .toBuffer();
    const png = await sharp(full, { raw: { width: W, height: H, channels: 4 } })
      .extract({ left: box.x0, top: box.y0, width: bw, height: bh })
      .png({ compressionLevel: 3 })
      .toBuffer();
    const workJpeg = await sharp(work.data, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    return { ok: true, cached: false, cutout: { key, workJpeg, W, H, box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }, png, bw, bh, ms: Date.now() - t0 } };
  }

  /* ---------------- 2. composite ---------------- */

  /** the scene at w × h as a PNG (cached; outdoor scenes with their depth-of-field blur) */
  private async sceneRaw(p: StudioPreset, w: number, h: number): Promise<Buffer> {
    const k = `${p.id}:${w}x${h}`;
    const hit = this.bgCache.get(k);
    if (hit) return hit;
    const sharp = this.sharp!;
    let png = await sharp(Buffer.from(p.svg(w, h))).resize(w, h, { fit: 'cover' }).removeAlpha().png({ compressionLevel: 2 }).toBuffer();
    const sigma = (p.blur / 100) * w;
    if (sigma >= 0.6) png = await sharp(png).blur(sigma).removeAlpha().png({ compressionLevel: 2 }).toBuffer();
    this.bgCache.set(k, png);
    while (this.bgCache.size > 24) this.bgCache.delete(this.bgCache.keys().next().value as string);
    return png;
  }

  /**
   * The cut-out on a background. o.preview: smaller JPEG (≤ 1400 px) plus the matching "before" image (the original
   * photo moved and scaled exactly like the vehicle, so a before / after slider lines up pixel for pixel).
   */
  async render(c: Cutout, choice: BackgroundChoice, o: { preview?: boolean } = {}) {
    const sharp = await this.loadSharp();
    if (!sharp) throw new Error('image packages are not installed');
    const want = choice.background || '';
    const id = want === TRANSPARENT ? TRANSPARENT : want === CUSTOM && choice.custom ? CUSTOM : PRESET_MAP.has(want) ? want : DEFAULT_PRESET;
    const preset = PRESET_MAP.get(id);
    const L: Layout = preset ?? (id === TRANSPARENT ? TRANSPARENT_LAYOUT : CUSTOM_LAYOUT);

    // canvas: the photo's own aspect ratio (4:3 … 2.1:1), long side 1600 … 2400 px
    let aspect = c.W / c.H;
    if (aspect < 1.25) aspect = 4 / 3;
    if (aspect > 2.1) aspect = 2.1;
    let OW = Math.min(OUT_MAX, Math.max(OUT_MIN, Math.max(c.W, c.H)));
    if (o.preview) OW = Math.min(OW, 1400);
    const OH = Math.round(OW / aspect);

    // size and place: fits maxW × maxH, never more than 1.6 × the processed photo, tyres on the floor line
    const groundY = Math.round(OH * L.ground);
    let k = Math.min((OW * L.maxW) / c.bw, (OH * L.maxH) / c.bh, (1.6 * OW) / Math.max(c.W, 1));
    if (c.bh * k > groundY - OH * 0.04) k = (groundY - OH * 0.04) / c.bh;
    const sw = Math.max(1, Math.round(c.bw * k));
    const sh = Math.max(1, Math.round(c.bh * k));
    const left = Math.round((OW - sw) / 2);
    const top = groundY - sh;

    // the vehicle at its size (+ the scene's light: same gain on R, G and B)
    const sub = await sharp(c.png).resize(sw, sh, { fit: 'fill', kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const subRaw = sub.data;
    const gain = 1 + L.exposure;
    if (Math.abs(gain - 1) > 0.001)
      for (let i = 0; i < subRaw.length; i += 4) {
        subRaw[i] = Math.min(255, Math.round(subRaw[i] * gain));
        subRaw[i + 1] = Math.min(255, Math.round(subRaw[i + 1] * gain));
        subRaw[i + 2] = Math.min(255, Math.round(subRaw[i + 2] * gain));
      }
    const subject = await sharp(subRaw, { raw: { width: sw, height: sh, channels: 4 } }).png({ compressionLevel: 1 }).toBuffer();

    const layers: Record<string, unknown>[] = [];
    // shiny floor: the vehicle mirrored below the tyres, fading out
    if (L.reflection > 0 && groundY < OH - 2) {
      const rh = Math.max(2, Math.min(OH - groundY, sh, Math.round(sh * 0.42)));
      const flipped = await sharp(subRaw, { raw: { width: sw, height: sh, channels: 4 } })
        .flip()
        .extract({ left: 0, top: 0, width: sw, height: rh })
        .raw()
        .toBuffer();
      for (let y = 0; y < rh; y++) {
        const f = L.reflection * Math.pow(1 - y / rh, 2);
        for (let x = 0, i = y * sw * 4 + 3; x < sw; x++, i += 4) flipped[i] = Math.round(flipped[i] * f);
      }
      const refl = await sharp(flipped, { raw: { width: sw, height: rh, channels: 4 } }).blur(Math.max(1, sh * 0.009)).png().toBuffer();
      layers.push({ input: refl, left, top: groundY - 1 });
    }
    // ground shadow traced from the vehicle's bottom outline
    layers.push({ input: await groundShadow(sharp, subRaw, sw, sh, left, top, groundY, OW, OH, L.shadow), left: 0, top: 0 });
    layers.push({ input: subject, left, top });

    let out: Buffer;
    let mime: 'image/jpeg' | 'image/png' = 'image/jpeg';
    if (id === TRANSPARENT) {
      out = await sharp({ create: { width: OW, height: OH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(layers)
        .png({ compressionLevel: 6 })
        .toBuffer();
      mime = 'image/png';
      // the preview shows the cut-out on a light checkerboard-free white
      if (o.preview) out = await sharp(out).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
    } else {
      const base =
        id === CUSTOM
          ? await sharp(choice.custom!, { failOn: 'none' }).rotate().resize(OW, OH, { fit: 'cover' }).removeAlpha().png().toBuffer()
          : await this.sceneRaw(preset!, OW, OH);
      out = await sharp(base)
        .composite(layers)
        .flatten({ background: '#ffffff' })
        .jpeg(o.preview ? { quality: 82 } : { quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();
    }

    const before = o.preview ? await this.beforeImage(c, k, left, top, OW, OH) : undefined;
    const isPng = !o.preview && mime === 'image/png';
    return {
      buffer: out,
      mime: isPng ? ('image/png' as const) : ('image/jpeg' as const),
      ext: isPng ? ('png' as const) : ('jpeg' as const),
      width: OW,
      height: OH,
      before,
    };
  }

  /** the original photo scaled / moved like the vehicle (grey where it does not reach) */
  private async beforeImage(c: Cutout, k: number, left: number, top: number, OW: number, OH: number): Promise<Buffer> {
    const sharp = this.sharp!;
    const Ws = Math.max(1, Math.round(c.W * k));
    const Hs = Math.max(1, Math.round(c.H * k));
    const ox = Math.round(left - c.box.x0 * k);
    const oy = Math.round(top - c.box.y0 * k);
    const sx = Math.max(0, -ox);
    const sy = Math.max(0, -oy);
    const w = Math.min(Ws - sx, OW - Math.max(0, ox));
    const h = Math.min(Hs - sy, OH - Math.max(0, oy));
    const layers: Record<string, unknown>[] = [];
    if (w > 0 && h > 0) {
      const part = await sharp(c.workJpeg).resize(Ws, Hs, { fit: 'fill' }).extract({ left: sx, top: sy, width: w, height: h }).toBuffer();
      layers.push({ input: part, left: Math.max(0, ox), top: Math.max(0, oy) });
    }
    return sharp({ create: { width: OW, height: OH, channels: 3, background: { r: 120, g: 124, b: 128 } } }).composite(layers).jpeg({ quality: 82 }).toBuffer();
  }
}

/* ---------------- mask clean-up ---------------- */

/**
 * Raw model mask → final alpha (W × H), or null when nothing solid is left:
 *  1. soft threshold (faint noise → 0, nearly solid → 255, the anti-aliased edge stays soft);
 *  2. ONLY the vehicle: the largest solid piece plus small pieces next to it / pieces inside its box (a mirror or
 *     antenna the model drew detached); everything else (other cars, people, poles) goes;
 *  3. no left-overs: soft pixels away from the kept vehicle are cleared (no halo / smudge of the old lot);
 *  4. glass: closed holes inside the vehicle (up to 18 % of its area: windows, gaps the model missed) are filled, so
 *     the windows keep their own reflections instead of showing the new background.
 */
export async function refineMask(sharp: SharpFn, raw: Buffer, W: number, H: number): Promise<Buffer | null> {
  const n = W * H;
  const a = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    a[i] = v < 32 ? 0 : v > 224 ? 255 : Math.round(((v - 32) / 192) * 255);
  }

  // 2. connected solid pieces (4-neighbour)
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const pieces: { area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let s = 0; s < n; s++) {
    if (a[s] < 128 || label[s] >= 0) continue;
    const id = pieces.length;
    const pc = { area: 0, x0: W, y0: H, x1: 0, y1: 0 };
    let sp = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % W;
      const y = (p - x) / W;
      pc.area++;
      if (x < pc.x0) pc.x0 = x;
      if (x > pc.x1) pc.x1 = x;
      if (y < pc.y0) pc.y0 = y;
      if (y > pc.y1) pc.y1 = y;
      if (x > 0 && a[p - 1] >= 128 && label[p - 1] < 0) (label[p - 1] = id), (stack[sp++] = p - 1);
      if (x < W - 1 && a[p + 1] >= 128 && label[p + 1] < 0) (label[p + 1] = id), (stack[sp++] = p + 1);
      if (y > 0 && a[p - W] >= 128 && label[p - W] < 0) (label[p - W] = id), (stack[sp++] = p - W);
      if (y < H - 1 && a[p + W] >= 128 && label[p + W] < 0) (label[p + W] = id), (stack[sp++] = p + W);
    }
    pieces.push(pc);
  }
  if (!pieces.length) return null;
  let main = 0;
  for (let i = 1; i < pieces.length; i++) if (pieces[i].area > pieces[main].area) main = i;
  const M = pieces[main];
  if (M.area < n * 0.02) return null;
  const pad = Math.round(Math.max(W, H) * 0.02);
  const keep = new Uint8Array(pieces.length);
  keep[main] = 1;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (i === main || p.area < M.area * 0.0005) continue;
    const touches = p.x1 >= M.x0 - pad && p.x0 <= M.x1 + pad && p.y1 >= M.y0 - pad && p.y0 <= M.y1 + pad;
    const inside = p.x0 >= M.x0 && p.x1 <= M.x1 && p.y0 >= M.y0 && p.y1 <= M.y1;
    // inside the vehicle box, or a small piece right next to it — never a large separate object (a car beside it)
    if (inside || (touches && p.area < M.area * 0.03)) keep[i] = 1;
  }
  const solid = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const l = label[i];
    if (l >= 0) {
      if (keep[l]) solid[i] = 255;
      else a[i] = 0;
    }
  }

  // 3. soft pixels away from the kept vehicle are cleared
  const r = Math.max(2, Math.round(Math.max(W, H) / 350));
  const near = await sharp(solid, { raw: { width: W, height: H, channels: 1 } }).blur(r).toColourspace('b-w').raw().toBuffer();
  if (near.length === n) for (let i = 0; i < n; i++) if (near[i] < 6 && a[i] < 255) a[i] = 0;

  // 4. closed holes (not connected to the photo's border) inside the vehicle → filled
  const seen = new Uint8Array(n);
  let sp = 0;
  const push = (p: number) => {
    if (!seen[p] && a[p] < 128) {
      seen[p] = 1;
      stack[sp++] = p;
    }
  };
  for (let x = 0; x < W; x++) push(x), push((H - 1) * W + x);
  for (let y = 0; y < H; y++) push(y * W), push(y * W + W - 1);
  while (sp) {
    const p = stack[--sp];
    const x = p % W;
    if (x > 0) push(p - 1);
    if (x < W - 1) push(p + 1);
    if (p >= W) push(p - W);
    if (p < n - W) push(p + W);
  }
  let vehicleArea = 0;
  for (let i = 0; i < n; i++) if (a[i] >= 128) vehicleArea++;
  const hole = new Int32Array(n).fill(-1);
  const holeArea: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || a[s] >= 128 || hole[s] >= 0) continue;
    const id = holeArea.length;
    let area = 0;
    sp = 0;
    stack[sp++] = s;
    hole[s] = id;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % W;
      if (x > 0 && !seen[p - 1] && a[p - 1] < 128 && hole[p - 1] < 0) (hole[p - 1] = id), (stack[sp++] = p - 1);
      if (x < W - 1 && !seen[p + 1] && a[p + 1] < 128 && hole[p + 1] < 0) (hole[p + 1] = id), (stack[sp++] = p + 1);
      if (p >= W && !seen[p - W] && a[p - W] < 128 && hole[p - W] < 0) (hole[p - W] = id), (stack[sp++] = p - W);
      if (p < n - W && !seen[p + W] && a[p + W] < 128 && hole[p + W] < 0) (hole[p + W] = id), (stack[sp++] = p + W);
    }
    holeArea.push(area);
  }
  if (holeArea.length) for (let i = 0; i < n; i++) if (hole[i] >= 0 && holeArea[hole[i]] <= vehicleArea * 0.18) a[i] = 255;
  return a;
}

/**
 * Gentle exposure / contrast for the vehicle: a brightness curve with every pixel's colour ratio kept (so the paint
 * colour, plate and details stay as photographed), brightening at most 8 %. Based on the vehicle's own darkest / brightest pixels.
 */
export function autoTone(rgb: Buffer, alpha: Buffer) {
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < alpha.length; i += 3) {
    if (alpha[i] !== 255) continue;
    const j = i * 3;
    hist[Math.round(0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2])]++;
    count++;
  }
  if (count < 500) return;
  const pct = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= count * q) return v;
    return 255;
  };
  const lo = pct(0.005);
  const hi = pct(0.995);
  if (hi - lo < 40) return;
  const off = Math.min(lo, 14) * 0.5; // the darkest tones go down only a little (black paint stays black, not crushed)
  const g = Math.max(1, Math.min(1.08, 250 / Math.max(1, hi - off)));
  const contrast = 1.02;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, Math.round(128 + ((v - off) * g - 128) * contrast)));
  // the curve is applied to the brightness only and every pixel's R:G:B ratio is kept (paint hue and saturation stay)
  for (let i = 0; i < alpha.length; i++) {
    if (!alpha[i]) continue;
    const j = i * 3;
    const l = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
    if (l < 1) continue;
    const f = lut[Math.min(255, Math.round(l))] / l;
    rgb[j] = Math.min(255, Math.round(rgb[j] * f));
    rgb[j + 1] = Math.min(255, Math.round(rgb[j + 1] * f));
    rgb[j + 2] = Math.min(255, Math.round(rgb[j + 2] * f));
  }
}

/**
 * The shadow layer (RGBA, OW × OH, black with alpha), drawn at ¼ size then scaled up:
 *  - contact shadow: for every column of the vehicle, a dark band from its lowest point down to the floor line —
 *    strongest where the vehicle touches the floor (tyres), fading where the body is higher up;
 *  - ambient: a soft wide oval under the whole vehicle.
 */
async function groundShadow(sharp: SharpFn, subRaw: Buffer, sw: number, sh: number, left: number, top: number, groundY: number, OW: number, OH: number, strength: number): Promise<Buffer> {
  const S = 4;
  const w = Math.ceil(OW / S);
  const h = Math.ceil(OH / S);
  const contact = Buffer.alloc(w * h);
  const fade = Math.max(2, sh * 0.05);
  for (let x = 0; x < sw; x++) {
    let low = -1;
    for (let y = sh - 1; y >= Math.floor(sh * 0.5); y--)
      if (subRaw[(y * sw + x) * 4 + 3] >= 128) {
        low = y;
        break;
      }
    if (low < 0) continue;
    const wgt = Math.exp(-(sh - 1 - low) / fade); // how far above the floor this column ends
    const cx = Math.floor((left + x) / S);
    if (cx < 0 || cx >= w) continue;
    const y0 = Math.max(0, Math.floor((top + low - sh * 0.01) / S));
    const y1 = Math.min(h - 1, Math.ceil((groundY + sh * 0.01) / S));
    const v = Math.round(255 * wgt);
    for (let y = y0; y <= y1; y++) {
      const i = y * w + cx;
      if (contact[i] < v) contact[i] = v;
    }
  }
  const cb = await sharp(contact, { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.6, (sh * 0.012) / S)).toColourspace('b-w').raw().toBuffer();
  const src = cb.length === w * h ? cb : contact;
  const alpha = Buffer.alloc(w * h);
  const ecx = (left + sw / 2) / S;
  const ecy = (groundY - sh * 0.01) / S;
  const rx = (sw * 0.56) / S;
  const ry = Math.max(2, (sh * 0.085) / S);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x - ecx) / rx;
      const dy = (y - ecy) / ry;
      const amb = Math.exp(-(dx * dx + dy * dy) * 1.6);
      alpha[y * w + x] = Math.min(255, Math.round(255 * strength * Math.max(0.9 * (src[y * w + x] / 255), 0.42 * amb)));
    }
  const black = Buffer.alloc(w * h * 3);
  const small = await sharp(black, { raw: { width: w, height: h, channels: 3 } }).joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } }).raw().toBuffer();
  return sharp(small, { raw: { width: w, height: h, channels: 4 } }).resize(OW, OH, { fit: 'fill', kernel: 'cubic' }).png({ compressionLevel: 1 }).toBuffer();
}

/**
 * Colour of every half-transparent edge pixel = average colour of the solid vehicle pixels around it
 * (blur of colour×solid ÷ blur of solid). Solid and fully transparent pixels are not changed.
 */
async function decontaminateEdges(sharp: SharpFn, rgb: Buffer, alpha: Buffer, W: number, H: number): Promise<Buffer> {
  const n = W * H;
  const out = Buffer.from(rgb);
  let edges = 0;
  for (let i = 0; i < n; i++) if (alpha[i] > 0 && alpha[i] < 255) edges++;
  if (!edges) return out;
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
  if (bm.length !== n * 3 || bs.length !== n) return out;
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

/** Box around the vehicle; rows / columns with only a stray pixel or two do not count. */
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
  // the mask is already cleaned, so thin parts (mirror tips, antenna) count: 2 solid pixels are enough
  let x0 = 0;
  while (x0 < W && cols[x0] < 2) x0++;
  let x1 = W - 1;
  while (x1 > x0 && cols[x1] < 2) x1--;
  let y0 = 0;
  while (y0 < H && rows[y0] < 2) y0++;
  let y1 = H - 1;
  while (y1 > y0 && rows[y1] < 2) y1--;
  if (x0 >= x1 || y0 >= y1) return null;
  // keep the soft edge just outside the solid box (no clipped tyre or mirror edge)
  const m = 2;
  return { x0: Math.max(0, x0 - m), y0: Math.max(0, y0 - m), x1: Math.min(W - 1, x1 + m), y1: Math.min(H - 1, y1 + m), coverage };
}

/** Interior, close-up and detail photos are kept as they are: a studio background only suits a whole vehicle. */
export function isExteriorShot(b: { x0: number; y0: number; x1: number; y1: number; coverage: number }, W: number, H: number): string {
  const edge = Math.max(3, Math.round(Math.min(W, H) * 0.006));
  const touches = [b.x0 <= edge, b.y0 <= edge, b.x1 >= W - 1 - edge, b.y1 >= H - 1 - edge].filter(Boolean).length;
  if (b.coverage > 0.8 || touches === 4 || (touches === 3 && b.coverage > 0.5)) return 'looks like an interior or close-up photo (kept as it is)';
  const bw = b.x1 - b.x0 + 1;
  const bh = b.y1 - b.y0 + 1;
  if (bw < W * 0.2 && bh < H * 0.2) return 'the vehicle is too small in the photo';
  return '';
}
