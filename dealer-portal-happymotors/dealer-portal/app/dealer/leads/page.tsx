'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, Mail, Phone, Search, Send, Trash2 } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, Textarea, cx } from '@/components/ui';
import { ago, dateTime, vehicleName } from '@/lib/format';

function LeadEmail() {
  const { data, setData } = useApi('/dealer/leads/email');
  const [v, setV] = useState('');
  const [busy, setBusy] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (data) setV(data.leadTo);
  }, [data]);
  if (!data) return null;
  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Inquiries are emailed to" className="min-w-[260px] flex-1" hint={!data.leadTo && data.fallback ? `Empty: your public email ${data.fallback} is used.` : undefined}>
          <Input type="email" value={v} onChange={(e) => setV(e.target.value)} placeholder="sales@yourdealership.com" />
        </Field>
        <Button
          loading={busy === 'save'}
          disabled={v === data.leadTo}
          onClick={async () => {
            setBusy('save');
            try {
              setData(await api('/dealer/leads/email', { method: 'PUT', body: { leadTo: v } }));
              toast.ok('Saved');
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy('');
            }
          }}
        >
          Save
        </Button>
        <Button
          variant="secondary"
          loading={busy === 'test'}
          onClick={async () => {
            setBusy('test');
            try {
              const r = await api('/dealer/leads/email/test', { method: 'POST' });
              toast.ok(`Test email sent to ${r.to}`);
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy('');
            }
          }}
        >
          <Send className="h-4 w-4" /> Send test email
        </Button>
      </div>
    </Card>
  );
}

function LeadDrawer({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { data, setData, loading } = useApi(`/dealer/leads/${id}`);
  const [reply, setReply] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (data) setNotes(data.notes || '');
  }, [data]);

  const patch = async (body: Record<string, unknown>) => {
    try {
      const l = await api(`/dealer/leads/${id}`, { method: 'PATCH', body });
      setData({ ...data, ...l });
      onChange();
      toast.ok('Saved');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Drawer open onClose={onClose} title={data ? `${data.name} · ${data.topic}` : 'Inquiry'}>
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 text-sm">
            {data.email && (
              <a href={`mailto:${data.email}`} className="inline-flex items-center gap-1.5 text-blue-700">
                <Mail className="h-4 w-4" /> {data.email}
              </a>
            )}
            {data.phone && (
              <a href={`tel:${data.phone}`} className="inline-flex items-center gap-1.5 text-blue-700">
                <Phone className="h-4 w-4" /> {data.phone}
              </a>
            )}
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="mb-2 text-xs text-slate-500">
              {dateTime(data.createdAt)} · from {data.page || 'website'}
            </div>
            <p className="whitespace-pre-line text-sm text-slate-800">{data.message}</p>
            {data.vehicle && <div className="mt-3 text-xs font-semibold text-slate-600">Vehicle: {vehicleName(data.vehicle)} {data.vehicle.stockNumber && `(stock ${data.vehicle.stockNumber})`}</div>}
          </div>
          {data.replies.map((r: any) => (
            <div key={r.id} className="ml-8 rounded-xl bg-blue-50 p-4">
              <div className="mb-1 text-xs text-slate-500">
                You replied · {dateTime(r.createdAt)} · by {r.sentBy}
              </div>
              <p className="whitespace-pre-line text-sm text-slate-800">{r.body}</p>
            </div>
          ))}
          {data.email && (
            <Field label="Reply by email" hint="The customer’s answer comes back to your inquiry email.">
              <Textarea rows={5} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Hi ${data.name.split(' ')[0]}, thanks for your message…`} />
              <Button
                className="mt-2"
                loading={busy === 'reply'}
                disabled={!reply.trim()}
                onClick={async () => {
                  setBusy('reply');
                  try {
                    const r = await api(`/dealer/leads/${id}/reply`, { body: { body: reply } });
                    setData({ ...data, status: 'REPLIED', replies: [...data.replies, r] });
                    setReply('');
                    onChange();
                    toast.ok('Reply sent');
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Send className="h-4 w-4" /> Send reply
              </Button>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-5">
            <Field label="Status">
              <Select value={data.status} onChange={(e) => patch({ status: e.target.value })}>
                {['UNREAD', 'READ', 'REPLIED', 'CLOSED'].map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Private notes">
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (data.notes || '') && patch({ notes })} />
          </Field>
          <Button
            variant="ghost"
            className="text-red-600"
            onClick={async () => {
              if (!confirm('Delete this inquiry?')) return;
              await api(`/dealer/leads/${id}`, { method: 'DELETE' });
              onChange();
              onClose();
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete inquiry
          </Button>
        </div>
      )}
    </Drawer>
  );
}

function LeadsPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(params.get('open') || '');
  const { data, loading, error, reload } = useApi(`/dealer/leads?status=${status}&q=${encodeURIComponent(term)}&page=${page}`);

  return (
    <>
      <PageHeader
        title="Leads & inquiries"
        desc="Every message from your website’s contact and vehicle forms."
        actions={
          <Button variant="secondary" onClick={() => download('/dealer/leads/export.csv', 'inquiries.csv')}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />
      <LeadEmail />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {[
              ['', 'All'],
              ['UNREAD', `Unread${data?.unread ? ` (${data.unread})` : ''}`],
              ['REPLIED', 'Replied'],
              ['CLOSED', 'Closed'],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setStatus(k);
                  setPage(1);
                }}
                className={cx('rounded-md px-3 py-1.5', status === k ? 'bg-white shadow' : 'text-slate-500')}
              >
                {l}
              </button>
            ))}
          </div>
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q);
              setPage(1);
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, email, phone, message…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : (
          <>
            <Table head={['Customer', 'Topic', 'Vehicle', 'Status', 'Received']} empty={!data?.items.length && <Empty title="No inquiries" />}>
              {data?.items.map((l: any) => (
                <tr key={l.id} onClick={() => setOpen(l.id)} className={cx('cursor-pointer hover:bg-slate-50', l.status === 'UNREAD' && 'bg-blue-50/40 font-semibold')}>
                  <Td>
                    <div className="text-slate-900">{l.name}</div>
                    <div className="text-xs font-normal text-slate-500">{l.email || l.phone}</div>
                  </Td>
                  <Td>
                    <div>{l.topic}</div>
                    <div className="max-w-xs truncate text-xs font-normal text-slate-500">{l.message}</div>
                  </Td>
                  <Td className="text-xs">{l.vehicle ? vehicleName(l.vehicle) : '—'}</Td>
                  <Td>
                    <StatusBadge status={l.status} /> {l._count.replies > 0 && <Badge>{l._count.replies} replies</Badge>}
                  </Td>
                  <Td className="text-xs text-slate-500">{ago(l.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      {open && <LeadDrawer id={open} onClose={() => setOpen('')} onChange={reload} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LeadsPage />
    </Suspense>
  );
}
