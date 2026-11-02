'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, StatusBadge, Textarea, Toggle, cx } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default function CargurusAudit() {
  const { tenantId, id } = useParams<{ tenantId: string; id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/platform/cargurus/${tenantId}/${id}`);
  const [filter, setFilter] = useState<'all' | 'issues' | 'ready'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [row, setRow] = useState<any>(null);
  const [approve, setApprove] = useState(false);
  const [reject, setReject] = useState(false);
  const [note, setNote] = useState('');
  const [includeInvalid, setIncludeInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r: any) => {
      const vehicleIssues = Object.keys(r.issues).some((k) => !k.startsWith('dealer_'));
      if (filter === 'issues' && !vehicleIssues) return false;
      if (filter === 'ready' && vehicleIssues) return false;
      return !q || r.values.join(' ').toLowerCase().includes(q.toLowerCase());
    });
  }, [data, filter, q]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;
  const s = data.summary;
  const sub = data.submission;
  const pageRows = rows.slice((page - 1) * 25, page * 25);

  return (
    <>
      <PageHeader
        back="/platform/cargurus"
        title={`${sub.tenantName} · CarGurus upload`}
        desc={
          <>
            {sub.dealerCode} · {sub.source === 'inventory' ? 'Website inventory' : sub.fileName} · {dateTime(sub.createdAt)} by {sub.createdBy} · <StatusBadge status={sub.status} />
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => download(`/platform/cargurus/${tenantId}/${id}/master.csv`, `cargurus-${tenantId}.csv`)}>
              <Download className="h-4 w-4" /> Download CarGurus Master CSV
            </Button>
            {sub.status === 'PENDING' && (
              <>
                <Button variant="danger" onClick={() => setReject(true)}>
                  Reject
                </Button>
                <Button variant="success" onClick={() => setApprove(true)} disabled={!s.profile.complete}>
                  Approve & Sync to CarGurus
                </Button>
              </>
            )}
            {sub.status === 'APPROVED' && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const r = await api(`/platform/cargurus/${tenantId}/resend`, { method: 'POST' });
                  r.sent ? toast.ok('Feed sent to CarGurus') : toast.error(r.reason);
                }}
              >
                Re-send
              </Button>
            )}
          </>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-3xl font-extrabold">{s.total}</span> <span className="text-sm text-slate-500">vehicles ingested</span>
            {s.allPassed ? (
              <Badge color="green">
                <CheckCircle2 className="h-3 w-3" /> All {s.checks.length} mandatory vehicle checks passed
              </Badge>
            ) : (
              <Badge color="amber">
                <AlertTriangle className="h-3 w-3" /> {s.issues} issues detected
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.checks.map((c: any) => (
              <Badge key={c.key} color={c.failed ? 'red' : 'green'}>
                {c.label}
                {c.failed ? `: ${c.failed}` : ' ✓'}
              </Badge>
            ))}
          </div>
        </Card>
        <Card title={`Dealership profile · ${s.profile.percent}%`}>
          {s.profile.complete ? (
            <p className="text-sm text-emerald-700">Complete — dealer columns are auto-enriched into every row.</p>
          ) : (
            <ul className="space-y-1 text-xs text-red-700">
              {s.profile.missing.map((m: any) => (
                <li key={m.field}>• {m.issue}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {sub.reviewNote && <p className="mb-4 rounded-lg bg-slate-100 p-3 text-sm">Review note: {sub.reviewNote}</p>}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {(['all', 'issues', 'ready'] as const).map((k) => (
              <button key={k} onClick={() => { setFilter(k); setPage(1); }} className={cx('rounded-md px-3 py-1.5 capitalize', filter === k ? 'bg-white shadow' : 'text-slate-500')}>
                {k === 'issues' ? 'With issues' : k}
              </button>
            ))}
          </div>
          <Input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        </div>
        <div className="overflow-x-auto">
          <table className="text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Row</th>
                {data.columns.map((c: any) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2">
                    {c.label} {c.source === 'dealer' && <Badge color="violet">Auto-enriched</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pageRows.map((r: any) => (
                <tr key={r.row} onClick={() => setRow(r)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-3 py-2 font-semibold">{r.row}</td>
                  {data.columns.map((c: any, i: number) => {
                    const iss = r.issues[c.key];
                    return (
                      <td key={c.key} title={iss?.join('\n')} className={cx('max-w-[180px] truncate px-3 py-2', iss && 'bg-red-50 text-red-700')}>
                        {r.values[i] || (iss ? '—' : '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={25} total={rows.length} onPage={setPage} />
      </Card>

      <Drawer open={!!row} onClose={() => setRow(null)} title={`Row ${row?.row}`} wide>
        {row && (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 text-left">Column</th>
                <th className="py-2 text-left">Dealer’s file</th>
                <th className="py-2 text-left">CarGurus export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.columns.map((c: any, i: number) => (
                <tr key={c.key} className={row.issues[c.key] ? 'bg-red-50' : ''}>
                  <td className="py-2 pr-3 font-semibold">{c.label}</td>
                  <td className="py-2 pr-3 text-slate-500">{c.source === 'dealer' ? <i>profile</i> : row.raw[c.key]}</td>
                  <td className="py-2">
                    {row.values[i]}
                    {row.issues[c.key]?.map((m: string) => (
                      <div key={m} className="text-xs text-red-700">{m}</div>
                    ))}
                    {row.warnings[c.key]?.map((m: string) => (
                      <div key={m} className="text-xs text-amber-700">{m}</div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Drawer>

      <Modal
        open={approve}
        onClose={() => setApprove(false)}
        title="Approve & sync to CarGurus"
        footer={
          <Button
            variant="success"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api(`/platform/cargurus/${tenantId}/${id}/approve`, { body: { includeInvalid, note } });
                toast.ok(`${r.vehicles} vehicles approved. ${r.dispatch.sent ? 'Sent to CarGurus.' : r.dispatch.reason}`);
                setApprove(false);
                reload();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve
          </Button>
        }
      >
        <p className="mb-3">
          {s.valid} of {s.total} vehicles are ready. {s.invalid > 0 && 'Vehicles with problems are left out.'}
        </p>
        {s.invalid > 0 && <Toggle checked={includeInvalid} onChange={setIncludeInvalid} label="Include vehicles with problems anyway" />}
        <Field label="Note (optional)" className="mt-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
      <Modal
        open={reject}
        onClose={() => setReject(false)}
        title="Reject upload"
        footer={
          <Button
            variant="danger"
            disabled={!note.trim()}
            onClick={async () => {
              try {
                await api(`/platform/cargurus/${tenantId}/${id}/reject`, { body: { note } });
                toast.ok('Rejected — the dealer sees your feedback');
                router.push('/platform/cargurus');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Reject
          </Button>
        }
      >
        <Field label="Feedback for the dealer">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
