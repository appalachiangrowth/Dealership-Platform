'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Copy, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { CATEGORIES, DEF, LINKS, TONES, newId, type Section } from '@/lib/page-sections';
import { useToast } from './toast';
import { Button, Field, Input, Select, Spinner, Textarea, Toggle, cx } from './ui';

type SetFn = (patch: Record<string, unknown>) => void;

/* ───────────────────────── small field helpers ───────────────────────── */

function Txt({ s, k, set, label, hint, ph }: { s: Section; k: string; set: SetFn; label: string; hint?: string; ph?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input value={s[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} placeholder={ph} />
    </Field>
  );
}

function Area({ s, k, set, label, hint, rows = 4, mono }: { s: Section; k: string; set: SetFn; label: string; hint?: string; rows?: number; mono?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <Textarea value={s[k] ?? ''} onChange={(e) => set({ [k]: e.target.value })} rows={rows} className={mono ? 'font-mono text-xs' : ''} />
    </Field>
  );
}

function Choice({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    </Field>
  );
}

async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const r = await api<{ url: string }>('/platform/pages/media', { form });
  return r.url;
}

/** one picture: upload, paste a link, or remove */
export function ImageField({ value, onChange, label = 'Picture' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      onChange(await uploadImage(f));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={label}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:border-blue-500"
        >
          {busy ? <Spinner /> : value ? <img src={mediaUrl(value)} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Upload, or paste a picture link (https://…)" className="text-xs" />
          {value && (
            <button type="button" onClick={() => onChange('')} className="text-xs font-semibold text-red-600">
              Remove picture
            </button>
          )}
        </div>
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
    </Field>
  );
}

/** a link: quick targets that follow the theme, or any address */
export function LinkField({ value, onChange, label = 'Goes to' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const known = LINKS.some(([v]) => v === value);
  const [custom, setCustom] = useState(!known && !!value);
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Select
          value={custom ? '__custom' : value || ''}
          onChange={(e) => {
            if (e.target.value === '__custom') {
              setCustom(true);
              onChange('');
            } else {
              setCustom(false);
              onChange(e.target.value);
            }
          }}
          className="w-44 shrink-0"
        >
          <option value="">— choose —</option>
          {LINKS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
          <option value="__custom">Other address…</option>
        </Select>
        {custom && <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…, /other-page or #pa-s-2" />}
      </div>
    </Field>
  );
}

function Buttons({ s, set, max = 2 }: { s: Section; set: SetFn; max?: number }) {
  const list: { label: string; link: string; style?: string }[] = Array.isArray(s.buttons) ? s.buttons : [];
  const upd = (i: number, p: Record<string, string>) => set({ buttons: list.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buttons</div>
      {list.map((b, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Input value={b.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Button text" />
            <Select value={b.style || (i === 0 ? 'primary' : 'ghost')} onChange={(e) => upd(i, { style: e.target.value })} className="w-32 shrink-0">
              <option value="primary">Filled</option>
              <option value="ghost">Outline</option>
            </Select>
            <button type="button" onClick={() => set({ buttons: list.filter((_, j) => j !== i) })} className="p-1 text-slate-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <LinkField value={b.link} onChange={(v) => upd(i, { link: v })} />
        </div>
      ))}
      {list.length < max && (
        <Button type="button" size="sm" variant="secondary" onClick={() => set({ buttons: [...list, { label: 'Button', link: 'inventory' }] })}>
          <Plus className="h-3.5 w-3.5" /> Add button
        </Button>
      )}
    </div>
  );
}

type Sub = { k: string; label: string; kind?: 'text' | 'area' | 'image' | 'link' };

/** repeatable items (cards, numbers, reviews, questions) */
function Items({ s, set, fields, addLabel, blank, max = 12 }: { s: Section; set: SetFn; fields: Sub[]; addLabel: string; blank: Record<string, string>; max?: number }) {
  const list: Record<string, string>[] = Array.isArray(s.items) ? s.items : [];
  const upd = (i: number, p: Record<string, string>) => set({ items: list.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    set({ items: n });
  };
  return (
    <div className="space-y-2">
      {list.map((it, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>#{i + 1}</span>
            <span className="flex gap-1">
              <button type="button" onClick={() => move(i, -1)} className="p-1 hover:text-slate-900">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => move(i, 1)} className="p-1 hover:text-slate-900">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => set({ items: list.filter((_, j) => j !== i) })} className="p-1 hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
          <div className="space-y-2">
            {fields.map((f) =>
              f.kind === 'area' ? (
                <Field key={f.k} label={f.label}>
                  <Textarea value={it[f.k] ?? ''} onChange={(e) => upd(i, { [f.k]: e.target.value })} rows={3} />
                </Field>
              ) : f.kind === 'image' ? (
                <ImageField key={f.k} label={f.label} value={it[f.k] ?? ''} onChange={(v) => upd(i, { [f.k]: v })} />
              ) : f.kind === 'link' ? (
                <LinkField key={f.k} label={f.label} value={it[f.k] ?? ''} onChange={(v) => upd(i, { [f.k]: v })} />
              ) : (
                <Field key={f.k} label={f.label}>
                  <Input value={it[f.k] ?? ''} onChange={(e) => upd(i, { [f.k]: e.target.value })} />
                </Field>
              ),
            )}
          </div>
        </div>
      ))}
      {list.length < max && (
        <Button type="button" size="sm" variant="secondary" onClick={() => set({ items: [...list, { ...blank }] })}>
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </Button>
      )}
    </div>
  );
}

function Gallery({ s, set }: { s: Section; set: SetFn }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const list: string[] = Array.isArray(s.images) ? s.images : [];
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) urls.push(await uploadImage(f));
      set({ images: [...list, ...urls].slice(0, 40) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="mb-2 grid grid-cols-4 gap-2">
        {list.map((u, i) => (
          <div key={u + i} className="group relative">
            <img src={mediaUrl(u)} alt="" className="aspect-square w-full rounded-md object-cover" />
            <button type="button" onClick={() => set({ images: list.filter((_, j) => j !== i) })} className="absolute right-1 top-1 hidden rounded bg-black/60 p-0.5 text-white group-hover:block">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => ref.current?.click()}>
        <ImagePlus className="h-3.5 w-3.5" /> Add pictures
      </Button>
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
    </div>
  );
}

function Heading({ s, set, intro = true }: { s: Section; set: SetFn; intro?: boolean }) {
  return (
    <>
      <Txt s={s} k="eyebrow" set={set} label="Small text above the heading" />
      <Txt s={s} k="title" set={set} label="Heading" hint="Put *stars* around a word to show it in the brand colour." />
      {intro && <Area s={s} k="intro" set={set} label="Intro (optional)" rows={2} />}
    </>
  );
}

/** a colour: picker + text box (#hex, rgb(), or a theme variable like var(--color-primary)) */
function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000';
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1" />
        <Input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="#0F172A" className="font-mono text-xs" />
      </div>
    </Field>
  );
}

/** Custom header: background, text colour, layout, buttons, custom HTML / CSS */
function CustomHeaderFields({ s, set }: { s: Section; set: SetFn }) {
  const bg = s.bg || 'gradient';
  return (
    <>
      <Txt s={s} k="eyebrow" set={set} label="Small text above the heading (optional)" />
      <Txt s={s} k="title" set={set} label="Heading" hint="Put *stars* around a word to show it in the accent colour." />
      <Area s={s} k="subtitle" set={set} label="Subtitle" rows={2} />

      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Background</div>
        <Choice
          label="Type"
          value={bg}
          onChange={(v) => set({ bg: v })}
          options={[
            ['theme', "Theme's dark header look"],
            ['brand', 'Brand colour'],
            ['color', 'One colour'],
            ['gradient', 'Gradient'],
            ['image', 'Picture'],
          ]}
        />
        {bg === 'color' && <ColorField label="Colour" value={s.bgColor} onChange={(v) => set({ bgColor: v })} />}
        {bg === 'gradient' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <ColorField label="From" value={s.gradFrom} onChange={(v) => set({ gradFrom: v })} />
              <ColorField label="To" value={s.gradTo} onChange={(v) => set({ gradTo: v })} />
            </div>
            <Field label={`Direction: ${s.gradAngle ?? 135}°`}>
              <input type="range" min={0} max={360} step={5} value={s.gradAngle ?? 135} onChange={(e) => set({ gradAngle: Number(e.target.value) })} className="w-full" />
            </Field>
          </>
        )}
        {bg === 'image' && (
          <>
            <ImageField value={s.image} onChange={(v) => set({ image: v })} label="Background picture" />
            <Field label={`Darken the picture: ${s.overlay ?? 50}%`}>
              <input type="range" min={0} max={90} value={s.overlay ?? 50} onChange={(e) => set({ overlay: Number(e.target.value) })} className="w-full" />
            </Field>
            <Choice label="Picture focus" value={s.imagePos || 'center'} onChange={(v) => set({ imagePos: v })} options={[['center', 'Centre'], ['top', 'Top'], ['bottom', 'Bottom']]} />
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Choice label="Text colour" value={s.textColor || 'auto'} onChange={(v) => set({ textColor: v })} options={[['auto', 'Automatic'], ['light', 'Light (white)'], ['dark', 'Dark']]} />
        <ColorField label="Accent (optional)" value={s.accent} onChange={(v) => set({ accent: v })} hint="Starred word + small text. Empty = theme colour." />
        <Choice label="Alignment" value={s.align || 'left'} onChange={(v) => set({ align: v })} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} />
        <Choice label="Height" value={s.height || 'm'} onChange={(v) => set({ height: v })} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Full screen']]} />
        <Choice label="Text width" value={s.width || 'narrow'} onChange={(v) => set({ width: v })} options={[['narrow', 'Easy to read'], ['wide', 'Full width']]} />
        <Choice label="Heading level (SEO)" value={s.level || 'h1'} onChange={(v) => set({ level: v })} options={[['h1', 'H1 — main heading'], ['h2', 'H2 — section heading']]} />
      </div>

      <Buttons s={s} set={set} />

      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">Custom HTML &amp; CSS (advanced)</summary>
        <div className="mt-3 space-y-3">
          <Area s={s} k="html" set={set} label="Extra HTML (shown under the buttons)" rows={4} mono hint="Badges, a short form, an embed… Shown as-is: only paste code you trust." />
          <Area
            s={s}
            k="css"
            set={set}
            label="Custom CSS (this header only)"
            rows={5}
            mono
            hint={'"&" is this header: & h1 { letter-spacing: 0 }  & .pa-btn { border-radius: 4px }. Plain declarations (min-height: 70vh) style the header box.'}
          />
        </div>
      </details>
    </>
  );
}

/* ───────────────────────── the form of each section type ───────────────────────── */

function Fields({ s, set }: { s: Section; set: SetFn }) {
  switch (s.type) {
    case 'hero':
      return (
        <>
          <Txt s={s} k="eyebrow" set={set} label="Small text above the headline" />
          <Txt s={s} k="title" set={set} label="Headline" hint="Put *stars* around a word to show it in the brand colour." />
          <Area s={s} k="text" set={set} label="Text under the headline" rows={3} />
          <ImageField value={s.image} onChange={(v) => set({ image: v })} label="Background picture (optional)" />
          {s.image && (
            <Field label={`Darken the picture: ${s.overlay ?? 55}%`}>
              <input type="range" min={0} max={90} value={s.overlay ?? 55} onChange={(e) => set({ overlay: Number(e.target.value) })} className="w-full" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Choice label="Height" value={s.height || 'm'} onChange={(v) => set({ height: v })} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
            <Choice label="Text position" value={s.align || 'left'} onChange={(v) => set({ align: v })} options={[['left', 'Left'], ['center', 'Centre']]} />
          </div>
          <Buttons s={s} set={set} />
        </>
      );
    case 'header':
      return <CustomHeaderFields s={s} set={set} />;
    case 'text':
      return (
        <>
          <Heading s={s} set={set} intro={false} />
          <Area s={s} k="body" set={set} label="Text" rows={8} hint="Empty line = new paragraph. “- ” list, “## ” small heading, **bold**, *italic*, [link text](contact)." />
          <div className="grid grid-cols-2 gap-3">
            <Choice label="Width" value={s.width || 'narrow'} onChange={(v) => set({ width: v })} options={[['narrow', 'Easy to read'], ['wide', 'Full width']]} />
            <Choice label="Alignment" value={s.align || 'left'} onChange={(v) => set({ align: v })} options={[['left', 'Left'], ['center', 'Centre']]} />
          </div>
          <Buttons s={s} set={set} />
        </>
      );
    case 'split':
      return (
        <>
          <Heading s={s} set={set} intro={false} />
          <Area s={s} k="body" set={set} label="Text" rows={6} hint="Lists, **bold** and [links](contact) work here." />
          <ImageField value={s.image} onChange={(v) => set({ image: v })} />
          <Choice label="Picture side" value={s.imageSide || 'right'} onChange={(v) => set({ imageSide: v })} options={[['right', 'Right'], ['left', 'Left']]} />
          <Buttons s={s} set={set} />
        </>
      );
    case 'cards':
      return (
        <>
          <Heading s={s} set={set} />
          <div className="grid grid-cols-2 gap-3">
            <Choice label="Cards per row" value={String(s.columns || 3)} onChange={(v) => set({ columns: Number(v) })} options={[['2', '2'], ['3', '3'], ['4', '4']]} />
            <Choice label="Heading" value={s.align || 'left'} onChange={(v) => set({ align: v })} options={[['left', 'Left'], ['center', 'Centre']]} />
          </div>
          <Items
            s={s}
            set={set}
            addLabel="Add card"
            blank={{ icon: '⭐', title: 'Title', text: '' }}
            fields={[
              { k: 'icon', label: 'Icon (an emoji)' },
              { k: 'title', label: 'Title' },
              { k: 'text', label: 'Text', kind: 'area' },
              { k: 'image', label: 'Picture (optional)', kind: 'image' },
              { k: 'link', label: 'Card opens (optional)', kind: 'link' },
            ]}
          />
        </>
      );
    case 'inventory': {
      const f = (s.filter || {}) as Record<string, any>;
      const setF = (p: Record<string, unknown>) => set({ filter: { ...f, ...p } });
      return (
        <>
          <Heading s={s} set={set} />
          <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-900">
            Shows the dealership&apos;s published vehicles, live: new and sold cars appear / disappear by themselves. Each card opens the vehicle page of the theme.
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Choice label="Body style" value={f.category || ''} onChange={(v) => setF({ category: v })} options={CATEGORIES} />
            <Field label="Make (optional)">
              <Input value={f.make || ''} onChange={(e) => setF({ make: e.target.value })} placeholder="e.g. Toyota" />
            </Field>
            <Field label="Lowest price">
              <Input type="number" value={f.minPrice || ''} onChange={(e) => setF({ minPrice: e.target.value })} />
            </Field>
            <Field label="Highest price">
              <Input type="number" value={f.maxPrice || ''} onChange={(e) => setF({ maxPrice: e.target.value })} />
            </Field>
            <Choice
              label="Order"
              value={f.sort || ''}
              onChange={(v) => setF({ sort: v })}
              options={[['', 'Newest first'], ['price_asc', 'Price: low → high'], ['price_desc', 'Price: high → low'], ['year_desc', 'Year: newest'], ['mileage_asc', 'Lowest mileage']]}
            />
            <Field label="How many">
              <Input type="number" min={1} max={48} value={s.limit ?? 6} onChange={(e) => set({ limit: Number(e.target.value) })} />
            </Field>
            <Choice label="Per row" value={String(s.columns || 3)} onChange={(v) => set({ columns: Number(v) })} options={[['2', '2'], ['3', '3'], ['4', '4']]} />
          </div>
          <Toggle checked={!!f.featured} onChange={(v) => setF({ featured: v })} label="Only featured vehicles" />
          <Toggle checked={s.showButton !== false} onChange={(v) => set({ showButton: v })} label='"View all" button' desc="Opens the theme's inventory (or the body style page)." />
          {s.showButton !== false && <Txt s={s} k="buttonLabel" set={set} label="Button text" />}
          <Txt s={s} k="emptyText" set={set} label="Text when no vehicle matches (optional)" />
        </>
      );
    }
    case 'cta':
      return (
        <>
          <Txt s={s} k="title" set={set} label="Heading" />
          <Area s={s} k="text" set={set} label="Text" rows={2} />
          <Buttons s={s} set={set} />
        </>
      );
    case 'stats':
      return (
        <>
          <Txt s={s} k="title" set={set} label="Heading (optional)" />
          <Items s={s} set={set} addLabel="Add number" blank={{ value: '100+', label: 'Label' }} fields={[{ k: 'value', label: 'Number' }, { k: 'label', label: 'Label' }]} max={6} />
        </>
      );
    case 'testimonials':
      return (
        <>
          <Txt s={s} k="title" set={set} label="Heading" />
          <Items
            s={s}
            set={set}
            addLabel="Add review"
            blank={{ quote: '', name: '' }}
            fields={[{ k: 'quote', label: 'Review', kind: 'area' }, { k: 'name', label: 'Name' }, { k: 'detail', label: 'Detail (e.g. the car they bought)' }]}
            max={9}
          />
        </>
      );
    case 'faq':
      return (
        <>
          <Txt s={s} k="title" set={set} label="Heading" />
          <Items s={s} set={set} addLabel="Add question" blank={{ q: '', a: '' }} fields={[{ k: 'q', label: 'Question' }, { k: 'a', label: 'Answer', kind: 'area' }]} max={30} />
        </>
      );
    case 'gallery':
      return (
        <>
          <Txt s={s} k="title" set={set} label="Heading (optional)" />
          <Choice label="Pictures per row" value={String(s.columns || 3)} onChange={(v) => set({ columns: Number(v) })} options={[['2', '2'], ['3', '3'], ['4', '4']]} />
          <Gallery s={s} set={set} />
        </>
      );
    case 'form':
      return (
        <>
          <Heading s={s} set={set} intro={false} />
          <Area s={s} k="text" set={set} label="Text next to the form" rows={3} />
          <Txt s={s} k="topic" set={set} label="Subject of the inquiry" hint="Shown in Leads & inquiries, e.g. “Financing request”." />
          <Txt s={s} k="buttonLabel" set={set} label="Button text" />
          <Toggle checked={s.showPhone !== false} onChange={(v) => set({ showPhone: v })} label="Ask for a phone number" />
        </>
      );
    case 'map':
      return (
        <>
          <Heading s={s} set={set} intro={false} />
          <Area s={s} k="text" set={set} label="Text (optional)" rows={2} />
          <p className="text-xs text-slate-500">Address, phone, email and hours come from the dealership&apos;s Business details.</p>
          <Buttons s={s} set={set} />
        </>
      );
    case 'html':
      return <Area s={s} k="html" set={set} label="HTML / embed code" rows={10} mono hint="Shown as-is on the website. Only paste code from sources you trust." />;
    case 'spacer':
      return (
        <>
          <Choice label="Size" value={s.size || 'm'} onChange={(v) => set({ size: v })} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} />
          <Toggle checked={!!s.line} onChange={(v) => set({ line: v })} label="Show a line" />
        </>
      );
  }
  return <p className="text-sm text-slate-500">This section type is not known.</p>;
}

/** a short line shown on a closed section */
function summary(s: Section) {
  const t = String(s.title || s.eyebrow || s.text || s.subtitle || s.body || '').replace(/[*#\[\]]/g, '').trim();
  if (s.type === 'inventory') {
    const f = (s.filter || {}) as Record<string, string>;
    return [f.category || 'all vehicles', f.make, f.featured ? 'featured' : '', `${s.limit || 6} cars`].filter(Boolean).join(' · ');
  }
  return t.slice(0, 60);
}

/* ───────────────────────── one section card ───────────────────────── */

export function SectionCard({
  s,
  index,
  count,
  open,
  onToggle,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  onAddBelow,
}: {
  s: Section;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onChange: (s: Section) => void;
  onMove: (d: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddBelow: () => void;
}) {
  const def = DEF[s.type];
  const set: SetFn = (patch) => onChange({ ...s, ...patch });
  return (
    <div className={cx('rounded-xl border bg-white shadow-sm transition', open ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-200')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-base">{def?.icon || '▫️'}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">
              {index + 1}. {def?.label || s.type}
            </span>
            <span className="block truncate text-xs text-slate-500">{summary(s) || '—'}</span>
          </span>
          <ChevronDown className={cx('ml-auto h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />
        </button>
        <div className="flex shrink-0 items-center text-slate-400">
          <button type="button" title="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded p-1 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="rounded p-1 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" title="Duplicate" onClick={onDuplicate} className="rounded p-1 hover:bg-slate-100 hover:text-slate-800">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" title="Delete" onClick={onDelete} className="rounded p-1 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 py-4">
          <Fields s={s} set={set} />
          {s.type !== 'spacer' && s.type !== 'header' && (
            <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
              <Choice label="Background" value={s.tone || ''} onChange={(v) => set({ tone: v })} options={TONES} />
              <Choice label="Space above & below" value={s.pad || 'm'} onChange={(v) => set({ pad: v })} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['none', 'None']]} />
            </div>
          )}
          <Field label="Jump link name (optional)" hint={`Buttons can scroll here with “#${s.anchor || 'name'}”. Without a name: #pa-s-${index}.`}>
            <Input value={s.anchor || ''} onChange={(e) => set({ anchor: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="e.g. apply" />
          </Field>
          <button type="button" onClick={onAddBelow} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-500 hover:border-blue-500 hover:text-blue-700">
            <Plus className="h-3.5 w-3.5" /> Add a section below
          </button>
        </div>
      )}
    </div>
  );
}

export const cloneSection = (s: Section): Section => ({ ...JSON.parse(JSON.stringify(s)), id: newId() });
