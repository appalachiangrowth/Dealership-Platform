'use client';

/**
 * "Scan VIN": reads the VIN with the phone / laptop camera (rear camera on phones).
 *
 *  1. Barcode, live: the browser's own BarcodeDetector (Android Chrome, recent Safari) for Code 39 / Code 128 /
 *     Data Matrix / QR, else ZXing (@zxing/library, already used by the driver's license scanner) — so it also works
 *     on iPhones and desktop browsers without BarcodeDetector.
 *  2. Printed VIN (windshield plate, door sticker without a barcode): "Read the printed VIN" sends one still picture
 *     to the existing AI close-up reader (/dealer/ai/read-closeups), when AI is switched on for the dealership.
 *  3. "Take a photo" (camera blocked, no camera, older phones): the photo is searched for a barcode on this device
 *     first, then read with AI.
 *
 * A valid 17-character VIN closes the scanner and is handed back (onVin); the page fills the VIN box and decodes
 * it. The camera is released whenever the scanner closes — found, cancelled, Escape, or leaving the page.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, ScanLine, Sparkles, X } from 'lucide-react';
import { aiApi, vinOk } from '@/lib/ai';

/* ---------------- VIN clean-up ---------------- */

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * The VIN in a scanned / read string, or null. Handles the leading "I" (import) character of Code 39 VIN barcodes,
 * spaces / dashes / labels around it ("VIN: …"), and — only when that gives a VIN whose check digit matches — the
 * O / Q / I a camera or OCR may read for 0 / 1. A 17-character code without a matching check digit (some imported
 * vehicles) is accepted only when it is the whole barcode.
 */
export function extractVin(raw: unknown): string | null {
  let s = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (s.length === 18 && s[0] === 'I') s = s.slice(1); // Code 39 VIN barcodes: "I" + VIN
  const wins = (x: string) => Array.from({ length: Math.max(0, x.length - 16) }, (_, i) => x.slice(i, i + 17));
  const fixed = s.replace(/[OQ]/g, '0').replace(/I/g, '1');
  const exact = wins(s).filter((w) => VIN_CHARS.test(w));
  return (
    exact.find(vinOk) ||
    wins(fixed).find(vinOk) ||
    (s.length === 17 && VIN_CHARS.test(s) ? s : null) ||
    null
  );
}

/* ---------------- barcode engines ---------------- */

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue?: string }[]> };
const BD_FORMATS = ['code_39', 'code_128', 'data_matrix', 'qr_code'];
let bdPromise: Promise<Detector | null> | null = null;

/** the browser's own barcode reader, or null when it has none / none of our formats */
function nativeDetector(): Promise<Detector | null> {
  if (bdPromise) return bdPromise;
  bdPromise = (async () => {
    const BD = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
    if (!BD) return null;
    try {
      const supported: string[] | undefined = await BD.getSupportedFormats?.();
      const formats = supported ? BD_FORMATS.filter((f) => supported.includes(f)) : BD_FORMATS;
      if (!formats.length) return null;
      return new BD({ formats }) as Detector;
    } catch {
      return null;
    }
  })();
  return bdPromise;
}

type Zx = typeof import('@zxing/library');
let zx: { z: Zx; reader: InstanceType<Zx['MultiFormatReader']>; hints: Map<any, any> } | null = null;

async function zxing() {
  if (zx) return zx;
  const z = await import('@zxing/library');
  const hints = new Map();
  hints.set(z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.CODE_39, z.BarcodeFormat.CODE_128, z.BarcodeFormat.DATA_MATRIX, z.BarcodeFormat.QR_CODE]);
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  const reader = new z.MultiFormatReader();
  reader.setHints(hints);
  zx = { z, reader, hints };
  return zx;
}

function luminance(c: HTMLCanvasElement) {
  const { data } = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  const lum = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  return lum;
}

function rotate(src: HTMLCanvasElement, deg: number) {
  if (!deg) return src;
  const c = document.createElement('canvas');
  c.width = deg % 180 ? src.height : src.width;
  c.height = deg % 180 ? src.width : src.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** all barcode texts found in a picture: native reader first, then ZXing (more turns / binarizers when thorough) */
async function readBarcodes(c: HTMLCanvasElement, thorough: boolean): Promise<string[]> {
  const out: string[] = [];
  const bd = await nativeDetector();
  if (bd) {
    try {
      for (const r of await bd.detect(c)) if (r?.rawValue) out.push(String(r.rawValue));
    } catch {
      /* fall back to ZXing */
    }
    if (out.length) return out;
  }
  const { z, reader, hints } = await zxing();
  for (const deg of thorough ? [0, 90, 180, 270] : [0]) {
    const cv = rotate(c, deg);
    const src = new z.RGBLuminanceSource(luminance(cv), cv.width, cv.height);
    for (const Bin of thorough ? [z.HybridBinarizer, z.GlobalHistogramBinarizer] : [z.HybridBinarizer]) {
      try {
        out.push(reader.decode(new z.BinaryBitmap(new Bin(src)), hints).getText());
        return out;
      } catch {
        /* nothing in this pass */
      }
    }
  }
  return out;
}

/** draws (part of) a video frame / picture into a canvas no wider than maxW; band = the guide-frame strip only */
function snap(src: HTMLVideoElement | HTMLImageElement, maxW: number, band = false) {
  const w = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const h = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  const sy = band ? Math.round(h * 0.3) : 0;
  const sh = band ? Math.round(h * 0.4) : h;
  const k = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(sh * k);
  c.getContext('2d')!.drawImage(src, 0, sy, w, sh, 0, 0, c.width, c.height);
  return c;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('This picture could not be opened. Use a JPG or PNG photo.'));
    };
    img.src = url;
  });
}

const jpeg = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.9).split(',')[1];

function cameraError(e: unknown): string {
  const n = (e as { name?: string })?.name || '';
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return 'Camera access is blocked. Allow the camera for this site in the browser settings, or use “Take a photo” below.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') return 'No camera was found on this device. Use “Take a photo” below, or type the VIN.';
  if (n === 'NotReadableError' || n === 'TrackStartError') return 'The camera is being used by another app. Close it and try again, or use “Take a photo” below.';
  return 'The camera could not be started. Use “Take a photo” below, or type the VIN.';
}

/* ---------------- the scanner ---------------- */

export function VinScannerModal({ open, onClose, onVin, aiOn }: { open: boolean; onClose: () => void; onVin: (vin: string) => void; aiOn: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const done = useRef(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [notVin, setNotVin] = useState('');
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState('');

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setLive(false);
  };

  /** a VIN: release the camera, close, hand it to the page */
  const found = (vin: string) => {
    if (done.current) return;
    done.current = true;
    stop();
    onVin(vin);
    onClose();
  };

  /** texts from a barcode / AI: true when one of them is a VIN */
  const tryTexts = (texts: string[]) => {
    for (const t of texts) {
      const v = extractVin(t);
      if (v) {
        found(v);
        return true;
      }
    }
    if (texts.length) setNotVin(`A code was read (“${texts[0].slice(0, 40)}”), but it is not a VIN. Aim at the VIN barcode.`);
    return false;
  };

  async function start() {
    setError('');
    setNotVin('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('The camera only works on a secure (https) page. Use “Take a photo” below, or type the VIN.');
      return;
    }
    try {
      stop();
      setStatus('Starting the camera…');
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (done.current || !open) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const v = video.current;
      if (v) {
        v.srcObject = s;
        await v.play().catch(() => undefined);
      }
      setLive(true);
      setStatus('Looking for a VIN barcode…');
      let n = 0;
      const tick = async () => {
        const el = video.current;
        if (!stream.current || !el || done.current) return;
        if (el.videoWidth) {
          n++;
          // the guide strip most of the time (faster, sharper), the whole picture every 3rd try
          const texts = await readBarcodes(snap(el, 1600, n % 3 !== 0), false).catch(() => [] as string[]);
          if (texts.length && tryTexts(texts)) return;
        }
        timer.current = window.setTimeout(tick, 250);
      };
      void tick();
    } catch (e) {
      stop();
      setStatus('');
      setError(cameraError(e));
    }
  }

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    done.current = false;
    setBusy('');
    void start();
    // leaving the page / switching apps: release the camera
    const away = () => stop();
    window.addEventListener('pagehide', away);
    return () => {
      window.removeEventListener('pagehide', away);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  /** printed VIN (no barcode): one still picture to the AI close-up reader */
  async function readWithAi(c: HTMLCanvasElement) {
    const r = await aiApi<{ vin: { value: string; valid: boolean } | null }>('read-closeups', { images: [{ kind: 'VIN plate / VIN sticker', data: jpeg(c), media_type: 'image/jpeg' }] });
    return r?.vin?.value ? [r.vin.value] : [];
  }

  async function readFrameWithAi() {
    const el = video.current;
    if (!el?.videoWidth) return;
    setBusy('ai');
    setNotVin('');
    try {
      const texts = await readWithAi(snap(el, 1800));
      if (!tryTexts(texts)) setNotVin('No VIN could be read. Move closer so the 17 characters fill the frame, hold still, and try again.');
    } catch (e) {
      setNotVin((e as Error).message || 'The VIN could not be read. Try again.');
    } finally {
      setBusy('');
    }
  }

  async function fromPhoto(file?: File) {
    if (!file) return;
    setBusy('photo');
    setNotVin('');
    let img: HTMLImageElement | null = null;
    try {
      img = await loadImage(file);
      let texts: string[] = [];
      for (const w of [2000, 1400, 1000]) {
        texts = await readBarcodes(snap(img, w), true);
        if (texts.length) break;
      }
      if (texts.length && tryTexts(texts)) return;
      if (aiOn) {
        const ai = await readWithAi(snap(img, 1800));
        if (tryTexts(ai)) return;
      }
      setNotVin(aiOn ? 'No VIN could be read from this photo. Take a sharp, close photo of the VIN barcode or the 17 characters.' : 'No VIN barcode was found in this photo. Take a sharp, close photo of the VIN barcode.');
    } catch (e) {
      setNotVin((e as Error).message);
    } finally {
      if (img) URL.revokeObjectURL(img.src);
      setBusy('');
    }
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="vin-scan-title">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div className="relative flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-4">
          <h2 id="vin-scan-title" className="inline-flex items-center gap-2 text-base font-bold text-slate-900">
            <ScanLine className="h-5 w-5 text-blue-700" /> Scan VIN
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close the scanner">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-sm text-slate-600">
          {!error ? (
            <>
              <div className="relative overflow-hidden rounded-xl bg-slate-900">
                <video ref={video} playsInline muted autoPlay className="aspect-[4/3] w-full object-cover sm:aspect-video" />
                {/* horizontal guide for the windshield / door-jamb VIN */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-[6%] top-[30%] h-[40%] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
                  {live && <div className="absolute inset-x-[9%] top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500/90" />}
                </div>
                {!live && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/80">
                    <Camera className="mr-2 h-5 w-5" /> {status || 'Starting the camera…'}
                  </div>
                )}
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-slate-600">
                Line up the <b>VIN barcode</b> on the driver’s door frame (or under the windshield) inside the frame. It is read automatically.
              </p>
              {live && <p className="mt-1 text-xs font-semibold text-blue-700">{status}</p>}
            </>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-medium leading-relaxed text-amber-900">
              <div className="mb-1 inline-flex items-center gap-1.5 font-bold">
                <Camera className="h-4 w-4" /> Camera not available
              </div>
              <div>{error}</div>
              <button type="button" onClick={() => void start()} className="mt-2 text-xs font-bold text-amber-900 underline">
                Try the camera again
              </button>
            </div>
          )}

          {notVin && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{notVin}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            {aiOn && live && (
              <button
                type="button"
                onClick={() => void readFrameWithAi()}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-[13px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" /> {busy === 'ai' ? 'Reading…' : 'No barcode? Read the printed VIN'}
              </button>
            )}
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-800 hover:bg-slate-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}
            >
              <ImagePlus className="h-4 w-4" /> {busy === 'photo' ? 'Reading the photo…' : 'Take a photo'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  void fromPhoto(f);
                }}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {aiOn ? 'Barcodes are read on this device. A printed VIN is read with AI.' : 'Barcodes are read on this device.'} You can always type the VIN instead.
          </p>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
