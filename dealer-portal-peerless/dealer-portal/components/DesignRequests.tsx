'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileText, LayoutTemplate, Link2, Mail, MessageCircle, Palette, Phone, Send, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Field, Input, Select, Spinner, Textarea, cx } from '@/components/ui';

/* ───────────────── Dealer Portal › Design & colours › "Request extra page or section" ───────────────── */

type RequestType = 'EXTRA_PAGE' | 'EXTRA_SECTION' | 'DESIGN_CHANGE';
type Status = 'NEW' | 'IN_REVIEW' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
type Contact = 'PORTAL' | 'EMAIL' | 'PHONE';

type DesignRequest = {
  id: string;
  requestType: RequestType;
  title: string;
  targetPage: string;
  description: string;
  referenceUrl: string;
  contactPreference: Contact;
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

const TYPES: { id: RequestType; label: string; desc: string; Icon: React.ElementType; examples: string[] }[] = [
  { id: 'EXTRA_PAGE', label: 'Extra page', desc: 'A new page in your menu', Icon: FileText, examples: ['Service department', 'Customer reviews', 'Warranty', 'Custom landing page'] },
  { id: 'EXTRA_SECTION', label: 'Extra section', desc: 'A new block on an existing page', Icon: LayoutTemplate, examples: ['Video banner', 'Testimonials', 'FAQ', 'Custom promo block'] },
  { id: 'DESIGN_CHANGE', label: 'Design change', desc: 'Change how something looks', Icon: Palette, examples: ['Header layout', 'Fonts', 'Footer', 'Mobile menu'] },
];

const TARGETS: Record<RequestType, string[]> = {
  EXTRA_PAGE: ['New navigation page', 'Under an existing menu item', 'Footer link only'],
  EXTRA_SECTION: ['Home page', 'Inventory page', 'Vehicle detail page', 'About page', 'Contact page', 'Every page'],
  DESIGN_CHANGE: ['Whole website', 'Home page', 'Inventory page', 'Vehicle detail page', 'Header & menu', 'Footer'],
};

export const STATUS: Record<Status, { label: string; color: string; step: number }> = {
  NEW: { label: 'New', color: 'blue', step: 1 },
  IN_REVIEW: { label: 'In review', color: 'amber', step: 2 },
  IN_PROGRESS: { label: 'In progress', color: 'violet', step: 3 },
  COMPLETED: { label: 'Completed', color: 'green', step: 4 },
  DECLINED: { label: 'Declined', color: 'red', step: 0 },
};

const typeLabel = (t: RequestType) => TYPES.find((x) => x.id === t)?.label || t;
const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const telHref = (p: string) => 'tel:' + p.replace(/[^\d+]/g, '');
const waHref = (p: string) => 'https://wa.me/' + p.replace(/\D/g, '');

const EMPTY = { requestType: 'EXTRA_PAGE' as RequestType, title: '', targetPage: TARGETS.EXTRA_PAGE[0], otherTarget: '', description: '', referenceUrl: '' };

export function DesignRequests({ id = 'design-requests' }: { id?: string }) {
  const { data, loading, error, reload } = useApi<Data>('/dealer/design-requests');
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [contact, setContact] = useState<{ pref: Contact; email: string; phone: string }>({ pref: 'PORTAL', email: '', phone: '' });
  const [sending, setSending] = useState(false);
  const [fieldError, setFieldError] = useState('');

  // pre-fill the dealer's email / phone once
  useEffect(() => {
    if (data?.contact) setContact((c) => ({ ...c, email: c.email || data.contact.email, phone: c.phone || data.contact.phone }));
  }, [data?.contact]);

  // see the team's replies without reloading the page
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const type = TYPES.find((t) => t.id === f.requestType)!;
  const target = f.targetPage === '__other' ? f.otherTarget : f.targetPage;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError('');
    if (f.title.trim().length < 3) return setFieldError('Give your request a short title.');
    if (f.description.trim().length < 10) return setFieldError('Tell us a little more in "Details & requirements".');
    setSending(true);
    try {
      await api('/dealer/design-requests', {
        method: 'POST',
        body: {
          requestType: f.requestType,
          title: f.title,
          targetPage: target,
          description: f.description,
          referenceUrl: f.referenceUrl,
          contactPreference: contact.pref,
          contactEmail: contact.email,
          contactPhone: contact.phone,
        },
      });
      toast.ok('Request sent — the platform team will review it and reply here.');
      setF({ ...EMPTY, requestType: f.requestType, targetPage: TARGETS[f.requestType][0] });
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const support = data?.support;
  const items = data?.items || [];

  return (
    <section id={id} className="scroll-mt-6 space-y-5">
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Need something more?</div>
        <h2 className="mt-1 font-heading text-xl font-extrabold text-slate-900">Request an extra page or section</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Tell the platform team what you would like added to your website. We review every request, reply here and let you know when it is live.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------------- request form ---------------- */}
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <div className="mb-2 text-sm font-semibold text-slate-800">What do you need?</div>
            <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
              {TYPES.map((t) => {
                const on = t.id === f.requestType;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setF({ ...f, requestType: t.id, targetPage: TARGETS[t.id][0] })}
                    className={cx(
                      'flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition',
                      on ? 'border-blue-600 bg-blue-50/60 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}>
                      <t.Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <b className="block text-sm text-slate-900">{t.label}</b>
                      <span className="text-xs text-slate-500">{t.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={`${type.label === 'Design change' ? 'Change' : type.label.replace('Extra ', '')} title`} hint={<span className="flex flex-wrap gap-1.5">{type.examples.map((x) => (
              <button key={x} type="button" onClick={() => setF({ ...f, title: x + (f.requestType === 'EXTRA_PAGE' ? ' page' : f.requestType === 'EXTRA_SECTION' ? ' section' : '') })} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200">
                {x}
              </button>
            ))}</span>}>
              <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} placeholder={f.requestType === 'EXTRA_SECTION' ? 'e.g. Customer testimonials section' : f.requestType === 'EXTRA_PAGE' ? 'e.g. Service department page' : 'e.g. Bigger logo in the header'} />
            </Field>
            <Field label="Where should it go?">
              <Select value={f.targetPage} onChange={(e) => setF({ ...f, targetPage: e.target.value })}>
                {TARGETS[f.requestType].map((t) => (
                  <option key={t}>{t}</option>
                ))}
                <option value="__other">Somewhere else…</option>
              </Select>
              {f.targetPage === '__other' && <Input className="mt-2" value={f.otherTarget} onChange={(e) => setF({ ...f, otherTarget: e.target.value })} maxLength={120} placeholder="Which page or place?" />}
            </Field>
          </div>

          <Field label="Details & requirements" hint="What should it say or show? Layout, photos, colours, buttons — anything that helps.">
            <Textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} placeholder="e.g. A page for our service department with opening hours, a list of services with prices, a photo of the shop and a 'Book a service' button that opens a form." />
          </Field>

          <Field label={<span className="inline-flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Reference link <span className="font-normal text-slate-400">(optional)</span></span>} hint="A website or page you like the look of.">
            <Input type="url" value={f.referenceUrl} onChange={(e) => setF({ ...f, referenceUrl: e.target.value })} maxLength={500} placeholder="https://" />
          </Field>

          <div>
            <div className="mb-2 text-sm font-semibold text-slate-800">How should we get back to you?</div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
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

          {fieldError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{fieldError}</p>}
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <span className="text-xs text-slate-500">You will see the team&apos;s reply and progress below.</span>
            <Button type="submit" loading={sending}>
              <Send className="h-4 w-4" /> Submit request
            </Button>
          </div>
        </form>

        {/* ---------------- direct contact ---------------- */}
        <aside className="space-y-4">
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
        </aside>
      </div>

      {/* ---------------- my requests ---------------- */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div className="font-semibold text-slate-900">My requests</div>
            <div className="text-xs text-slate-500">Status and replies from the platform team.</div>
          </div>
          {loading && data && <Spinner className="h-4 w-4 text-slate-400" />}
        </div>
        {error && <p className="px-5 py-4 text-sm text-red-700">{error}</p>}
        {!error && !items.length && (
          <div className="px-5 py-10 text-center text-sm text-slate-500">{loading ? 'Loading…' : 'No requests yet — your requests and their progress will show here.'}</div>
        )}
        <ul className="divide-y divide-slate-100">
          {items.map((r) => {
            const st = STATUS[r.status] || STATUS.NEW;
            return (
              <li key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="text-slate-900">{r.title}</b>
                      <Badge color="slate">{typeLabel(r.requestType)}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {r.targetPage && <>{r.targetPage} · </>}Sent {fmtDate(r.createdAt)}
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
                      <span key={n} className={cx('h-1.5 flex-1 rounded-full', n <= st.step ? (st.step === 4 ? 'bg-emerald-500' : 'bg-blue-600') : 'bg-slate-200')} />
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
    </section>
  );
}
