'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Brush,
  CheckCircle2,
  Clock,
  FilePlus2,
  LayoutTemplate,
  Link2,
  Mail,
  MessageCircle,
  Monitor,
  Moon,
  Palette,
  PanelTop,
  Phone,
  Plus,
  Send,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Field, Input, Select, Spinner, Textarea, cx } from '@/components/ui';

/* ─────────── Dealer Portal › Design & colours › "Add Pages" and "Add Custom Design / Theme" ─────────── */

type Category = 'ADD_PAGE' | 'CUSTOM_THEME';
type Status = 'NEW' | 'IN_REVIEW' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
type Contact = 'PORTAL' | 'EMAIL' | 'PHONE';

type DesignRequest = {
  id: string;
  requestCategory: Category;
  designAreas: string[];
  pageSlug: string;
  layoutStyle: string;
  requestedSections: string[];
  title: string;
  targetPage: string;
  description: string;
  status: Status;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
};

type Data = {
  items: DesignRequest[];
  support: { email: string; phone: string; note: string };
  contact: { email: string; phone: string };
};

export const STATUS: Record<Status, { label: string; color: string; step: number }> = {
  NEW: { label: 'New', color: 'blue', step: 1 },
  IN_REVIEW: { label: 'In review', color: 'amber', step: 2 },
  IN_PROGRESS: { label: 'In progress', color: 'violet', step: 3 },
  COMPLETED: { label: 'Completed', color: 'green', step: 4 },
  DECLINED: { label: 'Declined', color: 'red', step: 0 },
};

export const LAYOUTS = [
  { id: 'CLEAN_INFO', label: 'Clean informational', desc: 'Easy-to-read text and pictures' },
  { id: 'LEAD_FOCUSED', label: 'Conversion / lead-focused', desc: 'Built around a form or call to action' },
  { id: 'MEDIA_GALLERY', label: 'Media & gallery heavy', desc: 'Big photos, galleries and video' },
  { id: 'MATCH_SITE', label: 'Match my existing site', desc: 'Same look as the rest of your website' },
];

export const SECTIONS = ['Hero Banner', 'Image + Text Blocks', 'Interactive Form / Lead Capture', 'FAQ Accordion', 'Testimonials / Reviews', 'Pricing / Packages Cards', 'Video Embed', 'Location / Hours Map'];

const PAGE_IDEAS = ['Service Department', 'Warranty & Protection', 'Customer Reviews', 'Meet Our Team', 'Custom Landing Page'];

export const AREAS: { id: string; label: string; desc: string; Icon: React.ElementType }[] = [
  { id: 'FULL_THEME', label: 'Full custom theme', desc: 'A bespoke website design made for your brand', Icon: Sparkles },
  { id: 'NEW_SECTION', label: 'Add new section to an existing page', desc: 'A new block on Home, Inventory, About…', Icon: LayoutTemplate },
  { id: 'COLORS_TYPOGRAPHY', label: 'Colour scheme & typography', desc: 'Brand colours, light / dark look, fonts', Icon: Palette },
  { id: 'HEADER_FOOTER', label: 'Header / navigation / footer redesign', desc: 'Logo area, menu, footer layout', Icon: PanelTop },
  { id: 'WIDGET_BANNER', label: 'Custom interactive widget / banner', desc: 'Promo banner, trust badges, video showcase…', Icon: Brush },
];

const TARGET_PAGES = ['Home page', 'Inventory page', 'Vehicle detail page', 'About page', 'Contact page', 'Every page'];
const FONTS = ['Modern sans-serif', 'Classic serif', 'Bold / condensed', 'Friendly rounded', 'Match my logo'];

const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const telHref = (p: string) => 'tel:' + p.replace(/[^\d+]/g, '');
const waHref = (p: string) => 'https://wa.me/' + p.replace(/\D/g, '');
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

/* ───────────────── sub-menu ───────────────── */

const TABS = [
  { href: '/dealer/design', label: 'Theme & colours', Icon: Palette },
  { href: '/dealer/design/pages', label: 'Add Pages', Icon: FilePlus2 },
  { href: '/dealer/design/custom', label: 'Add Custom Design / Theme', Icon: Sparkles },
];

/** Design & colours › Theme & colours | Add Pages | Add Custom Design / Theme */
export function DesignSubNav({ className }: { className?: string }) {
  const pathname = usePathname() || '';
  return (
    <nav aria-label="Design & colours" className={cx('flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/70 p-1', className)}>
      {TABS.map((t) => {
        const on = t.href === '/dealer/design' ? pathname === '/dealer/design' : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm',
              on ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
            )}
          >
            <t.Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* ───────────────── page ───────────────── */

export function DesignRequests({ mode }: { mode: 'pages' | 'custom' }) {
  const { data, loading, error, reload } = useApi<Data>('/dealer/design-requests');

  // see the team's replies without reloading the page
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  return (
    <div className="space-y-6">
      <div>
        <DesignSubNav />
        <div className="mt-5">
          <div className={cx('text-xs font-bold uppercase tracking-wider', mode === 'pages' ? 'text-blue-700' : 'text-emerald-700')}>Design & colours</div>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-slate-900">{mode === 'pages' ? 'Add a new page' : 'Add a custom design / theme'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {mode === 'pages'
              ? 'Ask for a brand-new page on your website — a service department, warranty info, reviews, your team or a landing page. We build it and let you know when it is live.'
              : 'Ask for a bespoke theme for your brand, a new section on an existing page, new colours and fonts, or a redesigned header, menu or footer.'}
          </p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {mode === 'pages' ? <PageForm data={data} onSent={reload} /> : <CustomForm data={data} onSent={reload} />}
        <aside className="space-y-4">
          <SupportCard data={data} loading={loading} />
          <HowItWorks />
        </aside>
      </div>

      <MyRequests data={data} loading={loading} error={error} highlight={mode === 'pages' ? 'ADD_PAGE' : 'CUSTOM_THEME'} />
    </div>
  );
}

/* ───────────────── contact preference (both forms) ───────────────── */

type ContactState = { pref: Contact; email: string; phone: string };

function useContact(data: Data | null) {
  const [contact, setContact] = useState<ContactState>({ pref: 'PORTAL', email: '', phone: '' });
  useEffect(() => {
    if (data?.contact) setContact((c) => ({ ...c, email: c.email || data.contact.email, phone: c.phone || data.contact.phone }));
  }, [data?.contact]);
  return [contact, setContact] as const;
}

function ContactFields({ contact, setContact }: { contact: ContactState; setContact: (c: ContactState) => void }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Preferred contact method</div>
      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-1">
        {(
          [
            ['PORTAL', 'Here in the portal', MessageCircle],
            ['EMAIL', 'Email', Mail],
            ['PHONE', 'Phone call', Phone],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            onClick={() => setContact({ ...contact, pref: v })}
            className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition', contact.pref === v ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900')}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <Field label={<>Email{contact.pref === 'EMAIL' && <span className="text-red-600"> *</span>}</>}>
          <Input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} maxLength={160} placeholder="you@dealership.com" />
        </Field>
        <Field label={<>Phone{contact.pref === 'PHONE' && <span className="text-red-600"> *</span>}</>}>
          <Input type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} maxLength={40} placeholder="+1 555 123 4567" />
        </Field>
      </div>
    </div>
  );
}

function SubmitBar({ sending, error, label }: { sending: boolean; error: string; label: string }) {
  return (
    <>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <span className="text-xs text-slate-500">You will see the team&apos;s reply and progress under My requests.</span>
        <Button type="submit" loading={sending}>
          <Send className="h-4 w-4" /> {label}
        </Button>
      </div>
    </>
  );
}

/* ───────────────── Add Pages ───────────────── */

const EMPTY_PAGE = { title: '', slug: '', slugEdited: false, layoutStyle: 'MATCH_SITE', sections: ['Hero Banner'] as string[], custom: '', contentNotes: '', referenceUrl: '' };

function PageForm({ data, onSent }: { data: Data | null; onSent: () => Promise<void> | void }) {
  const toast = useToast();
  const [f, setF] = useState(EMPTY_PAGE);
  const [contact, setContact] = useContact(data);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const setTitle = (title: string) => setF((x) => ({ ...x, title, slug: x.slugEdited ? x.slug : slugify(title) }));
  const toggle = (s: string) => setF((x) => ({ ...x, sections: x.sections.includes(s) ? x.sections.filter((y) => y !== s) : [...x.sections, s] }));
  const addCustom = () => {
    const v = f.custom.trim().slice(0, 60);
    if (!v) return;
    setF((x) => ({ ...x, custom: '', sections: x.sections.some((y) => y.toLowerCase() === v.toLowerCase()) ? x.sections : [...x.sections, v] }));
  };
  const customs = f.sections.filter((s) => !SECTIONS.includes(s));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (f.title.trim().length < 3) return setErr('Enter the page title, e.g. "Service Department".');
    if (!f.sections.length) return setErr('Tick at least one section the page should have.');
    if (f.contentNotes.trim().length < 10) return setErr('Tell us what the page should say in "Page content & copy notes".');
    setSending(true);
    try {
      await api('/dealer/design-requests', {
        method: 'POST',
        body: {
          requestCategory: 'ADD_PAGE',
          title: f.title,
          pageSlug: f.slug,
          layoutStyle: f.layoutStyle,
          requestedSections: f.sections,
          contentNotes: f.contentNotes,
          referenceUrl: f.referenceUrl,
          contactPreference: contact.pref,
          contactEmail: contact.email,
          contactPhone: contact.phone,
        },
      });
      toast.ok('Page request sent — the platform team will review it and reply here.');
      setF(EMPTY_PAGE);
      await onSent();
    } catch (er) {
      toast.error((er as Error).message);
      setErr((er as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-2xl border border-slate-200 border-t-4 border-t-blue-500 bg-white p-5 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Field
          label={
            <>
              Page title <span className="text-red-600">*</span>
            </>
          }
          hint={
            <span className="flex flex-wrap gap-1.5">
              {PAGE_IDEAS.map((x) => (
                <button key={x} type="button" onClick={() => setTitle(x)} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100">
                  {x}
                </button>
              ))}
            </span>
          }
        >
          <Input value={f.title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Service Department" />
        </Field>
        <Field label="Page address (slug idea)" hint="Where the page will live on your website.">
          <div className="flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <span className="pl-3 font-mono text-sm text-slate-400">/</span>
            <input
              value={f.slug}
              onChange={(e) => setF({ ...f, slug: slugify(e.target.value) || e.target.value.toLowerCase().slice(0, 60), slugEdited: true })}
              maxLength={60}
              placeholder="service-department"
              className="w-full rounded-lg bg-transparent px-1 py-2 font-mono text-sm outline-none"
            />
          </div>
        </Field>
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Page style / layout <span className="text-red-600">*</span>
        </div>
        <div role="radiogroup" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {LAYOUTS.map((l) => {
            const on = f.layoutStyle === l.id;
            return (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setF({ ...f, layoutStyle: l.id })}
                className={cx('rounded-xl border px-3 py-2.5 text-left transition', on ? 'border-blue-600 bg-blue-50/70 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')}
              >
                <b className="block text-sm text-slate-900">{l.label}</b>
                <span className="text-xs text-slate-500">{l.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sections needed inside this page <span className="text-red-600">*</span>
          </span>
          <span className="text-xs text-slate-500">{f.sections.length} selected</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SECTIONS.map((s) => {
            const on = f.sections.includes(s);
            return (
              <label key={s} className={cx('flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition', on ? 'border-blue-500 bg-blue-50/60 text-slate-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}>
                <input type="checkbox" checked={on} onChange={() => toggle(s)} className="h-4 w-4 rounded border-slate-300 accent-blue-600" />
                {s}
              </label>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {customs.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-blue-600 py-1 pl-3 pr-1.5 text-xs font-semibold text-white">
              {s}
              <button type="button" onClick={() => toggle(s)} aria-label={`Remove ${s}`} className="rounded-full p-0.5 hover:bg-white/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <div className="flex min-w-[240px] flex-1 gap-2">
            <Input
              value={f.custom}
              onChange={(e) => setF({ ...f, custom: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              maxLength={60}
              placeholder="Another section, e.g. Financing calculator"
            />
            <Button type="button" variant="secondary" onClick={addCustom} disabled={!f.custom.trim()}>
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>
        </div>
      </div>

      <Field
        label={
          <>
            Page content & copy notes <span className="text-red-600">*</span>
          </>
        }
        hint="Headlines, text, services, prices, opening hours — anything that should be on the page."
      >
        <Textarea rows={6} value={f.contentNotes} onChange={(e) => setF({ ...f, contentNotes: e.target.value })} maxLength={5000} placeholder="e.g. Headline: Expert service for every make. List: oil change $39, brakes from $149, tyres… Opening hours Mon–Sat 8–6. A 'Book a service' form that sends to our service desk." />
      </Field>

      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> Reference URL <span className="font-normal text-slate-400">(optional)</span>
          </span>
        }
        hint="A page you like the look of."
      >
        <Input type="url" value={f.referenceUrl} onChange={(e) => setF({ ...f, referenceUrl: e.target.value })} maxLength={500} placeholder="https://" />
      </Field>

      <ContactFields contact={contact} setContact={setContact} />
      <SubmitBar sending={sending} error={err} label="Request this page" />
    </form>
  );
}

/* ───────────────── Add Custom Design / Theme ───────────────── */

const EMPTY_CUSTOM = { areas: ['FULL_THEME'] as string[], targetPage: TARGET_PAGES[0], otherTarget: '', title: '', description: '', referenceUrl: '', primary: '#1D4ED8', accent: '#F59E0B', mode: 'either', font: '' };

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <Field label={label}>
      <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
        <input type="color" value={valid ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={`${label} picker`} />
        <input value={value} onChange={(e) => onChange(e.target.value.trim().slice(0, 7))} className="w-full bg-transparent font-mono text-sm uppercase outline-none" placeholder="#1D4ED8" />
      </div>
    </Field>
  );
}

function CustomForm({ data, onSent }: { data: Data | null; onSent: () => Promise<void> | void }) {
  const toast = useToast();
  const [f, setF] = useState(EMPTY_CUSTOM);
  const [contact, setContact] = useContact(data);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const has = (a: string) => f.areas.includes(a);
  const toggle = (a: string) => setF((x) => ({ ...x, areas: x.areas.includes(a) ? x.areas.filter((y) => y !== a) : [...x.areas, a] }));
  const target = f.targetPage === '__other' ? f.otherTarget : f.targetPage;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!f.areas.length) return setErr('Choose what you would like to customize.');
    if (f.title.trim().length < 3) return setErr('Give your request a short title / summary.');
    if (f.description.trim().length < 10) return setErr('Describe what you want in the design brief.');
    if (has('NEW_SECTION') && !target.trim()) return setErr('Choose the page the new section should go on.');
    setSending(true);
    try {
      await api('/dealer/design-requests', {
        method: 'POST',
        body: {
          requestCategory: 'CUSTOM_THEME',
          designAreas: f.areas,
          title: f.title,
          targetPage: has('NEW_SECTION') ? target : '',
          description: f.description,
          colorPreferences: has('COLORS_TYPOGRAPHY') ? { primary: f.primary, accent: f.accent, mode: f.mode, font: f.font } : undefined,
          referenceUrl: f.referenceUrl,
          contactPreference: contact.pref,
          contactEmail: contact.email,
          contactPhone: contact.phone,
        },
      });
      toast.ok('Design request sent — the platform team will review it and reply here.');
      setF(EMPTY_CUSTOM);
      await onSent();
    } catch (er) {
      toast.error((er as Error).message);
      setErr((er as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-2xl border border-slate-200 border-t-4 border-t-emerald-500 bg-white p-5 shadow-sm">
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            What would you like to customize? <span className="text-red-600">*</span>
          </span>
          <span className="text-xs text-slate-500">Choose one or more</span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {AREAS.map((a) => {
            const on = has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(a.id)}
                className={cx('flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition', on ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50', a.id === 'FULL_THEME' && 'sm:col-span-2')}
              >
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600')}>
                  <a.Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-sm text-slate-900">{a.label}</b>
                  <span className="text-xs text-slate-500">{a.desc}</span>
                </span>
                <span className={cx('mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300')}>{on && <CheckCircle2 className="h-3 w-3" />}</span>
              </button>
            );
          })}
        </div>
      </div>

      {has('NEW_SECTION') && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
          <Field label="Which page should the new section go on?">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Select value={f.targetPage} onChange={(e) => setF({ ...f, targetPage: e.target.value })}>
                {TARGET_PAGES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
                <option value="__other">Another page…</option>
              </Select>
              {f.targetPage === '__other' && <Input value={f.otherTarget} onChange={(e) => setF({ ...f, otherTarget: e.target.value })} maxLength={120} placeholder="Which page?" />}
            </div>
          </Field>
        </div>
      )}

      {has('COLORS_TYPOGRAPHY') && (
        <div className="space-y-4 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorInput label="Primary colour" value={f.primary} onChange={(v) => setF({ ...f, primary: v })} />
            <ColorInput label="Accent colour" value={f.accent} onChange={(v) => setF({ ...f, accent: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Light or dark look</div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
                {(
                  [
                    ['light', 'Light', Sun],
                    ['dark', 'Dark', Moon],
                    ['either', 'Either', Monitor],
                  ] as const
                ).map(([v, l, Icon]) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, mode: v })} className={cx('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium', f.mode === v ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-slate-900')}>
                    <Icon className="h-3.5 w-3.5" /> {l}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Font style">
              <Input list="pa-font-styles" value={f.font} onChange={(e) => setF({ ...f, font: e.target.value })} maxLength={60} placeholder="e.g. Modern sans-serif" />
              <datalist id="pa-font-styles">
                {FONTS.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
          </div>
        </div>
      )}

      <Field
        label={
          <>
            Title / summary <span className="text-red-600">*</span>
          </>
        }
      >
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} placeholder="e.g. Premium dark theme with our red brand colour" />
      </Field>

      <Field
        label={
          <>
            Target pages & detailed design brief <span className="text-red-600">*</span>
          </>
        }
        hint="Which pages, layout, colours, animations, how a section should behave — the more the better."
      >
        <Textarea rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} placeholder="e.g. Home page: full-width video of our lot at the top, then featured trucks in a slider. Trust badges (BBB, CarFax) under the hero. Footer with our three locations…" />
      </Field>

      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5" /> Reference / inspiration URLs <span className="font-normal text-slate-400">(optional)</span>
          </span>
        }
        hint="One link per line, up to 5."
      >
        <Textarea rows={3} value={f.referenceUrl} onChange={(e) => setF({ ...f, referenceUrl: e.target.value })} maxLength={2600} placeholder={'https://\nhttps://'} className="font-mono text-[13px]" />
      </Field>

      <ContactFields contact={contact} setContact={setContact} />
      <SubmitBar sending={sending} error={err} label="Send design request" />
    </form>
  );
}

/* ───────────────── side cards ───────────────── */

function SupportCard({ data, loading }: { data: Data | null; loading: boolean }) {
  const support = data?.support;
  return (
    <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-amber-300" /> Need to discuss directly?
      </div>
      <p className="mt-1 text-sm text-slate-300">{support?.note || 'Talk to the platform team about your idea — we are happy to help you plan it.'}</p>
      <div className="mt-4 space-y-2">
        {support?.email && (
          <a href={`mailto:${support.email}?subject=${encodeURIComponent('Website request')}`} className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-medium hover:bg-white/15">
            <Mail className="h-4 w-4 text-blue-300" /> <span className="truncate">{support.email}</span>
          </a>
        )}
        {support?.phone && (
          <>
            <a href={telHref(support.phone)} className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-medium hover:bg-white/15">
              <Phone className="h-4 w-4 text-emerald-300" /> {support.phone}
            </a>
            <a href={waHref(support.phone)} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl bg-emerald-500/90 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
              <MessageCircle className="h-4 w-4" /> Message on WhatsApp
            </a>
          </>
        )}
        {data && !support?.email && !support?.phone && <p className="rounded-xl bg-white/10 px-3 py-2.5 text-xs text-slate-300">Send a request with the form — the team replies here.</p>}
        {!data && loading && <Spinner className="h-4 w-4" />}
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
      <div className="font-semibold text-slate-900">How it works</div>
      <ol className="mt-3 space-y-3 text-slate-600">
        {[
          ['Send your request', 'Describe what you would like added.'],
          ['We review it', 'The team checks it and may ask questions.'],
          ['We build it', 'You can follow the progress below.'],
          ['It goes live', 'Your website is updated — nothing to install.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{i + 1}</span>
            <span>
              <b className="block text-slate-800">{t}</b>
              <span className="text-xs">{d}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ───────────────── My requests (both views) ───────────────── */

function MyRequests({ data, loading, error, highlight }: { data: Data | null; loading: boolean; error: string; highlight: Category }) {
  const [show, setShow] = useState<'all' | Category>('all');
  const all = data?.items || [];
  const items = show === 'all' ? all : all.filter((r) => r.requestCategory === show);
  const count = (c: Category) => all.filter((r) => r.requestCategory === c).length;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="font-semibold text-slate-900">My requests</div>
          <div className="text-xs text-slate-500">Status and replies from the platform team.</div>
        </div>
        <div className="flex items-center gap-1.5">
          {loading && data && <Spinner className="h-4 w-4 text-slate-400" />}
          {(
            [
              ['all', `All (${all.length})`, ''],
              ['ADD_PAGE', `Pages (${count('ADD_PAGE')})`, 'blue'],
              ['CUSTOM_THEME', `Custom design (${count('CUSTOM_THEME')})`, 'green'],
            ] as const
          ).map(([v, l, c]) => (
            <button
              key={v}
              onClick={() => setShow(v)}
              className={cx(
                'rounded-full px-3 py-1 text-xs font-semibold transition',
                show === v ? (c === 'blue' ? 'bg-blue-600 text-white' : c === 'green' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                v === highlight && show !== v && 'ring-1 ring-inset ring-slate-300',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="px-5 py-4 text-sm text-red-700">{error}</p>}
      {!error && !items.length && <div className="px-5 py-10 text-center text-sm text-slate-500">{loading ? 'Loading…' : 'No requests yet — your requests and their progress will show here.'}</div>}
      <ul className="divide-y divide-slate-100">
        {items.map((r) => {
          const st = STATUS[r.status] || STATUS.NEW;
          const page = r.requestCategory === 'ADD_PAGE';
          return (
            <li key={r.id} className={cx('border-l-4 px-5 py-4', page ? 'border-l-blue-500' : 'border-l-emerald-500')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-slate-900">{r.title}</b>
                    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', page ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700')}>{page ? 'Add Page' : 'Custom Theme'}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {page && r.pageSlug && <span className="font-mono">/{r.pageSlug} · </span>}
                    {!page && r.designAreas?.length > 0 && <>{r.designAreas.map((a) => AREAS.find((x) => x.id === a)?.label || a).join(', ')} · </>}
                    Sent {fmtDate(r.createdAt)}
                    {r.updatedAt !== r.createdAt && <> · Updated {fmtDate(r.updatedAt)}</>}
                  </div>
                </div>
                <Badge color={st.color}>
                  {r.status === 'COMPLETED' ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />} {st.label}
                </Badge>
              </div>
              {st.step > 0 && (
                <div className="mt-3 flex max-w-md gap-1.5" aria-label={`Step ${st.step} of 4`}>
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={cx('h-1.5 flex-1 rounded-full', n <= st.step ? (st.step === 4 ? 'bg-emerald-500' : page ? 'bg-blue-600' : 'bg-emerald-600') : 'bg-slate-200')} />
                  ))}
                </div>
              )}
              {r.adminNotes && (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm text-slate-700">
                  <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-700">Reply from the team</div>
                  <p className="whitespace-pre-line">{r.adminNotes}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
