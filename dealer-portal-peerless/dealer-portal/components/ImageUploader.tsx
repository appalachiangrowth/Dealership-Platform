'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Link2, Sparkles, Trash2, Upload } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useStudioStatus, useStudioSwitch } from '@/lib/photo-studio';
import { useToast } from './toast';
import { Button, Input, Spinner, Toggle, cx } from './ui';

/**
 * Vehicle photos are always stored as .jpeg by the server (any format: JPG, PNG, WebP, AVIF, HEIC, GIF, BMP — rotated
 * upright, transparency on white). Here, very large photos are only made smaller before the upload so it is faster;
 * formats this browser cannot read (HEIC on most browsers) are sent as they are and converted by the server.
 */
const MAX_SIDE = 2400;
async function webReady(f: File): Promise<File> {
  if (!/^image\//.test(f.type) || f.type === 'image/gif') return f;
  const okType = f.type === 'image/jpeg' || f.type === 'image/png';
  if (okType && f.size <= 2.5 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (okType && k === 1 && f.type === 'image/png') return f; // keep PNG transparency when no resize is needed
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d');
    if (!g) return f;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.88));
    if (!blob) return f;
    return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return f; // the browser cannot read this format: the server decides
  }
}

/** what the photo pickers accept (HEIC / AVIF named too: some systems do not count them as image/*) */
export const PHOTO_ACCEPT = 'image/*,.jpg,.jpeg,.png,.webp,.avif,.heic,.heif,.gif,.bmp';

/** A pasted web photo link → downloaded by the server and saved as one of the dealer's own .jpeg photos. */
export async function photoFromLink(link: string, enhance: boolean): Promise<{ url: string; enhanced: boolean; note: string }> {
  const r = await api<{ url: string; enhanced?: boolean; enhanceNote?: string }>('/dealer/media/from-url', { body: { url: link, enhance } });
  return { url: r.url, enhanced: !!r.enhanced, note: r.enhanceNote || '' };
}

export async function uploadFiles(files: FileList | File[], folder?: string): Promise<string[]> {
  const form = new FormData();
  for (const f of Array.from(files)) form.append('files', await webReady(f));
  const r = await api<{ files: { url: string }[]; errors: { file: string; error: string }[] }>(`/dealer/media${folder ? `?folder=${folder}` : ''}`, { form });
  if (r.errors.length) throw new Error(r.errors.map((e) => `${e.file}: ${e.error}`).join('\n'));
  return r.files.map((f) => f.url);
}

/**
 * One vehicle photo with Auto White Studio Background: the server puts the vehicle on a white studio background,
 * or keeps the photo as it is (enhanced = false + note why). One photo per request, so no request waits too long.
 */
export async function uploadStudioPhoto(file: File): Promise<{ url: string; enhanced: boolean; note: string }> {
  const form = new FormData();
  form.append('files', await webReady(file));
  const r = await api<{ files: { url: string; enhanced?: boolean; enhanceNote?: string }[]; errors: { file: string; error: string }[] }>('/dealer/media?enhance=1', { form });
  if (r.errors.length) throw new Error(r.errors.map((e) => `${e.file}: ${e.error}`).join('\n'));
  const f = r.files[0];
  return { url: f.url, enhanced: !!f.enhanced, note: f.enhanceNote || '' };
}

/**
 * Ordered photo list for a vehicle or post. First photo = cover.
 * studio: show the "Auto White Studio Background" switch (vehicle photos) — on by default, remembered in this browser.
 */
export function ImageUploader({ value, onChange, max = 60, studio = false }: { value: string[]; onChange: (v: string[]) => void; max?: number; studio?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [studioOn, setStudioOn] = useStudioSwitch();
  const studioStatus = useStudioStatus();
  /** "Enhancing vehicle background…" progress while photos are processed one by one */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const toast = useToast();
  // a server without the feature saves photos as they are, so only ask for it when it is (or may be) installed
  const enhance = studio && studioOn && studioStatus?.available !== false;

  async function add(files: FileList | File[]) {
    if (!files.length) return;
    const list = Array.from(files).slice(0, Math.max(0, max - value.length));
    if (!list.length) return toast.error(`At most ${max} photos`);
    setBusy(true);
    try {
      if (!enhance) {
        const urls = await uploadFiles(list);
        onChange([...value, ...urls].slice(0, max));
        return;
      }
      // one by one: each photo appears as soon as it is ready; a photo that fails does not stop the others
      let next = [...value];
      let enhanced = 0;
      const kept: string[] = [];
      const failed: string[] = [];
      setProgress({ done: 0, total: list.length });
      for (let i = 0; i < list.length; i++) {
        try {
          const r = await uploadStudioPhoto(list[i]);
          next = [...next, r.url].slice(0, max);
          onChange(next);
          if (r.enhanced) enhanced++;
          else kept.push(`${list[i].name}: ${r.note || 'kept as it is'}`);
        } catch (e) {
          failed.push((e as Error).message);
        }
        setProgress({ done: i + 1, total: list.length });
      }
      if (enhanced) toast.ok(`${enhanced} photo${enhanced === 1 ? '' : 's'} put on a white studio background`);
      if (kept.length) toast.ok(`${kept.length} photo${kept.length === 1 ? '' : 's'} kept as uploaded (${kept.slice(0, 3).join(' · ')}${kept.length > 3 ? ' …' : ''})`);
      if (failed.length) toast.error(failed.join('\n'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void add(e.dataTransfer.files);
        }}
        className={cx('rounded-xl border-2 border-dashed p-4 transition', drag ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50')}
      >
        {value.length > 0 && (
          <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {value.map((u, i) => (
              <div key={u + i} className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
                <img src={mediaUrl(u)} alt="" className="h-full w-full object-cover" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-blue-700 px-1.5 py-0.5 text-[9px] font-bold text-white">COVER</span>}
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 p-1 opacity-0 transition group-hover:opacity-100">
                  <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-white hover:bg-white/20" title="Move left">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="rounded p-1 text-white hover:bg-red-500" title="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-white hover:bg-white/20" title="Move right">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {studio && (
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Toggle
              checked={studioOn}
              onChange={setStudioOn}
              label="Auto White Studio Background"
              desc={
                studioStatus && !studioStatus.available
                  ? `Not set up on the server yet — photos are saved as uploaded (${studioStatus.reason}).`
                  : 'Puts the vehicle on a clean white studio background. Interior and close-up photos are kept as they are.'
              }
            />
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          </div>
        )}
        {progress && (
          <div className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900" role="status" aria-live="polite">
            <div className="flex items-center gap-2 font-medium">
              <Spinner className="h-4 w-4" /> Enhancing vehicle background... {progress.done} of {progress.total}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blue-100">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => ref.current?.click()} loading={busy}>
            <Upload className="h-4 w-4" /> Upload photos
          </Button>
          <span className="text-xs text-slate-500">or drag photos here · JPG, PNG, WebP, AVIF, HEIC, GIF · saved as JPEG · first photo is the cover</span>
          <input
            ref={ref}
            type="file"
            accept={PHOTO_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="…or paste a photo link (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <Button
            type="button"
            variant="secondary"
            loading={linkBusy}
            onClick={async () => {
              const link = url.trim();
              if (!/^https?:\/\//.test(link)) return toast.error('Paste a link that starts with https://');
              if (value.length >= max) return toast.error(`At most ${max} photos`);
              // the photo is copied to the dealership's own photos as a .jpeg (feeds always get a .jpeg link)
              setLinkBusy(true);
              if (enhance) setProgress({ done: 0, total: 1 });
              try {
                const r = await photoFromLink(link, enhance);
                onChange([...value, r.url].slice(0, max));
                setUrl('');
                if (r.enhanced) toast.ok('Photo put on a white studio background');
                else if (enhance && r.note) toast.ok(`Photo saved as JPEG (kept as it is: ${r.note})`);
              } catch (e) {
                toast.error(`${(e as Error).message}. Download the photo and upload it instead.`);
              } finally {
                setLinkBusy(false);
                setProgress(null);
              }
            }}
          >
            Add link
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One image (logo, cover, share image). */
export function SingleImage({ value, onChange, folder = 'site', label = 'Upload image', round }: { value: string; onChange: (v: string) => void; folder?: string; label?: string; round?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="flex items-center gap-4">
      <div className={cx('flex h-20 w-20 items-center justify-center overflow-hidden bg-slate-100 ring-1 ring-slate-200', round ? 'rounded-full' : 'rounded-xl')}>
        {busy ? <Spinner /> : value ? <img src={mediaUrl(value)} alt="" className="h-full w-full object-contain" /> : <ImagePlus className="h-6 w-6 text-slate-400" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => ref.current?.click()}>
          {label}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            Remove
          </Button>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          if (!e.target.files?.length) return;
          setBusy(true);
          try {
            const [u] = await uploadFiles(e.target.files, folder);
            onChange(u);
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}
