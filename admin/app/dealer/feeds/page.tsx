'use client';

import { useRef, useState } from 'react';
import { Download, FileUp, Send, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Loading, PageHeader, StatusBadge, Table, Td } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default function FeedsPage() {
  const status = useApi('/dealer/feeds/status');
  const cg = useApi('/dealer/feeds/cargurus');
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<any>(null);

  async function upload(f: File) {
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', f);
      const r = await api('/dealer/feeds/cargurus/upload', { form });
      setResult(r);
      cg.reload();
    } catch (e) {
      const data = (e as any).data;
      toast.error(data?.missing ? `Missing columns: ${data.missing.join(', ')}` : (e as Error).message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submitInventory() {
    setBusy('inv');
    try {
      setResult(await api('/dealer/feeds/cargurus/submit-inventory', { method: 'POST' }));
      cg.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (status.loading || cg.loading) return <Loading />;
  if (status.error) return <ErrorBox error={status.error} />;
  const s = status.data;
  const c = cg.data;

  return (
    <>
      <PageHeader title="Feeds & CarGurus" desc="Your inventory as XML for marketplaces, and the CarGurus upload. Nothing reaches CarGurus before the platform team approves it." />
      {!s.siteUrlSet && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4" /> Set your main website address in Advanced settings — every image and vehicle link in the feeds uses it.
        </div>
      )}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Inventory XML (public)">
          <p className="mb-3 break-all text-sm text-slate-600">
            <a href={s.xmlUrl} target="_blank" rel="noreferrer" className="font-mono text-blue-700 underline">
              {s.xmlUrl}
            </a>
          </p>
          <p className="mb-4 text-sm text-slate-600">
            <b>{s.xmlEligible}</b> vehicles included. {s.xmlSkipped.length > 0 && <>{s.xmlSkipped.length} left out (need a valid 17-character VIN and a photo).</>}
          </p>
          {s.xmlSkipped.length > 0 && (
            <ul className="mb-4 max-h-32 overflow-y-auto text-xs text-slate-500">
              {s.xmlSkipped.map((x: string, i: number) => (
                <li key={i}>• {x}</li>
              ))}
            </ul>
          )}
          <Button variant="secondary" size="sm" onClick={() => download('/dealer/feeds/inventory.xml', 'inventory.xml')}>
            <Download className="h-3.5 w-3.5" /> Download XML
          </Button>
        </Card>
        <Card title="CarGurus — website inventory check">
          <p className="mb-4 text-sm text-slate-600">
            <b>{s.cargurusEligible}</b> published vehicles pass every CarGurus check. {s.cargurusSkipped.length > 0 && <>{s.cargurusSkipped.length} need fixing:</>}
          </p>
          {s.cargurusSkipped.length > 0 && (
            <ul className="mb-4 max-h-32 overflow-y-auto text-xs text-slate-500">
              {s.cargurusSkipped.map((x: any) => (
                <li key={x.id}>
                  • <b>{x.name}</b>: {x.issues.join('; ')}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={submitInventory} loading={busy === 'inv'}>
              <Send className="h-3.5 w-3.5" /> Send website inventory for approval
            </Button>
            <Button variant="secondary" size="sm" onClick={() => download('/dealer/feeds/cargurus-inventory.csv', 'cargurus-inventory.csv')}>
              <Download className="h-3.5 w-3.5" /> CSV preview
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title="CarGurus uploads"
        className="mb-6"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => download('/dealer/feeds/cargurus/template.csv', 'cargurus-template.csv')}>
              <Download className="h-3.5 w-3.5" /> Template
            </Button>
            <Button size="sm" onClick={() => fileRef.current?.click()} loading={busy === 'upload'}>
              <FileUp className="h-3.5 w-3.5" /> Upload CSV / TSV
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </>
        }
        pad={false}
      >
        <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
          Dealership profile for CarGurus: <b>{c.profile.percent}%</b> complete
          {c.profile.missing.length > 0 && <> — missing: {c.profile.missing.map((m: any) => m.field).join(', ')}</>}
          {c.live && (
            <>
              {' · '}Live feed approved {dateTime(c.live.reviewedAt)} ({c.live.valid} vehicles)
            </>
          )}
        </div>
        <Table head={['Uploaded', 'Source', 'Vehicles', 'Problems', 'Status', 'Platform note']} empty={!c.submissions.length && <Empty title="No uploads yet" />}>
          {c.submissions.map((x: any) => (
            <tr key={x.id}>
              <Td>{dateTime(x.createdAt)}</Td>
              <Td>{x.source === 'inventory' ? 'Website inventory' : x.fileName}</Td>
              <Td>{x.total}</Td>
              <Td>{x.invalid ? <Badge color="amber">{x.invalid} rows</Badge> : <Badge color="green">None</Badge>}</Td>
              <Td>
                <StatusBadge status={x.status} />
              </Td>
              <Td className="max-w-xs text-xs">{x.reviewNote}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Drawer open={!!result} onClose={() => setResult(null)} title="Upload received — waiting for Platform Admin verification" wide>
        {result && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge>{result.summary.total} vehicles</Badge>
              <Badge color="green">{result.summary.valid} ready</Badge>
              {result.summary.invalid > 0 && <Badge color="amber">{result.summary.invalid} with problems</Badge>}
              {result.summary.warnings > 0 && <Badge>{result.summary.warnings} warnings</Badge>}
            </div>
            {result.issues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> All {result.summary.checks.length} mandatory checks passed.
              </p>
            ) : (
              <Table head={['Row', 'Vehicle', 'Field', 'Problem']}>
                {result.issues.map((i: any, k: number) => (
                  <tr key={k}>
                    <Td>{i.row}</Td>
                    <Td>{i.vehicle}</Td>
                    <Td>{i.field}</Td>
                    <Td className="text-red-700">{i.issue}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-4 text-xs text-slate-500">Vehicles with problems are left out when approved. Fix the file and upload again to replace this upload.</p>
          </>
        )}
      </Drawer>
    </>
  );
}
