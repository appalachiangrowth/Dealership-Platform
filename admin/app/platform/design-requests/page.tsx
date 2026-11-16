'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink, FilePlus2, Globe, Mail, MessageCircle, Phone, Search, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Empty, Field, Input, Loading, PageHeader, Pagination, Select, Table, Td, Textarea, cx } from '@/components/ui';
import { ago, dateTime } from '@/lib/format';

/* ───────────────── Platform Admin › Design requests ───────────────── */

type Status = 'NEW' | 'IN_REVIEW' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
type Category = 'ADD_PAGE' | 'CUSTOM_THEME';
type Req = {
  id: string;
  dealerId: string;
  requestCategory: Category;
  subType: string;
  designAreas: string[];
  pageSlug: string;
  layoutStyle: string;
  requestedSections: string[];
  contentNotes: string;
  colorPreferences: { primary?: string; accent?: string; mode?: string; font?: string } | null;
  requestType: 'EXTRA_PAGE' | 'EXTRA_SECTION' | 'DESIGN_CHANGE';
  title: string;
  targetPage: string;
  description: string;
  referenceUrl: string;
  contactPreference: 'PORTAL' | 'EMAIL' | 'PHONE';
  contactEmail: string;
  contactPhone: string;
  status: Status;
  adminNotes: string;
  submittedBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  dealer: { id: string; name: string; domain: string; email: string; phone: string };
};
type List = { items: Req[]; total: number; page: number; pageSize: number; counts: Record<Status, number>; categories: Record<Category, number>; all: number; new: number };

const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'NEW', label: 'New', color: 'blue' },
  { id: 'IN_REVIEW', label: 'In review', color: 'amber' },
  { id: 'IN_PROGRESS', label: 'In progress', color: 'violet' },
  { id: 'COMPLETED', label: 'Completed', color: 'green' },
  { id: 'DECLINED', label: 'Declined', color: 'red' },
];
/** Add Page = blue, Custom Theme = green — everywhere on this page */
const TRACK: Record<Category, { label: string; badge: string; row: string; border: string; Icon: React.ElementType }> = {
  ADD_PAGE: { label: 'Add Page', badge: 'bg-blue-100 text-blue-700 ring-blue-200', row: 'bg-blue-50/40 hover:bg-blue-50', border: 'border-l-blue-500', Icon: FilePlus2 },
  CUSTOM_THEME: { label: 'Custom Theme', badge: 'bg-emerald-100 text-emerald-700 ring-emerald-200', row: 'bg-emerald-50/40 hover:bg-emerald-50', border: 'border-l-emerald-500', Icon: Sparkles },
};
const LAYOUTS: Record<string, string> = { CLEAN_INFO: 'Clean informational', LEAD_FOCUSED: 'Conversion / lead-focused', MEDIA_GALLERY: 'Media & gallery heavy', MATCH_SITE: 'Match existing site style' };
const AREAS: Record<string, string> = {
  FULL_THEME: 'Full custom theme',
  NEW_SECTION: 'New section on an existing page',
  COLORS_TYPOGRAPHY: 'Colour scheme & typography',
  HEADER_FOOTER: 'Header / navigation / footer redesign',
  WIDGET_BANNER: 'Custom interactive widget / banner',
};
const LEGACY: Record<string, string> = { EXTRA_PAGE: 'Extra page', EXTRA_SECTION: 'Extra section', DESIGN_CHANGE: 'Design change' };
const CONTACT = { PORTAL: 'In the portal', EMAIL: 'Email', PHONE: 'Phone call' } as const;
const st = (s: Status) => STATUSES.find((x) => x.id === s) || STATUSES[0];

/** tells the sidebar badge to refresh */
const pingBadge = () => window.dispatchEvent(new Event('pa:design-requests'));

function TrackBadge({ c, className }: { c: Category; className?: string }) {
  const t = TRACK[c] || TRACK.CUSTOM_THEME;
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset', t.badge, className)}>
      <t.Icon className="h-3 w-3" /> {t.label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default function DesignRequestsPage() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState<'' | Category>('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Req | null>(null);
  const [edit, setEdit] = useState<{ status: Status; adminNotes: string }>({ status: 'NEW', adminNotes: '' });
  const [saving, setSaving] = useState(false);
  const { data, loading, reload } = useApi<List>(`/platform/design-requests?status=${status}&category=${category}&q=${encodeURIComponent(term)}&page=${page}`);

  useEffect(() => {
    if (open) setEdit({ status: open.status, adminNotes: open.adminNotes });
  }, [open]);

  const statusTotal = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  const dirty = !!open && (edit.status !== open.status || edit.adminNotes !== open.adminNotes);

  async function save() {
    if (!open) return;
    setSaving(true);
    try {
      const r = await api<Req>(`/platform/design-requests/${open.id}`, { method: 'PATCH', body: edit });
      setOpen({ ...open, ...r });
      toast.ok('Request updated — the dealer sees it in their portal.');
      await reload();
      pingBadge();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const refs = (open?.referenceUrl || '').split(/\s+/).filter(Boolean);
  const cp = open?.colorPreferences;

  return (
    <>
      <PageHeader title="Design requests" desc="New pages (blue) and custom themes / design changes (green) requested by dealerships from Design & colours." />

      {/* track: All / Add Page (blue) / Custom Theme (green) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {(
          [
            ['', 'All requests', data ? data.categories.ADD_PAGE + data.categories.CUSTOM_THEME : 0, 'border-slate-900 bg-slate-900 text-white', 'bg-white/20'],
            ['ADD_PAGE', 'Add Page', data?.categories.ADD_PAGE ?? 0, 'border-blue-600 bg-blue-600 text-white', 'bg-white/25'],
            ['CUSTOM_THEME', 'Custom Theme', data?.categories.CUSTOM_THEME ?? 0, 'border-emerald-600 bg-emerald-600 text-white', 'bg-white/25'],
          ] as const
        ).map(([id, label, n, onCls, pillOn]) => {
          const on = category === id;
          return (
            <button
              key={id || 'all'}
              onClick={() => {
                setCategory(id);
                setPage(1);
              }}
              className={cx(
                'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition',
                on ? onCls : id === 'ADD_PAGE' ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' : id === 'CUSTOM_THEME' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {id === 'ADD_PAGE' && <FilePlus2 className="h-4 w-4" />}
              {id === 'CUSTOM_THEME' && <Sparkles className="h-4 w-4" />}
              {label}
              <span className={cx('rounded-full px-1.5 text-xs', on ? pillOn : 'bg-white/80 ring-1 ring-inset ring-black/5')}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* status */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[{ id: '', label: 'Any status', color: 'slate' }, ...STATUSES].map((s) => {
          const n = s.id ? data?.counts[s.id as Status] ?? 0 : statusTotal;
          const on = status === s.id;
          return (
            <button
              key={s.id || 'all'}
              onClick={() => {
                setStatus(s.id);
                setPage(1);
              }}
              className={cx('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition', on ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >
              {s.label}
              <span className={cx('rounded-full px-1.5', on ? 'bg-white/20' : s.id === 'NEW' && n ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}>{n}</span>
            </button>
          );
        })}
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <form
            className="relative min-w-[220px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q);
              setPage(1);
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Dealership, domain or request title…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <Table head={['Dealership', 'Request', 'Track', 'Status', 'Submitted']} empty={!data?.items.length && <Empty title="No design requests" desc="Requests dealers send from Design & colours show up here." />}>
              {data?.items.map((r) => {
                const t = TRACK[r.requestCategory] || TRACK.CUSTOM_THEME;
                return (
                  <tr key={r.id} onClick={() => setOpen(r)} className={cx('cursor-pointer transition', t.row)}>
                    <Td className={cx('border-l-4', t.border)}>
                      <b className={cx(r.status === 'NEW' && 'text-slate-950')}>{r.dealer.name}</b>
                      <div className="text-xs text-slate-500">{r.dealer.domain || r.dealer.email}</div>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5 font-medium text-slate-900">
                        {r.status === 'NEW' && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" title="New" />}
                        {r.title}
                      </span>
                      <div className="max-w-sm truncate text-xs text-slate-500">
                        {r.requestCategory === 'ADD_PAGE'
                          ? [r.pageSlug && `/${r.pageSlug}`, r.requestedSections?.length ? `${r.requestedSections.length} sections` : '', LAYOUTS[r.layoutStyle]].filter(Boolean).join(' · ') || r.description
                          : r.designAreas?.length
                            ? r.designAreas.map((a) => AREAS[a] || a).join(' · ')
                            : `${LEGACY[r.requestType]}${r.targetPage ? ` · ${r.targetPage}` : ''}`}
                      </div>
                    </Td>
                    <Td>
                      <TrackBadge c={r.requestCategory} />
                    </Td>
                    <Td>
                      <Badge color={st(r.status).color}>{st(r.status).label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{ago(r.createdAt)}</Td>
                  </tr>
                );
              })}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={
          open ? (
            <span className="flex items-center gap-2">
              <TrackBadge c={open.requestCategory} /> {open.title}
            </span>
          ) : (
            ''
          )
        }
        footer={
          open && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Close
              </Button>
              <Button onClick={save} loading={saving} disabled={!dirty}>
                Save update
              </Button>
            </div>
          )
        }
      >
        {open && (
          <div className={cx('-mx-6 -mt-5 border-l-4 px-6 pt-5', TRACK[open.requestCategory]?.border)}>
            <div className="space-y-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={st(open.status).color}>{st(open.status).label}</Badge>
                <span className="text-xs text-slate-500">
                  Sent {dateTime(open.createdAt)}
                  {open.submittedBy && <> by {open.submittedBy}</>}
                </span>
              </div>

              {/* dealership + contact */}
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dealership</div>
                    <Link href={`/platform/dealers/${open.dealer.id}`} className="font-semibold text-slate-900 hover:underline">
                      {open.dealer.name}
                    </Link>
                  </div>
                  {open.dealer.domain && (
                    <a href={`https://${open.dealer.domain}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
                      <Globe className="h-3.5 w-3.5" /> {open.dealer.domain}
                    </a>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <span className="text-xs text-slate-500">
                    Prefers: <b className="text-slate-800">{CONTACT[open.contactPreference]}</b>
                  </span>
                  {(open.contactEmail || open.dealer.email) && (
                    <a href={`mailto:${open.contactEmail || open.dealer.email}?subject=${encodeURIComponent('Your website request: ' + open.title)}`} className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
                      <Mail className="h-4 w-4" /> {open.contactEmail || open.dealer.email}
                    </a>
                  )}
                  {(open.contactPhone || open.dealer.phone) && (
                    <a href={'tel:' + (open.contactPhone || open.dealer.phone).replace(/[^\d+]/g, '')} className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
                      <Phone className="h-4 w-4" /> {open.contactPhone || open.dealer.phone}
                    </a>
                  )}
                </div>
              </div>

              {open.requestCategory === 'ADD_PAGE' ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Section title="Page title">
                    <span className="font-semibold text-slate-900">{open.title}</span>
                  </Section>
                  <Section title="Page address (slug idea)">
                    <span className="font-mono text-slate-800">{open.pageSlug ? `/${open.pageSlug}` : open.targetPage || '—'}</span>
                  </Section>
                  <Section title="Page style / layout">
                    <span className="text-slate-800">{LAYOUTS[open.layoutStyle] || '—'}</span>
                  </Section>
                  <div className="sm:col-span-2">
                    <Section title={`Sections requested (${open.requestedSections?.length || 0})`}>
                      {open.requestedSections?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {open.requestedSections.map((s) => (
                            <span key={s} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Section>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <Section title="What to customize">
                    {open.designAreas?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {open.designAreas.map((a) => (
                          <span key={a} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            {AREAS[a] || a}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-800">{LEGACY[open.requestType]}</span>
                    )}
                  </Section>
                  {open.targetPage && (
                    <Section title="Target page">
                      <span className="text-slate-900">{open.targetPage}</span>
                    </Section>
                  )}
                  {cp && (cp.primary || cp.accent || cp.font || cp.mode) && (
                    <Section title="Colours & typography">
                      <div className="flex flex-wrap items-center gap-4">
                        {[
                          ['Primary', cp.primary],
                          ['Accent', cp.accent],
                        ]
                          .filter(([, v]) => v)
                          .map(([l, v]) => (
                            <span key={l} className="inline-flex items-center gap-2">
                              <span className="h-6 w-6 rounded-md ring-1 ring-black/10" style={{ background: v }} />
                              <span className="text-xs text-slate-500">{l}</span> <span className="font-mono text-xs text-slate-800">{v}</span>
                            </span>
                          ))}
                        {cp.mode && <span className="text-xs text-slate-500">Look: <b className="text-slate-800">{cp.mode === 'either' ? 'Light or dark' : cp.mode === 'dark' ? 'Dark' : 'Light'}</b></span>}
                        {cp.font && <span className="text-xs text-slate-500">Font: <b className="text-slate-800">{cp.font}</b></span>}
                      </div>
                    </Section>
                  )}
                </div>
              )}

              <Section title={open.requestCategory === 'ADD_PAGE' ? 'Page content & copy notes' : 'Design brief'}>
                <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-800">{open.contentNotes || open.description}</p>
              </Section>

              {refs.length > 0 && (
                <Section title={refs.length > 1 ? 'References' : 'Reference'}>
                  <div className="space-y-1">
                    {refs.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="flex max-w-full items-center gap-1 break-all text-blue-700 hover:underline">
                        {u} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    ))}
                  </div>
                </Section>
              )}

              <div className="space-y-4 border-t border-slate-100 pt-5">
                <Field label="Status">
                  <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Status })}>
                    {STATUSES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <MessageCircle className="h-3.5 w-3.5" /> Note to the dealer
                    </span>
                  }
                  hint="Shown to the dealership under this request in their portal."
                >
                  <Textarea rows={5} value={edit.adminNotes} onChange={(e) => setEdit({ ...edit, adminNotes: e.target.value })} maxLength={4000} placeholder="e.g. Thanks — we will have the Service page live by Friday. Could you send us a photo of the shop?" />
                </Field>
                {open.updatedBy && (
                  <p className="text-xs text-slate-500">
                    Last updated {ago(open.updatedAt)} by {open.updatedBy}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
