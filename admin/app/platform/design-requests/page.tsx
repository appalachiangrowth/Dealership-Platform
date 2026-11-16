'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ExternalLink, Globe, Mail, MessageCircle, Phone, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Empty, Field, Input, Loading, PageHeader, Pagination, Select, Table, Td, Textarea, cx } from '@/components/ui';
import { ago, dateTime } from '@/lib/format';

/* ───────────────── Platform Admin › Design requests ───────────────── */

type Status = 'NEW' | 'IN_REVIEW' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';
type Req = {
  id: string;
  dealerId: string;
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
type List = { items: Req[]; total: number; page: number; pageSize: number; counts: Record<Status, number>; new: number };

const STATUSES: { id: Status; label: string; color: string }[] = [
  { id: 'NEW', label: 'New', color: 'blue' },
  { id: 'IN_REVIEW', label: 'In review', color: 'amber' },
  { id: 'IN_PROGRESS', label: 'In progress', color: 'violet' },
  { id: 'COMPLETED', label: 'Completed', color: 'green' },
  { id: 'DECLINED', label: 'Declined', color: 'red' },
];
const TYPES = { EXTRA_PAGE: 'Extra page', EXTRA_SECTION: 'Extra section', DESIGN_CHANGE: 'Design change' } as const;
const CONTACT = { PORTAL: 'In the portal', EMAIL: 'Email', PHONE: 'Phone call' } as const;
const st = (s: Status) => STATUSES.find((x) => x.id === s) || STATUSES[0];

/** tells the sidebar badge to refresh */
const pingBadge = () => window.dispatchEvent(new Event('pa:design-requests'));

export default function DesignRequestsPage() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Req | null>(null);
  const [edit, setEdit] = useState<{ status: Status; adminNotes: string }>({ status: 'NEW', adminNotes: '' });
  const [saving, setSaving] = useState(false);
  const { data, loading, reload } = useApi<List>(`/platform/design-requests?status=${status}&requestType=${type}&q=${encodeURIComponent(term)}&page=${page}`);

  useEffect(() => {
    if (open) setEdit({ status: open.status, adminNotes: open.adminNotes });
  }, [open]);

  const all = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
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

  return (
    <>
      <PageHeader title="Design requests" desc="Extra pages, extra sections and design changes requested by dealerships from Design & colours." />

      <div className="mb-4 flex flex-wrap gap-2">
        {[{ id: '', label: 'All', color: 'slate' }, ...STATUSES].map((s) => {
          const n = s.id ? data?.counts[s.id as Status] ?? 0 : all;
          const on = status === s.id;
          return (
            <button
              key={s.id || 'all'}
              onClick={() => {
                setStatus(s.id);
                setPage(1);
              }}
              className={cx('inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition', on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
            >
              {s.label}
              <span className={cx('rounded-full px-1.5 text-xs', on ? 'bg-white/20' : s.id === 'NEW' && n ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600')}>{n}</span>
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
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className="w-44"
          >
            <option value="">All types</option>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <Table head={['Dealership', 'Request', 'Type', 'Status', 'Submitted']} empty={!data?.items.length && <Empty title="No design requests" desc="Requests dealers send from Design & colours show up here." />}>
              {data?.items.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r)} className={cx('cursor-pointer hover:bg-slate-50', r.status === 'NEW' && 'bg-blue-50/40')}>
                  <Td>
                    <b>{r.dealer.name}</b>
                    <div className="text-xs text-slate-500">{r.dealer.domain || r.dealer.email}</div>
                  </Td>
                  <Td>
                    <span className="font-medium text-slate-900">{r.title}</span>
                    <div className="max-w-xs truncate text-xs text-slate-500">{r.targetPage ? `${r.targetPage} · ` : ''}{r.description}</div>
                  </Td>
                  <Td>
                    <Badge color="slate">{TYPES[r.requestType]}</Badge>
                  </Td>
                  <Td>
                    <Badge color={st(r.status).color}>{st(r.status).label}</Badge>
                  </Td>
                  <Td className="text-xs">{ago(r.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={open ? open.title : ''}
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
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="slate">{TYPES[open.requestType]}</Badge>
              <Badge color={st(open.status).color}>{st(open.status).label}</Badge>
              <span className="text-xs text-slate-500">
                Sent {dateTime(open.createdAt)}
                {open.submittedBy && <> by {open.submittedBy}</>}
              </span>
            </div>

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
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="text-xs text-slate-500">
                  Prefers: <b className="text-slate-800">{CONTACT[open.contactPreference]}</b>
                </div>
                <div />
                {(open.contactEmail || open.dealer.email) && (
                  <a href={`mailto:${open.contactEmail || open.dealer.email}?subject=${encodeURIComponent('Your website request: ' + open.title)}`} className="inline-flex items-center gap-2 text-blue-700 hover:underline">
                    <Mail className="h-4 w-4" /> {open.contactEmail || open.dealer.email}
                  </a>
                )}
                {(open.contactPhone || open.dealer.phone) && (
                  <a href={'tel:' + (open.contactPhone || open.dealer.phone).replace(/[^\d+]/g, '')} className="inline-flex items-center gap-2 text-blue-700 hover:underline">
                    <Phone className="h-4 w-4" /> {open.contactPhone || open.dealer.phone}
                  </a>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where</div>
              <div className="mt-0.5 text-slate-900">{open.targetPage || '—'}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details & requirements</div>
              <p className="mt-1 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-800">{open.description}</p>
            </div>
            {open.referenceUrl && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reference</div>
                <a href={open.referenceUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 break-all text-blue-700 hover:underline">
                  {open.referenceUrl} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              </div>
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
              <Field label={<span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Note to the dealer</span>} hint="Shown to the dealership under this request in their portal.">
                <Textarea rows={5} value={edit.adminNotes} onChange={(e) => setEdit({ ...edit, adminNotes: e.target.value })} maxLength={4000} placeholder="e.g. Thanks — we will have the Service page live by Friday. Could you send us a photo of the shop?" />
              </Field>
              {open.updatedBy && (
                <p className="text-xs text-slate-500">
                  Last updated {ago(open.updatedAt)} by {open.updatedBy}
                </p>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
