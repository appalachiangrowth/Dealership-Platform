'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, Globe, ImagePlus, Lock, PackageOpen, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from './toast';
import { Button, Drawer, Field, Input, Textarea, cx } from './ui';

/* ───────────── Platform Admin › Themes & releases › Add New Custom Theme + theme visibility ───────────── */

type Tenant = { id: string; name: string; dealerCode?: string; domains?: { domain: string }[] };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** searchable multi-select of dealerships */
export function DealershipPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const tenants = useApi<Tenant[]>('/platform/tenants');
  const [q, setQ] = useState('');
  const list = tenants.data || [];
  const byId = useMemo(() => Object.fromEntries(list.map((t) => [t.id, t])), [list]);
  const term = q.trim().toLowerCase();
  const matches = list.filter((t) => !term || t.name.toLowerCase().includes(term) || (t.dealerCode || '').toLowerCase().includes(term) || t.domains?.some((d) => d.domain.includes(term))).slice(0, 50);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-2.5">
          {value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-violet-600 py-1 pl-2.5 pr-1 text-xs font-semibold text-white">
              {byId[id]?.name || id}
              <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${byId[id]?.name || id}`} className="rounded-full p-0.5 hover:bg-white/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative border-b border-slate-100">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dealerships by name, code or domain…" className="w-full rounded-t-xl bg-transparent py-2 pl-9 pr-3 text-sm outline-none" />
      </div>
      <ul className="max-h-52 overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
        {tenants.loading && !list.length && <li className="px-3 py-2 text-sm text-slate-500">Loading…</li>}
        {!tenants.loading && !matches.length && <li className="px-3 py-2 text-sm text-slate-500">No dealership matches “{q}”.</li>}
        {matches.map((t) => {
          const on = value.includes(t.id);
          return (
            <li key={t.id}>
              <button type="button" role="option" aria-selected={on} onClick={() => toggle(t.id)} className={cx('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50', on && 'bg-violet-50/60')}>
                <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300')}>{on && <Check className="h-3 w-3" />}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-medium text-slate-900">{t.name}</b>
                  <span className="block truncate text-xs text-slate-500">{[t.dealerCode, t.domains?.[0]?.domain].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Public (all dealerships) / Private (specific dealerships only) */
export function VisibilityControl({ isPrivate, ids, onChange }: { isPrivate: boolean; ids: string[]; onChange: (v: { isPrivate: boolean; ids: string[] }) => void }) {
  return (
    <div className="space-y-3">
      <div role="radiogroup" className="grid gap-2.5 sm:grid-cols-2">
        {(
          [
            [false, 'Public (all dealerships)', 'Every dealership sees it in Design & colours.', Globe],
            [true, 'Private / specific dealership(s)', 'Only the dealerships you choose see it.', Lock],
          ] as const
        ).map(([v, l, d, Icon]) => {
          const on = isPrivate === v;
          return (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ isPrivate: v, ids })}
              className={cx('flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition', on ? 'border-violet-600 bg-violet-50/60 ring-1 ring-violet-600' : 'border-slate-200 hover:bg-slate-50')}
            >
              <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', on ? 'text-violet-600' : 'text-slate-400')} />
              <span>
                <b className="block text-sm text-slate-900">{l}</b>
                <span className="text-xs text-slate-500">{d}</span>
              </span>
            </button>
          );
        })}
      </div>
      {isPrivate && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dealerships that can see this theme <span className="text-red-600">*</span>
          </div>
          <DealershipPicker value={ids} onChange={(x) => onChange({ isPrivate, ids: x })} />
          {!ids.length && <p className="mt-1.5 text-xs text-amber-700">Choose at least one dealership.</p>}
        </div>
      )}
    </div>
  );
}

const EMPTY = { name: '', key: '', keyEdited: false, description: '', isPrivate: true, ids: [] as string[] };

/** Add New Custom Theme: ZIP + name / key + optional preview + who can see it */
export function AddCustomTheme({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (themes: unknown) => void }) {
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [zip, setZip] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const zipRef = useRef<HTMLInputElement>(null);
  const prevRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => (preview ? URL.createObjectURL(preview) : ''), [preview]);

  function close() {
    if (busy) return;
    setF(EMPTY);
    setZip(null);
    setPreview(null);
    setErr('');
    onClose();
  }

  async function submit() {
    setErr('');
    if (f.name.trim().length < 2) return setErr('Enter the theme name.');
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(f.key)) return setErr('The key must use lowercase letters, numbers and hyphens (2–40 characters).');
    if (!zip) return setErr('Choose the theme package (.zip).');
    if (!/\.zip$/i.test(zip.name)) return setErr('The theme package must be a .zip file.');
    if (zip.size > 40 * 1024 * 1024) return setErr('The ZIP must be smaller than 40 MB.');
    if (preview && preview.size > 5 * 1024 * 1024) return setErr('The preview picture must be smaller than 5 MB.');
    if (f.isPrivate && !f.ids.length) return setErr('Choose at least one dealership, or make the theme public.');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', zip, zip.name);
      if (preview) form.append('preview', preview, preview.name);
      form.append('name', f.name.trim());
      form.append('key', f.key);
      form.append('description', f.description.trim());
      form.append('visibility', f.isPrivate ? 'private' : 'public');
      form.append('allowedTenantIds', f.isPrivate ? f.ids.join(',') : '');
      const r = await api<{ message: string }>('/platform/themes/custom', { form });
      toast.ok(r.message || 'Custom theme installed');
      onDone(await api('/platform/themes'));
      setBusy(false);
      close();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Add New Custom Theme"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} className="bg-violet-600 hover:bg-violet-700">
            <PackageOpen className="h-4 w-4" /> Install custom theme
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          Upload a theme package made for one dealership (or all). It is installed for both storefronts and shown in Design &amp; colours to the dealerships you choose — nothing is activated until the dealer (or you, under Install &amp; switch) picks it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              <>
                Theme name <span className="text-red-600">*</span>
              </>
            }
          >
            <Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value, key: x.keyEdited ? x.key : slugify(e.target.value) }))} maxLength={60} placeholder="Peerless Bespoke Edition" />
          </Field>
          <Field
            label={
              <>
                Theme key / slug <span className="text-red-600">*</span>
              </>
            }
            hint="Folder name of the theme; cannot be changed later."
          >
            <Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40), keyEdited: true })} maxLength={40} placeholder="peerless-custom-v1" className="font-mono text-[13px]" />
          </Field>
        </div>
        <Field label="Description" hint="Shown to the dealer under the theme picture.">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={400} placeholder="A bespoke dark storefront in Peerless red, with a video hero and featured trucks." />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Theme package (.zip) <span className="text-red-600">*</span>
            </div>
            <button
              type="button"
              onClick={() => zipRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) setZip(file);
              }}
              className={cx('flex h-[112px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 text-center transition', zip ? 'border-violet-400 bg-violet-50/50' : 'border-slate-300 hover:border-violet-400 hover:bg-slate-50')}
            >
              <PackageOpen className="h-6 w-6 text-violet-600" />
              <b className="max-w-full truncate text-sm text-slate-800">{zip ? zip.name : 'Choose or drop the theme ZIP'}</b>
              <span className="text-xs text-slate-500">{zip ? `${(zip.size / 1024 / 1024).toFixed(1)} MB` : 'theme.json + templates/ (+ partials/, assets/) · max 40 MB'}</span>
            </button>
            <input ref={zipRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => setZip(e.target.files?.[0] || null)} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Preview thumbnail <span className="font-normal text-slate-400">(optional)</span>
            </div>
            <button type="button" onClick={() => prevRef.current?.click()} className="relative flex h-[112px] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 hover:border-violet-400">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-xs text-slate-500">
                  <ImagePlus className="h-5 w-5 text-slate-400" /> JPG, PNG or WebP
                </span>
              )}
            </button>
            {preview && (
              <button type="button" onClick={() => setPreview(null)} className="mt-1 text-xs font-semibold text-slate-500 hover:text-red-600">
                Remove picture
              </button>
            )}
            <input ref={prevRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setPreview(e.target.files?.[0] || null)} />
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Visibility & dealership assignment</div>
          <VisibilityControl isPrivate={f.isPrivate} ids={f.ids} onChange={(v) => setF({ ...f, isPrivate: v.isPrivate, ids: v.ids })} />
        </div>

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
      </div>
    </Drawer>
  );
}
