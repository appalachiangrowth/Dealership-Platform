'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsLeftRight, ImagePlus, Layers, Minus, Plus, RefreshCw, Replace, Sparkles, Upload, X } from 'lucide-react';
import { API_URL, mediaUrl } from '@/lib/api';
import { type StudioChoice, type StudioPreview, studioApply, studioPreview, useStudioChoice, useStudioInfo } from '@/lib/photo-studio';
import { uploadFiles } from './ImageUploader';
import { useToast } from './toast';
import { Button, Spinner, cx } from './ui';

/**
 * Photo Studio: puts vehicle photos on a dealership background.
 *  - pick a scene (or a custom photo / transparent cut-out); the choice is remembered for the next photos
 *  - before / after slider with zoom to check tyres, mirrors and shadow
 *  - "Try another background": the cut-out is kept on the server, so a new scene is quick
 *  - one photo: Replace original / Save as new photo; several photos: apply to all with progress
 */
export type StudioResult = { source: string; url: string };

type Status = 'waiting' | 'working' | 'done' | 'kept' | 'failed';

const CHECKER =
  'linear-gradient(45deg,#e2e8f0 25%,transparent 25%),linear-gradient(-45deg,#e2e8f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e2e8f0 75%),linear-gradient(-45deg,transparent 75%,#e2e8f0 75%)';

export function PhotoStudio({
  photos,
  start = 0,
  onClose,
  onDone,
}: {
  photos: string[];
  start?: number;
  onClose: () => void;
  /** mode replace: each result.url takes the place of result.source; new: added after it */
  onDone: (results: StudioResult[], mode: 'replace' | 'new') => void;
}) {
  const toast = useToast();
  const info = useStudioInfo();
  const [choice, setChoice] = useStudioChoice();
  const [index, setIndex] = useState(Math.min(start, photos.length - 1));
  const [preview, setPreview] = useState<StudioPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<Status[]>(() => photos.map(() => 'waiting'));
  const [busy, setBusy] = useState<'' | 'replace' | 'new'>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadingBg, setUploadingBg] = useState(false);
  const seq = useRef(0);
  const viewer = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const customFile = useRef<HTMLInputElement>(null);
  const batch = photos.length > 1;
  const source = photos[index];

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  const load = useCallback(
    async (src: string, c: StudioChoice) => {
      if (c.id === 'custom' && !c.customUrl) return;
      const n = ++seq.current;
      setLoading(true);
      try {
        const r = await studioPreview(src, c);
        if (n === seq.current) setPreview(r);
      } catch (e) {
        if (n === seq.current) setPreview({ ok: false, reason: (e as Error).message });
      } finally {
        if (n === seq.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (source && info?.available) void load(source, choice);
  }, [source, choice, info?.available, load]);

  const pick = (c: StudioChoice) => setChoice(c);

  const tryAnother = () => {
    const ids = (info?.backgrounds || []).map((b) => b.id);
    if (!ids.length) return;
    const i = ids.indexOf(choice.id);
    pick({ ...choice, id: ids[(i + 1) % ids.length] });
    grid.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  async function uploadCustom(f?: File) {
    if (!f) return;
    setUploadingBg(true);
    try {
      const [url] = await uploadFiles([f], 'site');
      pick({ id: 'custom', customUrl: url });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingBg(false);
    }
  }

  /** one photo (or all of them in a batch) onto the chosen background, saved */
  async function apply(mode: 'replace' | 'new') {
    const list = batch ? photos.map((p, i) => ({ p, i })) : [{ p: source, i: index }];
    setBusy(mode);
    setProgress({ done: 0, total: list.length });
    const results: StudioResult[] = [];
    const kept: string[] = [];
    for (let k = 0; k < list.length; k++) {
      const { p, i } = list[k];
      setStatus((s) => s.map((x, j) => (j === i ? 'working' : x)));
      try {
        const r = await studioApply(p, choice);
        if (r.ok) {
          results.push({ source: p, url: r.url });
          setStatus((s) => s.map((x, j) => (j === i ? 'done' : x)));
        } else {
          kept.push(r.reason);
          setStatus((s) => s.map((x, j) => (j === i ? 'kept' : x)));
        }
      } catch (e) {
        kept.push((e as Error).message);
        setStatus((s) => s.map((x, j) => (j === i ? 'failed' : x)));
      }
      setProgress({ done: k + 1, total: list.length });
    }
    setBusy('');
    setProgress(null);
    if (results.length) {
      onDone(results, mode);
      toast.ok(`${results.length} photo${results.length === 1 ? '' : 's'} ${mode === 'replace' ? 'replaced' : 'added'} with the new background`);
    }
    if (kept.length) toast.error(`${kept.length} photo${kept.length === 1 ? '' : 's'} kept as ${kept.length === 1 ? 'it was' : 'they were'}: ${[...new Set(kept)].slice(0, 2).join(' · ')}`);
    if (results.length && (!batch || !kept.length)) onClose();
  }

  // drag the before / after handle
  const drag = (e: React.PointerEvent) => {
    const el = viewer.current;
    if (!el) return;
    const move = (x: number) => {
      const r = el.getBoundingClientRect();
      setPos(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100)));
    };
    move(e.clientX);
    const mv = (ev: PointerEvent) => move(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const bgName =
    choice.id === 'transparent' ? 'Transparent cut-out (with shadow)' : choice.id === 'transparent-clean' ? 'Transparent cut-out' : choice.id === 'custom' ? 'Custom background' : info?.backgrounds.find((b) => b.id === choice.id)?.name || choice.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Photo Studio">
      <div className="absolute inset-0 bg-slate-950/70" onClick={() => !busy && onClose()} />
      <div className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="inline-flex items-center gap-2 text-base font-bold text-slate-900">
            <Sparkles className="h-5 w-5 text-blue-600" /> Photo Studio
            <span className="text-xs font-medium text-slate-500">{batch ? `${photos.length} photos` : '1 photo'}</span>
          </h2>
          <button type="button" onClick={() => !busy && onClose()} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        {info && !info.available ? (
          <div className="p-8 text-center text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Photo Studio is not set up on the server yet.</p>
            <p className="mt-1">{info.reason}</p>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_300px] lg:overflow-hidden">
            {/* viewer */}
            <div className="flex min-h-0 flex-col bg-slate-900 p-3 lg:overflow-y-auto">
              <div className={cx('relative rounded-xl', zoom > 1 ? 'overflow-auto' : 'overflow-hidden')} style={{ maxHeight: '62vh' }}>
                <div ref={viewer} className="relative select-none" style={{ width: `${zoom * 100}%` }}>
                  {preview?.ok ? (
                    <>
                      <img
                        src={preview.after}
                        alt="After"
                        draggable={false}
                        className="block w-full"
                        style={choice.id.startsWith('transparent') ? { backgroundImage: CHECKER, backgroundSize: '20px 20px', backgroundPosition: '0 0,0 10px,10px -10px,-10px 0' } : undefined}
                      />
                      <img src={preview.before} alt="Before" draggable={false} className="absolute inset-0 block h-full w-full" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
                      <div className="absolute inset-y-0 z-10 w-0.5 cursor-ew-resize bg-white shadow" style={{ left: `${pos}%` }} onPointerDown={drag}>
                        <span className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg">
                          <ChevronsLeftRight className="h-4 w-4" />
                        </span>
                      </div>
                      <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[11px] font-bold text-white">BEFORE</span>
                      <span className="absolute right-2 top-2 rounded bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">AFTER</span>
                    </>
                  ) : (
                    <div className="relative aspect-[4/3] w-full">
                      {source && <img src={mediaUrl(source)} alt="" className="h-full w-full object-contain opacity-60" />}
                      {preview && !preview.ok && !loading && (
                        <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-lg bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-900">
                          This photo is kept as it is: {preview.reason}
                        </p>
                      )}
                      {choice.id === 'custom' && !choice.customUrl && (
                        <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-lg bg-white px-4 py-3 text-center text-sm font-medium text-slate-800">Upload your background photo first.</p>
                      )}
                    </div>
                  )}
                  {loading && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900/30">
                      <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow">
                        <Spinner className="h-4 w-4" /> {preview?.ok ? 'Changing background…' : 'Cutting out the vehicle…'}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-white">
                <span className="text-xs font-semibold text-slate-300">Before</span>
                <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="w-40 accent-blue-500" aria-label="Before / after" />
                <span className="text-xs font-semibold text-slate-300">After</span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white/10 p-1">
                  <button type="button" className="rounded p-1 hover:bg-white/20 disabled:opacity-40" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))} aria-label="Zoom out">
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-10 text-center text-xs font-bold">{zoom * 100}%</span>
                  <button type="button" className="rounded p-1 hover:bg-white/20 disabled:opacity-40" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z * 2))} aria-label="Zoom in">
                    <Plus className="h-4 w-4" />
                  </button>
                </span>
              </div>

              {batch && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {photos.map((p, i) => (
                    <button
                      type="button"
                      key={p + i}
                      onClick={() => !busy && setIndex(i)}
                      className={cx('relative h-14 w-20 shrink-0 overflow-hidden rounded-md ring-2', i === index ? 'ring-blue-500' : 'ring-transparent hover:ring-white/50')}
                    >
                      <img src={mediaUrl(p)} alt="" className="h-full w-full object-cover" />
                      {status[i] !== 'waiting' && (
                        <span
                          className={cx(
                            'absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-bold text-white',
                            status[i] === 'done' ? 'bg-emerald-600' : status[i] === 'working' ? 'bg-blue-600' : 'bg-amber-600',
                          )}
                        >
                          {status[i] === 'done' ? 'Done' : status[i] === 'working' ? 'Working' : status[i] === 'kept' ? 'Kept' : 'Failed'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* backgrounds + actions */}
            <div className="flex min-h-0 flex-col border-l border-slate-100">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Background</span>
                  <button type="button" onClick={tryAnother} disabled={!!busy || loading} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline disabled:opacity-40">
                    <RefreshCw className="h-3.5 w-3.5" /> Try another background
                  </button>
                </div>
                <div ref={grid} className="grid grid-cols-2 gap-2">
                  {(info?.backgrounds || []).map((b) => (
                    <Tile key={b.id} on={choice.id === b.id} label={b.name} title={b.desc} onClick={() => pick({ ...choice, id: b.id })}>
                      <img src={API_URL + b.thumb} alt="" className="h-full w-full object-cover" />
                    </Tile>
                  ))}
                  <Tile on={choice.id.startsWith('transparent')} label="Transparent PNG" title="The vehicle on its own, no background" onClick={() => pick({ ...choice, id: choice.id === 'transparent-clean' ? 'transparent-clean' : 'transparent' })}>
                    <div className="h-full w-full" style={{ backgroundImage: CHECKER, backgroundSize: '14px 14px', backgroundPosition: '0 0,0 7px,7px -7px,-7px 0' }}>
                      <Layers className="m-auto h-full w-6 text-slate-400" />
                    </div>
                  </Tile>
                  <Tile
                    on={choice.id === 'custom'}
                    label={choice.customUrl ? 'Custom background' : 'Upload background'}
                    title="Your own showroom wall or lot photo"
                    onClick={() => (choice.customUrl ? pick({ id: 'custom', customUrl: choice.customUrl }) : customFile.current?.click())}
                  >
                    {uploadingBg ? (
                      <div className="flex h-full items-center justify-center">
                        <Spinner className="h-5 w-5" />
                      </div>
                    ) : choice.customUrl ? (
                      <img src={mediaUrl(choice.customUrl)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-slate-100">
                        <ImagePlus className="h-6 w-6 text-slate-400" />
                      </div>
                    )}
                  </Tile>
                </div>
                {choice.id.startsWith('transparent') && (
                  <label className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-blue-600"
                      checked={choice.id === 'transparent'}
                      onChange={(e) => pick({ ...choice, id: e.target.checked ? 'transparent' : 'transparent-clean' })}
                    />
                    Soft ground shadow under the vehicle
                  </label>
                )}
                {choice.customUrl && (
                  <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-blue-700" onClick={() => customFile.current?.click()}>
                    <Upload className="h-3.5 w-3.5" /> Use a different custom photo
                  </button>
                )}
                <input
                  ref={customFile}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    void uploadCustom(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <p className="mt-3 text-xs text-slate-500">
                  <b className="text-slate-700">{bgName}</b> is remembered for your next photos. Interior and close-up photos are kept as they are.
                </p>
              </div>

              <div className="shrink-0 space-y-2 border-t border-slate-100 p-4">
                {progress && (
                  <div role="status" aria-live="polite">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-900">
                      <Spinner className="h-3.5 w-3.5" /> Applying… {progress.done} of {progress.total}
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-blue-100">
                      <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <Button type="button" className="w-full" loading={busy === 'replace'} disabled={!!busy || (!batch && !preview?.ok)} onClick={() => apply('replace')}>
                  <Replace className="h-4 w-4" /> {batch ? `Replace all ${photos.length} originals` : 'Replace original'}
                </Button>
                <Button type="button" variant="secondary" className="w-full" loading={busy === 'new'} disabled={!!busy || (!batch && !preview?.ok)} onClick={() => apply('new')}>
                  <Check className="h-4 w-4" /> {batch ? `Save ${photos.length} as new photos` : 'Save as new photo'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ on, label, title, onClick, children }: { on: boolean; label: string; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className={cx('group overflow-hidden rounded-lg text-left ring-2 transition', on ? 'ring-blue-600' : 'ring-slate-200 hover:ring-slate-400')}>
      <div className="relative aspect-[4/3] bg-slate-100">
        {children}
        {on && (
          <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
            <Check className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className={cx('truncate px-2 py-1 text-[11px] font-semibold', on ? 'bg-blue-50 text-blue-800' : 'text-slate-700')}>{label}</div>
    </button>
  );
}
