'use client';

import { useState } from 'react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Tabs, Td, Textarea, Toggle } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default function ThemesPage() {
  const { data, setData, loading } = useApi('/platform/themes');
  const requests = useApi('/platform/theme-requests');
  const settings = useApi('/platform/settings');
  const toast = useToast();
  const [tab, setTab] = useState('designs');
  const [edit, setEdit] = useState<any>(null);
  const [release, setRelease] = useState({ version: '', notes: '' });
  const [payment, setPayment] = useState<string | null>(null);

  if (loading || !data) return <Loading />;
  const pending = requests.data?.filter((r: any) => r.status === 'PENDING').length || 0;

  async function save() {
    try {
      const { paid, price, currency, billing, priceNote, enabled, stableVersion, betaVersion, name, description } = edit;
      setData(await api(`/platform/themes/${edit.id}`, { method: 'PATCH', body: { paid, price, currency, billing, priceNote, enabled, stableVersion, betaVersion, name, description } }));
      toast.ok('Design saved');
      setEdit(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Themes & releases" desc="Website designs, their prices and version releases. Dealers on the Beta channel get the beta version; a dealer can be pinned to a version." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'designs', label: 'Designs' },
          { id: 'requests', label: `Unlock requests${pending ? ` (${pending})` : ''}` },
          { id: 'payment', label: 'Payment instructions' },
        ]}
      />
      {tab === 'designs' && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {data.themes.map((t: any) => (
            <Card key={t.id} pad={false}>
              <img src={mediaUrl(t.previewUrl)} alt="" className="aspect-[16/9] w-full rounded-t-2xl object-cover" />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-bold">{t.name}</h3>
                  {t.enabled ? <Badge color="green">Enabled</Badge> : <Badge>Hidden</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Stable <b>{t.stableVersion}</b>
                  {t.betaVersion && <> · Beta <b>{t.betaVersion}</b></>} · {t.dealers} dealers · {t.priceLabel} · {t.licenses} licences
                </p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEdit({ ...t })}>
                  Edit price & release
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === 'requests' && (
        <Card pad={false}>
          <Table head={['Dealership', 'Design', 'Price', 'Requested', 'Message', 'Status', '']}>
            {requests.data?.map((r: any) => (
              <tr key={r.id}>
                <Td>
                  <b>{r.tenant.name}</b>
                  <div className="text-xs text-slate-500">{r.requestedByName || r.requestedBy}</div>
                </Td>
                <Td>{r.theme.name}</Td>
                <Td>
                  {r.currency} {Number(r.price)} <span className="text-xs text-slate-400">{r.billing.toLowerCase().replace('_', '-')}</span>
                </Td>
                <Td className="text-xs">{dateTime(r.createdAt)}</Td>
                <Td className="max-w-xs text-xs">
                  {r.note}
                  {r.reviewNote && <div className="text-slate-400">→ {r.reviewNote}</div>}
                </Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td className="whitespace-nowrap">
                  {r.status === 'PENDING' && (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        onClick={async () => {
                          const amount = prompt('Amount received', String(Number(r.price)));
                          if (amount === null) return;
                          requests.setData(await api(`/platform/theme-requests/${r.id}/approve`, { body: { amount, note: 'Payment received' } }));
                          toast.ok('Design unlocked for the dealer');
                        }}
                      >
                        Payment received
                      </Button>{' '}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const note = prompt('Reason (shown to the dealer)') || '';
                          requests.setData(await api(`/platform/theme-requests/${r.id}/decline`, { body: { note } }));
                        }}
                      >
                        Decline
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
      {tab === 'payment' && settings.data && (
        <Card className="max-w-2xl" title="How dealers pay for a design">
          <Textarea rows={8} value={payment ?? settings.data.payment.instructions} onChange={(e) => setPayment(e.target.value)} placeholder="Bank details, JazzCash / Easypaisa number, PayPal link…" />
          <Button
            className="mt-3"
            onClick={async () => {
              settings.setData(await api('/platform/settings', { method: 'PUT', body: { payment: { instructions: payment ?? '' } } }));
              toast.ok('Saved');
            }}
          >
            Save
          </Button>
        </Card>
      )}
      <Drawer
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        {edit && (
          <div className="space-y-5">
            <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Show in the dealers’ design gallery" />
            <Field label="Description">
              <Textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <div className="rounded-xl border border-slate-200 p-4">
              <Toggle checked={edit.paid} onChange={(v) => setEdit({ ...edit, paid: v })} label="Paid design" desc="Dealers can preview it but must request it before using it." />
              {edit.paid && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <Field label="Price">
                    <Input type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} />
                  </Field>
                  <Field label="Currency">
                    <Select value={edit.currency} onChange={(e) => setEdit({ ...edit, currency: e.target.value })}>
                      {data.currencies.map((c: string) => <option key={c}>{c}</option>)}
                    </Select>
                  </Field>
                  <Field label="Billing">
                    <Select value={edit.billing} onChange={(e) => setEdit({ ...edit, billing: e.target.value })}>
                      <option value="ONE_TIME">One-time</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="YEARLY">Yearly</option>
                    </Select>
                  </Field>
                  <Field label="Note" className="col-span-3">
                    <Input value={edit.priceNote} onChange={(e) => setEdit({ ...edit, priceNote: e.target.value })} />
                  </Field>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Field label="Stable version">
                  <Select value={edit.stableVersion} onChange={(e) => setEdit({ ...edit, stableVersion: e.target.value })}>
                    {edit.versions.map((v: any) => <option key={v.version}>{v.version}</option>)}
                  </Select>
                </Field>
                <Field label="Beta version">
                  <Select value={edit.betaVersion} onChange={(e) => setEdit({ ...edit, betaVersion: e.target.value })}>
                    <option value="">— none —</option>
                    {edit.versions.map((v: any) => <option key={v.version}>{v.version}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="text-xs font-bold uppercase text-slate-500">Releases</div>
              <ul className="mb-3 mt-1 text-sm">
                {edit.versions.map((v: any) => (
                  <li key={v.version}>
                    <b>{v.version}</b> <span className="text-xs text-slate-500">{dateTime(v.releasedAt)} — {v.notes}</span>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input placeholder="1.1.0" value={release.version} onChange={(e) => setRelease({ ...release, version: e.target.value })} className="w-28" />
                <Input placeholder="What changed" value={release.notes} onChange={(e) => setRelease({ ...release, notes: e.target.value })} />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const r = await api(`/platform/themes/${edit.id}/versions`, { body: release });
                      setData(r);
                      setEdit({ ...edit, versions: r.themes.find((t: any) => t.id === edit.id).versions });
                      setRelease({ version: '', notes: '' });
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  Add release
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-500">A release records a new version of the design’s code in frontend/themes/{edit.id}. Point Beta to it, test with one dealer, then point Stable to it.</p>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
