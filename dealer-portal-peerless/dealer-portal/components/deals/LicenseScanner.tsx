'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CreditCard, Image as ImageIcon, Keyboard, ScanLine, Sparkles, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { parseAamva, type LicenseData } from '@/lib/aamva';
import { Button, Modal, Textarea, cx } from '@/components/ui';

type Mode = 'camera' | 'back' | 'front' | 'type';

/* ---------- barcode (PDF417) decoding: the browser's own detector when it has one, else ZXing ---------- */

function grayscale(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const lum = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  return lum;
}

function rotated(src: HTMLCanvasElement, deg: number) {
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

async function decodeCanvas(c: HTMLCanvasElement, thorough: boolean): Promise<string | null> {
  const BD = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
  if (BD) {
    try {
      const formats: string[] | undefined = await BD.getSupportedFormats?.();
      if (!formats || formats.includes('pdf417')) {
        const r = await new BD({ formats: ['pdf417'] }).detect(c);
        if (r?.[0]?.rawValue) return String(r[0].rawValue);
      }
    } catch {
      /* fall back to ZXing */
    }
  }
  const z = await import('@zxing/library');
  const reader = new z.PDF417Reader();
  const hints = new Map();
  hints.set(z.DecodeHintType.TRY_HARDER, true);
  for (const deg of thorough ? [0, 90, 180, 270] : [0]) {
    const cv = rotated(c, deg);
    const src = new z.RGBLuminanceSource(grayscale(cv), cv.width, cv.height);
    for (const Bin of thorough ? [z.HybridBinarizer, z.GlobalHistogramBinarizer] : [z.HybridBinarizer]) {
      try {
        return reader.decode(new z.BinaryBitmap(new Bin(src)), hints).getText();
      } catch {
        /* not found in this pass */
      }
    }
  }
  return null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('This picture could not be opened. Use a JPG or PNG photo.'));
    img.src = URL.createObjectURL(file);
  });
}

function toCanvas(img: HTMLImageElement | HTMLVideoElement, maxW: number) {
  const w = img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth;
  const h = img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight;
  const k = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const ROWS: [keyof LicenseData, string][] = [
  ['firstName', 'First name'],
  ['middleName', 'Middle name'],
  ['lastName', 'Last name'],
  ['address', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['zip', 'ZIP'],
  ['dob', 'Date of birth'],
  ['licenseNumber', 'License no.'],
  ['licenseState', 'License state'],
  ['expiry', 'Expires'],
];

/** "Scan Driver's License": barcode on the back (camera, photo or handheld scanner) or the front photo (AI). */
export function LicenseScanner({ open, onClose, onApply }: { open: boolean; onClose: () => void; onApply: (d: LicenseData) => void }) {
  const [mode, setMode] = useState<Mode>('camera');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<LicenseData | null>(null);
  const [typed, setTyped] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    if (!open) {
      stop();
      setResult(null);
      setMsg('');
      setTyped('');
    }
    return stop;
  }, [open]);

  const found = (raw: string) => {
    const d = parseAamva(raw);
    if (!d) {
      setMsg('A barcode was read, but it is not a driver’s license barcode.');
      return false;
    }
    stop();
    setResult(d);
    setMsg('');
    return true;
  };

  async function startCamera() {
    setMsg('');
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMsg('The camera needs a secure (https) page. Use “Photo of back” instead.');
      return;
    }
    try {
      stop();
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      const tick = async () => {
        const v = video.current;
        if (!stream.current || !v) return;
        if (v.videoWidth) {
          const text = await decodeCanvas(toCanvas(v, 1600), false).catch(() => null);
          if (text && found(text)) return;
        }
        timer.current = window.setTimeout(tick, 350);
      };
      void tick();
    } catch {
      setMsg('Camera access was blocked. Allow the camera in the browser, or use “Photo of back”.');
    }
  }

  useEffect(() => {
    if (open && mode === 'camera') void startCamera();
    else stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  async function backPhoto(file?: File) {
    if (!file) return;
    setBusy(true);
    setMsg('');
    setResult(null);
    try {
      const img = await loadImage(file);
      let text: string | null = null;
      for (const w of [2000, 1400, 1000]) {
        text = await decodeCanvas(toCanvas(img, w), true);
        if (text) break;
      }
      if (!text) setMsg('No barcode found. Take a sharp, well-lit photo of the whole barcode on the back, or use “Front photo”.');
      else found(text);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function frontPhoto(file?: File) {
    if (!file) return;
    setBusy(true);
    setMsg('');
    setResult(null);
    try {
      const img = await loadImage(file);
      const c = toCanvas(img, 1600);
      const image = c.toDataURL('image/jpeg', 0.88).split(',')[1];
      const r = await api<LicenseData>('/dealer/deals/read-license', { body: { image, media_type: 'image/jpeg' } });
      if (!r.lastName && !r.firstName && !r.licenseNumber) setMsg('Nothing could be read from this photo. Try a sharper photo.');
      else setResult(r);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const TABS: [Mode, string, React.ElementType][] = [
    ['camera', 'Camera', Camera],
    ['back', 'Photo of back', ImageIcon],
    ['front', 'Front photo', Sparkles],
    ['type', 'Handheld scanner', Keyboard],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-blue-700" /> Scan driver’s license
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!result}
            onClick={() => {
              if (result) onApply(result);
              onClose();
            }}
          >
            Apply to buyer form
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold sm:grid-cols-4">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMode(id);
              setResult(null);
              setMsg('');
            }}
            className={cx('inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2', mode === id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {!result && mode === 'camera' && (
        <div>
          <div className="relative overflow-hidden rounded-xl bg-slate-900">
            <video ref={video} playsInline muted className="aspect-video w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-6 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80" />
            <ScanLine className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-pulse text-white/80" />
          </div>
          <p className="mt-2 text-xs text-slate-500">Hold the barcode on the back of the license inside the frame. It is read automatically.</p>
        </div>
      )}

      {!result && (mode === 'back' || mode === 'front') && (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:bg-slate-50">
          <Upload className="h-6 w-6 text-slate-400" />
          <span className="text-sm font-semibold text-slate-700">{mode === 'back' ? 'Upload or take a photo of the back (barcode)' : 'Upload or take a photo of the front'}</span>
          <span className="text-xs text-slate-500">{mode === 'back' ? 'The barcode is read on this device.' : 'Read with AI. Check every field before applying.'}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void (mode === 'back' ? backPhoto(f) : frontPhoto(f));
            }}
          />
          {busy && <span className="text-xs font-semibold text-blue-700">Reading…</span>}
        </label>
      )}

      {!result && mode === 'type' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Click in the box and scan the back of the license with a USB / Bluetooth scanner.</p>
          <Textarea rows={5} autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Barcode text appears here" className="font-mono text-xs" />
          <Button size="sm" disabled={!typed.trim()} onClick={() => found(typed)}>
            Read
          </Button>
        </div>
      )}

      {msg && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{msg}</p>}

      {result && (
        <div>
          <p className="mb-2 text-xs font-semibold text-emerald-700">License read. Check the details, then apply.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {ROWS.map(([k, label]) => (
                <tr key={k}>
                  <td className="w-36 py-1.5 pr-3 text-xs font-semibold text-slate-500">{label}</td>
                  <td className="py-1">
                    <input
                      className="w-full rounded-md border border-transparent px-2 py-1 text-sm text-slate-900 hover:border-slate-200 focus:border-blue-500 focus:outline-none"
                      value={result[k]}
                      onChange={(e) => setResult({ ...result, [k]: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-blue-700 hover:underline"
            onClick={() => {
              setResult(null);
              if (mode === 'camera') void startCamera();
            }}
          >
            Scan again
          </button>
        </div>
      )}
    </Modal>
  );
}
