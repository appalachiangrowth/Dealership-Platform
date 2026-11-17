'use client';

/**
 * Platform Admin › SEO & URLs › Images — one dealership's media library (WordPress-style):
 * thumbnail grid with an Images / Videos filter and search, "Add Media File", and an Attachment details window
 * (preview, file facts, Alternative Text / Title / Caption / Description, File URL + copy).
 * The alt text and title are put on the dealer website's <img> tags of that picture when the design gives none.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Film, ImageIcon, Play, Search, Upload, X } from 'lucide-react';
import { ApiError, api, mediaUrl } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Spinner, cx } from '@/components/ui';

export type MediaItem = {
  id: string;
  url: string;
  fileName: string;
  originalName: string;
  mime: string;
  kind: 'image' | 'video' | 'file';
  size: number;
  width: number | null;
  height: number | null;
  altText: string;
  title: string;
  caption: string;
  description: string;
  uploadedBy: string;
  createdAt: string;
};
type ListResp = { items: MediaItem[]; total: number; page: number; pageSize: number; counts: { image: number; video: number } };
type Meta = Pick<MediaItem, 'altText' | 'title' | 'caption' | 'description'>;

const PAGE_SIZE = 60;
const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,video/mp4,video/webm,video/quicktime,.heic,.mov';

const fmtSize = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const label = (m: MediaItem) => m.title || m.originalName || m.fileName;
const CHECKER = {
  backgroundColor: '#fff',
  backgroundImage: 'linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0,0 10px,10px -10px,-10px 0',
};

export function MediaLibrary({ dealerId, dealerName, siteBase }: { dealerId: string; dealerName: string; siteBase?: string }) {
  const toast = useToast();
  const [type, setType] = useState<'' | 'image' | 'video'>('');
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ image: 0, video: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<number>(-1);
  const fileRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQLive(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async (p: number) => {
      const id = ++reqId.current;
      setLoading(true);
      setError('');
      try {
        const r = await api<ListResp>(`/platform/media/${encodeURIComponent(dealerId)}?type=${type}&q=${encodeURIComponent(qLive)}&page=${p}&pageSize=${PAGE_SIZE}`);
        if (id !== reqId.current) return;
        setItems((cur) => (p === 1 ? r.items : [...cur, ...r.items.filter((x) => !cur.some((c) => c.id === x.id))]));
        setTotal(r.total);
        setCounts(r.counts);
        setPage(p);
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [dealerId, type, qLive],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const upload = async (list: FileList | File[] | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    setUploading(files.length);
    const added: MediaItem[] = [];
    const errors: string[] = [];
    // a few files per request, so one large video does not hold up the pictures
    for (let i = 0; i < files.length; i += 5) {
      const form = new FormData();
      for (const f of files.slice(i, i + 5)) form.append('files', f);
      try {
        const r = await api<{ files: MediaItem[]; errors: { file: string; error: string }[] }>(`/platform/media/${encodeURIComponent(dealerId)}`, { form });
        added.push(...r.files);
        errors.push(...r.errors.map((e) => `${e.file}: ${e.error}`));
      } catch (e) {
        errors.push(e instanceof ApiError && e.status === 413 ? 'A file is larger than 150 MB' : (e as Error).message);
      }
      setUploading(Math.max(0, files.length - i - 5));
    }
    setUploading(0);
    if (fileRef.current) fileRef.current.value = '';
    if (added.length) {
      toast.ok(`${added.length} file${added.length > 1 ? 's' : ''} added to ${dealerName || 'the media library'}`);
      void load(1);
    }
    if (errors.length) toast.error(errors.slice(0, 3).join('\n'));
  };

  const onSaved = (m: MediaItem) => setItems((cur) => cur.map((x) => (x.id === m.id ? m : x)));
  const shown = type === 'image' ? counts.image : type === 'video' ? counts.video : counts.image + counts.video;

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDrag(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDrag(false);
        void upload(e.dataTransfer.files);
      }}
    >
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold text-slate-900">Media Library</h2>
        <Button variant="secondary" size="sm" loading={uploading > 0} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> Add Media File
        </Button>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => void upload(e.target.files)} />
        <span className="text-xs text-slate-500">
          {uploading > 0 ? `Uploading… ${uploading} file${uploading > 1 ? 's' : ''} left` : `Pictures and videos of ${dealerName || 'this dealership'} — vehicle photos, blog pictures, logo, favicon and website images.`}
        </span>
      </div>

      {/* filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as '' | 'image' | 'video')}
          aria-label="Media type"
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 pr-8 text-sm font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="">All media items</option>
          <option value="image">Images ({counts.image})</option>
          <option value="video">Videos ({counts.video})</option>
        </select>
        <span className="text-xs text-slate-500">
          {loading && !items.length ? 'Loading…' : `${total.toLocaleString('en-US')} ${qLive ? 'found' : 'items'}${qLive ? ` of ${shown.toLocaleString('en-US')}` : ''}`}
        </span>
        <label className="relative ml-auto w-full sm:w-72">
          <span className="sr-only">Search media</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search media..."
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </div>

      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {/* grid */}
      {!items.length && !loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <ImageIcon className="mb-3 h-10 w-10 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">{qLive ? 'No media matches your search.' : 'No media files yet.'}</p>
          <p className="mt-1 text-xs text-slate-500">Drop pictures or videos here, or use Add Media File.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
          {items.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setOpen(i)}
                className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                title={label(m)}
              >
                <span className="relative block aspect-square w-full overflow-hidden" style={m.kind === 'image' ? CHECKER : { background: '#0f172a' }}>
                  {m.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(m.url)} alt={m.altText} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <>
                      <video src={`${mediaUrl(m.url)}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover opacity-80" />
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow">
                          <Play className="h-4 w-4 translate-x-px" />
                        </span>
                      </span>
                    </>
                  )}
                  {m.altText && m.kind === 'image' && <span className="absolute left-1.5 top-1.5 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">Alt</span>}
                </span>
                <span className="block truncate border-t border-slate-100 px-2 py-1.5 text-[12px] text-slate-700">{label(m)}</span>
              </button>
            </li>
          ))}
          {loading &&
            Array.from({ length: items.length ? 6 : 12 }).map((_, i) => (
              <li key={`sk${i}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <span className="block aspect-square animate-pulse bg-slate-100" />
                <span className="m-2 block h-3 w-2/3 animate-pulse rounded bg-slate-100" />
              </li>
            ))}
        </ul>
      )}

      {items.length < total && !loading && (
        <div className="mt-5 flex flex-col items-center gap-2">
          <p className="text-xs text-slate-500">
            Showing {items.length.toLocaleString('en-US')} of {total.toLocaleString('en-US')} media items
          </p>
          <Button variant="secondary" size="sm" onClick={() => void load(page + 1)}>
            Load more
          </Button>
        </div>
      )}

      {drag && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/80">
          <p className="text-sm font-semibold text-blue-800">Drop files to upload</p>
        </div>
      )}

      {open >= 0 && items[open] && (
        <AttachmentDetails
          key={items[open].id}
          dealerId={dealerId}
          item={items[open]}
          siteBase={siteBase}
          hasPrev={open > 0}
          hasNext={open < items.length - 1 || items.length < total}
          onPrev={() => setOpen((i) => Math.max(0, i - 1))}
          onNext={async () => {
            if (open < items.length - 1) setOpen(open + 1);
            else if (items.length < total) {
              await load(page + 1);
              setOpen(open + 1);
            }
          }}
          onClose={() => setOpen(-1)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Attachment details ───────────────────────── */

function AttachmentDetails({
  dealerId,
  item,
  siteBase,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onSaved,
}: {
  dealerId: string;
  item: MediaItem;
  siteBase?: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void | Promise<void>;
  onClose: () => void;
  onSaved: (m: MediaItem) => void;
}) {
  const toast = useToast();
  const initial: Meta = { altText: item.altText, title: item.title, caption: item.caption, description: item.description };
  const [meta, setMeta] = useState<Meta>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(item.width && item.height ? { w: item.width, h: item.height } : null);
  const dirty = (Object.keys(initial) as (keyof Meta)[]).some((k) => meta[k] !== initial[k]);
  const fileUrl = siteBase ? `${siteBase.replace(/\/+$/, '')}${item.url}` : typeof window !== 'undefined' ? new URL(mediaUrl(item.url), window.location.origin).toString() : item.url;

  const save = useCallback(async () => {
    if (!dirty) return true;
    setSaving(true);
    try {
      const m = await api<MediaItem>(`/platform/media/${encodeURIComponent(dealerId)}/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: meta });
      onSaved(m);
      setSavedAt(Date.now());
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, dealerId, item.id, meta, onSaved, toast]);

  /* going to the previous / next file or closing keeps what was typed (saved first, like WordPress) */
  const go = useCallback(
    async (fn: () => void | Promise<void>) => {
      if (await save()) await fn();
    },
    [save],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if (e.key === 'Escape') void go(onClose);
      else if (!typing && e.key === 'ArrowLeft' && hasPrev) void go(onPrev);
      else if (!typing && e.key === 'ArrowRight' && hasNext) void go(onNext);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [go, hasNext, hasPrev, onClose, onNext, onPrev, save]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fileUrl);
    } catch {
      const t = document.createElement('textarea');
      t.value = fileUrl;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const field = 'w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';
  const row = (lbl: string, control: React.ReactNode, help?: React.ReactNode) => (
    <div className="grid gap-1.5 sm:grid-cols-[112px_1fr] sm:gap-3">
      <span className="pt-2 text-[13px] text-slate-600 sm:text-right">{lbl}</span>
      <div>
        {control}
        {help && <p className="mt-1 text-[11px] leading-4 text-slate-500">{help}</p>}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-6" role="dialog" aria-modal="true" aria-label="Attachment details" onMouseDown={(e) => e.target === e.currentTarget && void go(onClose)}>
      <div className="flex h-full max-h-[920px] w-full max-w-[1280px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        {/* header */}
        <div className="flex h-14 flex-none items-stretch border-b border-slate-200">
          <h3 className="flex flex-1 items-center px-5 text-lg font-semibold text-slate-900">Attachment details</h3>
          <button type="button" aria-label="Previous media item" disabled={!hasPrev} onClick={() => void go(onPrev)} className="flex w-14 items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Next media item" disabled={!hasNext} onClick={() => void go(onNext)} className="flex w-14 items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white">
            <ChevronRight className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Close dialog" onClick={() => void go(onClose)} className="flex w-14 items-center justify-center border-l border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-red-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_440px] lg:overflow-hidden">
          {/* preview */}
          <div className="flex min-h-[280px] items-center justify-center bg-slate-50 p-4 sm:p-8 lg:min-h-0">
            {item.kind === 'video' ? (
              <video src={mediaUrl(item.url)} controls playsInline className="max-h-full max-w-full rounded bg-black shadow" />
            ) : (
              <div className="flex max-h-full max-w-full items-center justify-center" style={CHECKER}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl(item.url)}
                  alt={meta.altText}
                  className="max-h-[calc(100vh-220px)] max-w-full object-contain lg:max-h-[760px]"
                  onLoad={(e) => !dims && setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                />
              </div>
            )}
          </div>

          {/* details */}
          <div className="flex min-h-0 flex-col border-t border-slate-200 bg-slate-50/50 lg:border-l lg:border-t-0">
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <dl className="space-y-1 text-[13px] leading-5 text-slate-700">
                {[
                  ['Uploaded on', fmtDate(item.createdAt)],
                  ...(item.uploadedBy ? [['Uploaded by', item.uploadedBy]] : []),
                  ['File name', item.fileName],
                  ...(item.originalName && item.originalName !== item.fileName ? [['Original name', item.originalName]] : []),
                  ['File type', item.mime],
                  ['File size', fmtSize(item.size)],
                  ...(item.kind === 'image' ? [['Dimensions', dims ? `${dims.w} by ${dims.h} pixels` : '—']] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-1.5">
                    <dt className="flex-none font-semibold text-slate-800">{k}:</dt>
                    <dd className="min-w-0 break-all">{v}</dd>
                  </div>
                ))}
              </dl>
              <hr className="border-slate-200" />

              {item.kind !== 'video' &&
                row(
                  'Alternative Text',
                  <textarea rows={3} value={meta.altText} maxLength={500} onChange={(e) => setMeta({ ...meta, altText: e.target.value })} className={cx(field, 'resize-y')} />,
                  <>Describe the purpose of the picture (e.g. &quot;2021 Ford F-150 XLT front view&quot;). Shown to Google and screen readers on the website. Leave empty if it is purely decorative.</>,
                )}
              {row('Title', <input value={meta.title} maxLength={200} placeholder={item.originalName || item.fileName} onChange={(e) => setMeta({ ...meta, title: e.target.value })} className={field} />)}
              {row('Image Caption', <textarea rows={3} value={meta.caption} maxLength={2000} onChange={(e) => setMeta({ ...meta, caption: e.target.value })} className={cx(field, 'resize-y')} />)}
              {row('Description', <textarea rows={4} value={meta.description} maxLength={5000} onChange={(e) => setMeta({ ...meta, description: e.target.value })} className={cx(field, 'resize-y')} />)}
              {row(
                'File URL',
                <div>
                  <input readOnly value={fileUrl} onFocus={(e) => e.currentTarget.select()} className={cx(field, 'bg-slate-100 font-mono text-[12px] text-slate-700')} />
                  <button
                    type="button"
                    onClick={() => void copy()}
                    className={cx(
                      'mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors',
                      copied ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-blue-600 text-blue-700 hover:bg-blue-50',
                    )}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? 'Copied!' : 'Copy URL to clipboard'}
                  </button>
                </div>,
              )}
              <p className="flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-2 text-[11px] leading-4 text-blue-900">
                {item.kind === 'video' ? <Film className="h-3.5 w-3.5 flex-none" /> : <ImageIcon className="h-3.5 w-3.5 flex-none" />}
                The alternative text and title are added to this {item.kind === 'video' ? 'video' : 'picture'} everywhere it appears on the dealer website, unless the page gives its own.
              </p>
            </div>
            <div className="flex flex-none items-center justify-end gap-3 border-t border-slate-200 bg-white px-5 py-3">
              {saving ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Spinner className="h-3.5 w-3.5" /> Saving…
                </span>
              ) : dirty ? (
                <span className="text-xs font-semibold text-amber-700">Unsaved changes</span>
              ) : savedAt ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              ) : null}
              <Button size="sm" disabled={!dirty} loading={saving} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
