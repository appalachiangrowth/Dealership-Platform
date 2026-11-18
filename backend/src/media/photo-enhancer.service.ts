import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { cpus } from 'os';
import { isAbsolute, join } from 'path';
import { CUSTOM, CUSTOM_LAYOUT, DEFAULT_PRESET, PRESET_MAP, PRESETS, TRANSPARENT, TRANSPARENT_CLEAN, TRANSPARENT_LAYOUT, type StudioPreset } from './studio-backgrounds.js';

/**
 * VEHICLE PHOTO STUDIO (background replacement)
 *
 * 1. CUT-OUT (slow part, once per photo, cached): the vehicle is separated from its background with a segmentation
 *    model, then the mask is cleaned so ONLY the photographed vehicle stays (see refineMask):
 *      - narrow bridges to parked cars behind it are broken (morphological opening of the confident core) and the
 *        centred piece is kept; large lobes rising above the body's outline (a hood / roof behind the fender or
 *        A-pillar) are pruned, while mirrors, spoiler, roof rails, bumper lips and wheels are kept;
 *      - semi-transparent "ghosts" (uncertain model pixels) only count in a thin band around the vehicle;
 *      - closed holes (windows the model left out) are filled, so the glass keeps its own reflections;
 *      - the edge is pulled in ~1.6 px (0.5 px at the tyre contact line) with a smooth ~2.5 px feather, and the colour
 *        of the edge band comes from the vehicle 4.5 px+ inside (no sky / asphalt / neighbour-car fringe);
 *      - gentle exposure / contrast (brightness curve, colour ratios kept: paint and plate unchanged).
 * 2. COMPOSITE (fast): the cut-out is placed on a studio scene (studio-backgrounds.ts), a custom photo, or nothing
 *    (transparent PNG, with or without shadow), with a contact shadow + ambient occlusion and (shiny floors) a
 *    reflection that follow the vehicle's own ground line (the line through its tyres — sloped in 3/4 views).
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
    const refined = await refineMask(sharp, raw, W, H);
    if (!refined) return { ok: false, reason: 'no vehicle found in the photo' };
    const alpha = refined.alpha;
    const box = subjectBox(alpha, W, H);
    if (!box) return { ok: false, reason: 'no vehicle found in the photo' };
    const check = isExteriorShot(box, W, H);
    if (check) return { ok: false, reason: check };

    // edge colour from the vehicle itself (no fringe of the old background), then the gentle exposure correction
    const rgb = await decontaminateEdges(sharp, work.data, alpha, refined.dist, W, H);
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
    // drawn at most 1600 px wide (the scenes are soft light and blur, so scaling up loses nothing visible) — faster
    const scale = Math.min(1, 1600 / w);
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);
    let png = await sharp(Buffer.from(p.svg(dw, dh))).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().png({ compressionLevel: 2 }).toBuffer();
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
    const id = want === TRANSPARENT || want === TRANSPARENT_CLEAN ? want : want === CUSTOM && choice.custom ? CUSTOM : PRESET_MAP.has(want) ? want : DEFAULT_PRESET;
    const transparent = id === TRANSPARENT || id === TRANSPARENT_CLEAN;
    const preset = PRESET_MAP.get(id);
    const L: Layout = preset ?? (transparent ? TRANSPARENT_LAYOUT : CUSTOM_LAYOUT);

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
    const gl = groundLine(subRaw, sw, sh);
    // shiny floor: the vehicle mirrored at its own ground line, fading out
    if (L.reflection > 0 && groundY < OH - 2) {
      const rh = Math.max(2, Math.min(OH - groundY, Math.round(sh * 0.42)));
      layers.push({ input: await floorReflection(sharp, subRaw, gl, sw, sh, rh, L.reflection), left, top });
    }
    // contact shadow + ambient occlusion along the ground line (not on the "clean" transparent cut-out)
    if (id !== TRANSPARENT_CLEAN && L.shadow > 0) layers.push({ input: await groundShadow(sharp, gl, sw, sh, left, top, OW, OH, L.shadow), left: 0, top: 0 });
    layers.push({ input: subject, left, top });

    let out: Buffer;
    let mime: 'image/jpeg' | 'image/png' = 'image/jpeg';
    if (transparent) {
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

type Mask = Uint8Array;

/** approximate Euclidean distance (px) from every non-zero pixel of m to the nearest zero pixel (image edge: no bound) */
export function distInside(m: Mask, W: number, H: number): Float32Array {
  const n = W * H;
  const d = new Float32Array(n);
  const INF = 1e9;
  const D2 = Math.SQRT2;
  for (let i = 0; i < n; i++) d[i] = m[i] ? INF : 0;
  for (let y = 0; y < H; y++)
    for (let x = 0, i = y * W; x < W; x++, i++) {
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (y > 0) {
        if (d[i - W] + 1 < v) v = d[i - W] + 1;
        if (x > 0 && d[i - W - 1] + D2 < v) v = d[i - W - 1] + D2;
        if (x < W - 1 && d[i - W + 1] + D2 < v) v = d[i - W + 1] + D2;
      }
      d[i] = v;
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1, i = y * W + W - 1; x >= 0; x--, i--) {
      if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (y < H - 1) {
        if (d[i + W] + 1 < v) v = d[i + W] + 1;
        if (x < W - 1 && d[i + W + 1] + D2 < v) v = d[i + W + 1] + D2;
        if (x > 0 && d[i + W - 1] + D2 < v) v = d[i + W - 1] + D2;
      }
      d[i] = v;
    }
  return d;
}

/** pixels within r px of m (dilation) */
function dilate(m: Mask, W: number, H: number, r: number): Mask {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  const d = distInside(inv, W, H);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = m[i] || d[i] <= r ? 1 : 0;
  return out;
}

type Piece = { id: number; area: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number; border: boolean };

/** 4-connected pieces of m: label per pixel (-1 = none) and their stats */
function pieces(m: Mask, W: number, H: number): { label: Int32Array; list: Piece[] } {
  const n = W * H;
  const label = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const list: Piece[] = [];
  for (let s = 0; s < n; s++) {
    if (!m[s] || label[s] >= 0) continue;
    const pc: Piece = { id: list.length, area: 0, x0: W, y0: H, x1: 0, y1: 0, sx: 0, sy: 0, border: false };
    let sp = 0;
    stack[sp++] = s;
    label[s] = pc.id;
    while (sp) {
      const p = stack[--sp];
      const x = p % W;
      const y = (p - x) / W;
      pc.area++;
      pc.sx += x;
      pc.sy += y;
      if (x < pc.x0) pc.x0 = x;
      if (x > pc.x1) pc.x1 = x;
      if (y < pc.y0) pc.y0 = y;
      if (y > pc.y1) pc.y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) pc.border = true;
      if (x > 0 && m[p - 1] && label[p - 1] < 0) (label[p - 1] = pc.id), (stack[sp++] = p - 1);
      if (x < W - 1 && m[p + 1] && label[p + 1] < 0) (label[p + 1] = pc.id), (stack[sp++] = p + 1);
      if (y > 0 && m[p - W] && label[p - W] < 0) (label[p - W] = pc.id), (stack[sp++] = p - W);
      if (y < H - 1 && m[p + W] && label[p + W] < 0) (label[p + W] = pc.id), (stack[sp++] = p + W);
    }
    list.push(pc);
  }
  return { label, list };
}

/** closed holes of m (not reachable from the image border) up to maxArea px each are filled (windows, gaps) */
function fillHoles(m: Mask, W: number, H: number, maxArea: number): Mask {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
  const { label, list } = pieces(inv, W, H);
  const fill = new Uint8Array(list.length);
  for (const p of list) if (!p.border && p.area <= maxArea) fill[p.id] = 1;
  const out = Uint8Array.from(m);
  for (let i = 0; i < out.length; i++) if (label[i] >= 0 && fill[label[i]]) out[i] = 1;
  return out;
}

const mbox = (m: Mask, W: number, H: number) => {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0, i = y * W; x < W; x++, i++)
      if (m[i]) {
        area++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1, area };
};

/**
 * Raw model mask → final alpha (W × H) + distance of every pixel to the vehicle's edge, or null:
 *  1. soft threshold; closed holes (windows the model left out) filled so the glass keeps its own reflections;
 *  2. PRIMARY VEHICLE ONLY — necks broken: the confident core (alpha ≥ 0.85) is opened (eroded, then grown back) so a
 *     parked car touching the vehicle through a narrow bridge (roofline, mirror, hood edge) becomes a separate piece;
 *     the piece chosen is the largest weighted by how central it is in the frame (the photographed car is centred);
 *  3. lobe pruning: a stronger opening gives the compact body; parts sticking out of it are kept when they are
 *     vehicle-sized details (mirrors, spoiler, roof rails, bumper lips, wheels) and removed when they are large lobes
 *     rising above the body's outline or leaving its width / the frame (the hood or roof of a car parked behind);
 *  4. uncertain (0.2 … 0.85) pixels count only in a thin band around the kept vehicle: semi-transparent "ghosts" of
 *     neighbouring cars, sky or asphalt are dropped;
 *  5. edge: the boundary is pulled in by ~1.6 px (0.5 px at the tyres' contact line, so the bottom stays solid) and
 *     given a smooth ~2.5 px feather — no jagged steps, no light fringe.
 */
export async function refineMask(sharp: SharpFn, raw: Buffer, W: number, H: number): Promise<{ alpha: Buffer; dist: Float32Array } | null> {
  const n = W * H;
  const maxDim = Math.max(W, H);
  // 1.
  const B = new Uint8Array(n);
  const C = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    B[i] = raw[i] >= 128 ? 1 : 0;
    C[i] = raw[i] >= 217 ? 1 : 0;
  }
  const bArea = B.reduce((a, v) => a + v, 0);
  if (bArea < n * 0.02) return null;
  const Bf = fillHoles(B, W, H, bArea * 0.18);
  // filled holes (and the soft rim around them) are part of the confident core
  const holes = new Uint8Array(n);
  for (let i = 0; i < n; i++) holes[i] = Bf[i] && !B[i] ? 1 : 0;
  const rim = dilate(holes, W, H, Math.max(4, Math.round(maxDim * 0.004)));
  for (let i = 0; i < n; i++) if (rim[i] && Bf[i]) C[i] = 1;
  if (C.reduce((a, v) => a + v, 0) < n * 0.015) for (let i = 0; i < n; i++) C[i] = Bf[i]; // weak model output: use the binary mask

  // 2. neck opening + centre-weighted choice
  const r1 = Math.max(3, Math.round(maxDim * 0.006));
  const dC = distInside(C, W, H);
  const E = new Uint8Array(n);
  for (let i = 0; i < n; i++) E[i] = dC[i] > r1 ? 1 : 0;
  let { label, list } = pieces(E, W, H);
  const salience = (p: Piece) => {
    const cx = p.sx / p.area / W - 0.5;
    const cy = p.sy / p.area / H - 0.55;
    return p.area * Math.exp(-((cx / 0.38) ** 2 + (cy / 0.45) ** 2)) * (p.border && p.area < n * 0.1 ? 0.5 : 1);
  };
  let main: Piece | undefined = list.sort((a, b) => salience(b) - salience(a))[0];
  let core: Mask;
  if (main) {
    const seed = new Uint8Array(n);
    for (let i = 0; i < n; i++) seed[i] = label[i] === main.id ? 1 : 0;
    const grown = dilate(seed, W, H, r1 + 0.5);
    core = new Uint8Array(n);
    for (let i = 0; i < n; i++) core[i] = grown[i] && C[i] ? 1 : 0;
  } else core = Uint8Array.from(C);

  // 3. lobe pruning
  const cb = mbox(core, W, H);
  if (cb.area < n * 0.015) return null;
  const R2 = Math.max(r1 * 2, Math.round((cb.x1 - cb.x0 + 1) * 0.03));
  const dM = distInside(core, W, H);
  const E2 = new Uint8Array(n);
  for (let i = 0; i < n; i++) E2[i] = dM[i] > R2 ? 1 : 0;
  ({ label, list } = pieces(E2, W, H));
  main = list.sort((a, b) => b.area - a.area)[0];
  let body: Mask = core;
  if (main) {
    const seed = new Uint8Array(n);
    for (let i = 0; i < n; i++) seed[i] = label[i] === main.id ? 1 : 0;
    const grown = dilate(seed, W, H, R2 + 0.5);
    body = new Uint8Array(n);
    for (let i = 0; i < n; i++) body[i] = grown[i] && core[i] ? 1 : 0;
  }
  const bb = mbox(body, W, H);
  const top = new Int32Array(W).fill(-1); // body's top outline per column
  for (let x = bb.x0; x <= bb.x1; x++)
    for (let y = bb.y0; y <= bb.y1; y++)
      if (body[y * W + x]) {
        top[x] = y;
        break;
      }
  const near = dilate(body, W, H, 2);
  const prot = new Uint8Array(n);
  for (let i = 0; i < n; i++) prot[i] = core[i] && !near[i] ? 1 : 0;
  const pr = pieces(prot, W, H);
  const keepP = new Uint8Array(pr.list.length);
  for (const p of pr.list) {
    let above = 0;
    let outside = 0;
    for (let y = p.y0; y <= p.y1; y++)
      for (let x = p.x0; x <= p.x1; x++) {
        const i = y * W + x;
        if (pr.label[i] !== p.id) continue;
        if (x < bb.x0 || x > bb.x1) outside++;
        else if (top[x] < 0 || y < top[x]) above++;
      }
    const upper = p.sy / p.area < bb.y0 + (bb.y1 - bb.y0) * 0.6;
    const lobe = upper && (above + outside) / p.area > 0.6 && (p.area > bb.area * 0.025 || outside / p.area > 0.25 || p.border);
    const stray = p.border && p.area > bb.area * 0.003 && upper;
    keepP[p.id] = lobe || stray ? 0 : 1;
  }
  const veh = new Uint8Array(n);
  for (let i = 0; i < n; i++) veh[i] = body[i] || (core[i] && near[i]) || (pr.label[i] >= 0 && keepP[pr.label[i]]) ? 1 : 0;

  // 4. uncertain pixels only in a thin band around the vehicle (+ small soft details attached to it)
  const ringR = Math.max(2, Math.round(maxDim * 0.0025));
  const ring = dilate(veh, W, H, ringR);
  const F = new Uint8Array(n);
  const soft = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (veh[i] || (Bf[i] && ring[i])) F[i] = 1;
    else if (Bf[i]) soft[i] = 1;
  }
  const vb = mbox(F, W, H);
  const sp = pieces(soft, W, H);
  const ring2 = dilate(F, W, H, 1.5);
  for (const p of sp.list) {
    if (p.area > vb.area * 0.006 || p.border) continue;
    let touches = false;
    for (let y = p.y0; y <= p.y1 && !touches; y++)
      for (let x = p.x0; x <= p.x1; x++) {
        const i = y * W + x;
        if (sp.label[i] === p.id && ring2[i]) {
          touches = true;
          break;
        }
      }
    if (touches) for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) if (sp.label[y * W + x] === p.id) F[y * W + x] = 1;
  }
  const Ff = fillHoles(F, W, H, mbox(F, W, H).area * 0.18);

  // 5. smooth, slightly pulled-in edge
  const dist = distInside(Ff, W, H);
  const fb = mbox(Ff, W, H);
  if (fb.area < n * 0.02) return null;
  const contactY = fb.y1 - (fb.y1 - fb.y0) * 0.05;
  const hard = Buffer.alloc(n);
  for (let y = 0; y < H; y++) {
    const e = y >= contactY ? 0.5 : 1.6;
    for (let x = 0, i = y * W; x < W; x++, i++) hard[i] = dist[i] > e ? 255 : 0;
  }
  const smooth = await sharp(hard, { raw: { width: W, height: H, channels: 1 } }).blur(1.1).toColourspace('b-w').raw().toBuffer();
  if (smooth.length !== n) return { alpha: hard, dist };
  const alpha = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const v = (smooth[i] - 64) / 127;
    alpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  return { alpha, dist };
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
 * Where the vehicle meets the floor, per column of the (resized) cut-out: the lower envelope (convex hull from below)
 * of its lowest solid pixels — the line through the tyres' contact points, which slopes in a 3/4 view. low[x] is the
 * lowest solid pixel of each column (-1 when the column is empty).
 */
export function groundLine(subRaw: Buffer, sw: number, sh: number): { low: Int32Array; ground: Float32Array } {
  const low = new Int32Array(sw).fill(-1);
  for (let x = 0; x < sw; x++)
    for (let y = sh - 1; y >= Math.floor(sh * 0.4); y--)
      if (subRaw[(y * sw + x) * 4 + 3] >= 128) {
        low[x] = y;
        break;
      }
  const pts: [number, number][] = [];
  for (let x = 0; x < sw; x++) if (low[x] >= 0) pts.push([x, -low[x]]); // y up
  const hull: [number, number][] = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  const ground = new Float32Array(sw).fill(sh - 1);
  if (hull.length) {
    let k = 0;
    for (let x = 0; x < sw; x++) {
      while (k < hull.length - 2 && hull[k + 1][0] < x) k++;
      const a = hull[k];
      const b = hull[Math.min(k + 1, hull.length - 1)];
      const t = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (x - a[0]) / (b[0] - a[0])));
      ground[x] = -(a[1] + (b[1] - a[1]) * t);
      if (x < hull[0][0]) ground[x] = -hull[0][1];
      if (x > hull[hull.length - 1][0]) ground[x] = -hull[hull.length - 1][1];
    }
  }
  return { low, ground };
}

/**
 * The shadow layer (RGBA, OW × OH, black with alpha), drawn at ¼ size then scaled up, following the ground line:
 *  - contact shadow: dark where the vehicle touches the floor (tyres), fading where its underside is higher;
 *  - ambient occlusion: a tight dark band along the ground line under the whole vehicle;
 *  - soft shadow: a wide, light band around it (fading past the bumpers).
 */
async function groundShadow(sharp: SharpFn, gl: { low: Int32Array; ground: Float32Array }, sw: number, sh: number, left: number, top: number, OW: number, OH: number, strength: number): Promise<Buffer> {
  const S = 4;
  const w = Math.ceil(OW / S);
  const h = Math.ceil(OH / S);
  const contact = new Float32Array(w * h);
  const amb = new Float32Array(w * h);
  const fade = Math.max(2, sh * 0.03);
  const sAo = Math.max(1, (sh * 0.022) / S);
  const sWide = Math.max(2, (sh * 0.07) / S);
  const ext = Math.round(sw * 0.035);
  let first = 0;
  while (first < sw && gl.low[first] < 0) first++;
  let last = sw - 1;
  while (last > 0 && gl.low[last] < 0) last--;
  for (let x = first - ext; x <= last + ext; x++) {
    const cx = Math.floor((left + x) / S);
    if (cx < 0 || cx >= w) continue;
    const xi = Math.max(first, Math.min(last, x));
    const g = top + gl.ground[xi];
    const endFade = x < first ? Math.exp(-(((first - x) / (ext * 0.5)) ** 2)) : x > last ? Math.exp(-(((x - last) / (ext * 0.5)) ** 2)) : 1;
    // ambient occlusion + wide soft shadow, centred just under the ground line
    const gy = (g + sh * 0.004) / S;
    for (let y = Math.max(0, Math.floor(gy - 4 * sWide)); y <= Math.min(h - 1, Math.ceil(gy + 4 * sWide)); y++) {
      const dy = y - gy;
      const ao = 0.6 * Math.exp(-((dy / sAo) ** 2)) + 0.28 * Math.exp(-((dy / sWide) ** 2));
      const i = y * w + cx;
      const v = ao * endFade;
      if (v > amb[i]) amb[i] = v;
    }
    // contact: from the column's lowest point down to the ground line, strongest where they meet
    if (x >= first && x <= last && gl.low[x] >= 0) {
      const gap = gl.ground[x] - gl.low[x];
      const wgt = Math.exp(-gap / fade);
      const y0 = Math.max(0, Math.floor((top + gl.low[x] - sh * 0.006) / S));
      const y1 = Math.min(h - 1, Math.ceil((g + sh * 0.006) / S));
      for (let y = y0; y <= y1; y++) {
        const i = y * w + cx;
        if (wgt > contact[i]) contact[i] = wgt;
      }
    }
  }
  const c8 = Buffer.alloc(w * h);
  for (let i = 0; i < c8.length; i++) c8[i] = Math.round(contact[i] * 255);
  const cb = await sharp(c8, { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.6, (sh * 0.008) / S)).toColourspace('b-w').raw().toBuffer();
  const alpha = Buffer.alloc(w * h);
  for (let i = 0; i < alpha.length; i++) {
    const c = (cb.length === alpha.length ? cb[i] : c8[i]) / 255;
    const v = 1 - (1 - 0.95 * c) * (1 - amb[i]);
    alpha[i] = Math.min(255, Math.round(255 * strength * v));
  }
  const black = Buffer.alloc(w * h * 3);
  const small = await sharp(black, { raw: { width: w, height: h, channels: 3 } }).joinChannel(alpha, { raw: { width: w, height: h, channels: 1 } }).raw().toBuffer();
  return sharp(small, { raw: { width: w, height: h, channels: 4 } }).resize(OW, OH, { fit: 'fill', kernel: 'cubic' }).blur(0.8).png({ compressionLevel: 1 }).toBuffer();
}

/**
 * Floor reflection mirrored at the ground line of every column (right for 3/4 views too), fading with the distance
 * from the floor. Returned as an RGBA layer of sw × (sh + rh) to place at (left, top).
 */
async function floorReflection(sharp: SharpFn, subRaw: Buffer, gl: { ground: Float32Array }, sw: number, sh: number, rh: number, strength: number): Promise<Buffer> {
  const H2 = sh + rh;
  const out = Buffer.alloc(sw * H2 * 4);
  for (let x = 0; x < sw; x++) {
    const g = gl.ground[x];
    for (let d = 0; d < rh; d++) {
      const sy = Math.round(g - d);
      const ty = Math.round(g + d + 1);
      if (sy < 0 || ty >= H2) break;
      const si = (sy * sw + x) * 4;
      const a = subRaw[si + 3];
      if (!a) continue;
      const f = strength * (1 - d / rh) ** 2;
      const ti = (ty * sw + x) * 4;
      out[ti] = subRaw[si];
      out[ti + 1] = subRaw[si + 1];
      out[ti + 2] = subRaw[si + 2];
      out[ti + 3] = Math.round(a * f);
    }
  }
  return sharp(out, { raw: { width: sw, height: H2, channels: 4 } }).blur(Math.max(1, sh * 0.008)).png({ compressionLevel: 1 }).toBuffer();
}

/**
 * Edge colour clean-up: every pixel near the vehicle's edge (alpha < 255, or within 4.5 px of the edge) takes the
 * average colour of the solid vehicle pixels 4.5 + px inside — so sky, asphalt or a neighbouring car never shows as a
 * light / blue fringe along the hood, roof or bumper. Interior pixels are not changed.
 */
async function decontaminateEdges(sharp: SharpFn, rgb: Buffer, alpha: Buffer, dist: Float32Array, W: number, H: number): Promise<Buffer> {
  const n = W * H;
  const out = Buffer.from(rgb);
  const solid = Buffer.alloc(n);
  const masked = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    if (dist[i] >= 4.5) {
      solid[i] = 255;
      masked[i * 3] = rgb[i * 3];
      masked[i * 3 + 1] = rgb[i * 3 + 1];
      masked[i * 3 + 2] = rgb[i * 3 + 2];
    }
  }
  const sigma = 2.6;
  const bm = await sharp(masked, { raw: { width: W, height: H, channels: 3 } }).blur(sigma).raw().toBuffer();
  const bs = await sharp(solid, { raw: { width: W, height: H, channels: 1 } }).blur(sigma).toColourspace('b-w').raw().toBuffer();
  if (bm.length !== n * 3 || bs.length !== n) return out;
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a === 0 || dist[i] >= 4.5 || bs[i] < 6) continue;
    const k = 255 / bs[i];
    // fully transparent-ish edge pixels: all from inside; solid pixels near the edge: blended (keeps chrome / trim detail)
    const mix = a < 255 ? 1 : Math.max(0, Math.min(1, (4.5 - dist[i]) / 3)) * 0.7;
    for (let c = 0; c < 3; c++) {
      const v = Math.min(255, bm[i * 3 + c] * k);
      out[i * 3 + c] = Math.round(out[i * 3 + c] * (1 - mix) + v * mix);
    }
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
