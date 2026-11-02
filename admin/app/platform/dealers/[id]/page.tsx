'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ExternalLink, LogIn, Ban, CheckCircle2, Unlock, Lock } from 'lucide-react';
import { api, auth, siteUrl, DEALER_PORTAL_URL } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorBox, Field, Input, LinkButton, Loading, Modal, PageHeader, Select, Stat, StatusBadge, Table, Tabs, Td, Toggle } from '@/components/ui';
import { ago, dateTime, money } from '@/lib/format';

export default function DealerInspector() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { data, setData, loading, error, reload } = useApi(`/platform/tenants/${id}`);
  const themes = useApi('/platform/themes');
  const activity = useApi(`/platform/activity?tenantId=${id}`);
  const [tab, setTab] = useState('overview');
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState('');
  const [delOpen, setDelOpen] = useState(false);

  useEffect(() => {
    if (data)
      setF({
        name: data.tenant.name,
        dealerCode: data.tenant.dealerCode,
        domains: data.tenant.domains.map((d: any) => d.domain).join(', '),
        themeId: data.tenant.themeId,
        channel: data.tenant.channel,
        themePin: data.tenant.themePin,
        notes: data.tenant.notes,
        features: { ...data.features, ...(data.featureOverrides || {}) },
      });
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !f) return null;
  const t = data.tenant;
  const site = siteUrl({ id: t.id, domains: t.domains.map((d: any) => d.domain), siteUrl: data.settings.siteUrl });

  async function update(body: Record<string, unknown>, msg = 'Saved') {
    setBusy(true);
    try {
      setData(await api(`/platform/tenants/${id}`, { method: 'PATCH', body }));
      toast.ok(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Support mode: opens this dealership in the Dealership Portal app (new tab), logged in as you.
  // The token travels in the # part of the address, so it is never sent to a server.
  const openPortal = () => {
    const hash = new URLSearchParams({ token: auth.token(), tenant: t.id }).toString();
    window.open(`${DEALER_PORTAL_URL}/support#${hash}`, '_blank', 'noopener');
  };

  return (
    <>
      <PageHeader
        back="/platform/dealers"
        title={
          <span className="flex items-center gap-3">
            {data.settings.name || t.name} <StatusBadge status={t.status} />
          </span>
        }
        desc={
          <>
            {t.dealerCode} · {t.id} · design <b>{t.themeId}</b> ({t.channel.toLowerCase()}
            {t.themePin && `, pinned ${t.themePin}`}) · {t.domains.map((d: any) => d.domain).join(', ') || 'no domain'}
          </>
        }
        actions={
          <>
            <LinkButton href={site} target="_blank" variant="secondary">
              <ExternalLink className="h-4 w-4" /> Website
            </LinkButton>
            <Button variant="secondary" onClick={openPortal}>
              <LogIn className="h-4 w-4" /> Open Dealership Portal
            </Button>
            {t.status === 'ACTIVE' ? (
              <Button variant="danger" loading={busy} onClick={() => confirm('Suspend this dealership? Its website goes offline and logins stop working.') && update({ status: 'SUSPENDED' }, 'Suspended')}>
                <Ban className="h-4 w-4" /> Suspend
              </Button>
            ) : (
              <Button variant="success" loading={busy} onClick={() => update({ status: 'ACTIVE' }, 'Activated')}>
                <CheckCircle2 className="h-4 w-4" /> Activate
              </Button>
            )}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'business', label: 'Business details' },
          { id: 'team', label: `Team (${data.users.length})` },
          { id: 'settings', label: 'Settings' },
          { id: 'designs', label: 'Design licences' },
          { id: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="For sale" value={data.vehicles.PUBLISHED || 0} sub={`${data.vehicles.DRAFT || 0} drafts · ${data.vehicles.SOLD || 0} sold`} />
          <Stat label="Inventory value" value={money(data.inventoryValue)} />
          <Stat label="Inquiries" value={Object.values<number>(data.leads).reduce((a, b) => a + b, 0)} sub={`${data.leads.UNREAD || 0} unread`} />
          <Stat label="CarGurus waiting" value={data.cargurusPending} sub={data.cargurusPending ? 'needs your approval' : ''} />
          <Card title="Features" className="sm:col-span-2">
            {Object.entries<boolean>(data.features).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 text-sm">
                <span className="capitalize">{k}</span> {v ? <Badge color="green">On</Badge> : <Badge>Off</Badge>}
              </div>
            ))}
          </Card>
          <Card title="Notes" className="sm:col-span-2">
            <p className="text-sm text-slate-600">{t.notes || '—'}</p>
            <p className="mt-2 text-xs text-slate-400">Created {dateTime(t.createdAt)}</p>
          </Card>
        </div>
      )}

      {tab === 'business' && (
        <Card>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ['Name', data.settings.name],
              ['Phone', data.settings.phone],
              ['Email', data.settings.email],
              ['Inquiries to', data.settings.leadTo],
              ['Address', [data.settings.street, data.settings.city, data.settings.state, data.settings.zip].filter(Boolean).join(', ')],
              ['Hours', data.settings.hoursShort],
              ['Website address', data.settings.siteUrl],
              ['Own SMTP', data.settings.smtpHost || 'platform mail server'],
              ['CarGurus FTP', data.settings.cargurusFtpHost || '—'],
              ['Feed key', data.settings.feedToken?.set ? 'set' : 'not set'],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-medium text-slate-800">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">To edit, use “Open Dealership Portal”.</p>
        </Card>
      )}

      {tab === 'team' && (
        <Card pad={false}>
          <Table head={['Person', 'Role', 'Source', 'Last login', 'Status', '']}>
            {data.users.map((u: any) => (
              <tr key={u.id}>
                <Td>
                  <b>{u.name || u.login}</b>
                  <div className="text-xs text-slate-500">{u.login}</div>
                </Td>
                <Td>{u.role}</Td>
                <Td className="text-xs">{u.source}</Td>
                <Td className="text-xs">{ago(u.lastLoginAt)}</Td>
                <Td>{u.disabled ? <Badge color="red">Disabled</Badge> : <Badge color="green">Active</Badge>}</Td>
                <Td>
                  <LinkButton size="sm" variant="secondary" href={`/platform/accounts?open=${u.id}`}>
                    Manage
                  </LinkButton>
                </Td>
              </tr>
            ))}
          </Table>
          <p className="px-5 py-3 text-xs text-slate-500">Add or change roles from the Dealership Portal (Team & permissions).</p>
        </Card>
      )}

      {tab === 'settings' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Identity & domains" actions={<Button size="sm" loading={busy} onClick={() => update({ name: f.name, dealerCode: f.dealerCode, domains: f.domains, notes: f.notes })}>Save</Button>}>
            <div className="space-y-4">
              <Field label="Name">
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label="Dealer ID" hint="Used in the CarGurus feed. Change it to the account id CarGurus assigns, if any.">
                <Input value={f.dealerCode} onChange={(e) => setF({ ...f, dealerCode: e.target.value })} className="font-mono" />
              </Field>
              <Field label="Domains" hint="Comma separated. The first one is the main domain.">
                <Input value={f.domains} onChange={(e) => setF({ ...f, domains: e.target.value })} />
              </Field>
              <Field label="Internal note">
                <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </Field>
            </div>
          </Card>
          <Card title="Design release" actions={<Button size="sm" loading={busy} onClick={() => update({ themeId: f.themeId, channel: f.channel, themePin: f.themePin })}>Save</Button>}>
            <div className="space-y-4">
              <Field label="Design">
                <Select value={f.themeId} onChange={(e) => setF({ ...f, themeId: e.target.value })}>
                  {themes.data?.themes.map((th: any) => (
                    <option key={th.id} value={th.id}>
                      {th.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Release channel" hint="Beta dealers get new design versions first.">
                <Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
                  <option value="STABLE">Stable</option>
                  <option value="BETA">Beta</option>
                </Select>
              </Field>
              <Field label="Pin to version" hint="Empty = follow the channel.">
                <Input value={f.themePin} onChange={(e) => setF({ ...f, themePin: e.target.value })} placeholder="1.0.0" />
              </Field>
            </div>
          </Card>
          <Card title="Feature flags" actions={<Button size="sm" loading={busy} onClick={() => update({ features: f.features })}>Save</Button>}>
            <div className="space-y-3">
              {['facebook', 'cargurus', 'blog'].map((k) => (
                <Toggle key={k} checked={!!f.features[k]} onChange={(v) => setF({ ...f, features: { ...f.features, [k]: v } })} label={k.charAt(0).toUpperCase() + k.slice(1)} />
              ))}
            </div>
          </Card>
          <Card title="Danger zone">
            <p className="mb-3 text-sm text-slate-600">Deleting removes the dealership and all its data (vehicles, inquiries, logins) from the database. This cannot be undone.</p>
            <Button variant="danger" onClick={() => setDelOpen(true)}>
              Delete dealership
            </Button>
          </Card>
        </div>
      )}

      {tab === 'designs' && (
        <Card pad={false}>
          <Table head={['Design', 'Price', 'Access', '']}>
            {themes.data?.themes.map((th: any) => {
              const lic = data.licenses.find((l: any) => l.themeId === th.id);
              return (
                <tr key={th.id}>
                  <Td>
                    <b>{th.name}</b> {th.id === t.themeId && <Badge color="blue">Active</Badge>}
                  </Td>
                  <Td>{th.priceLabel}</Td>
                  <Td>{!th.paid ? <Badge>Free</Badge> : lic ? <Badge color="green">Unlocked</Badge> : <Badge color="amber">Locked</Badge>}</Td>
                  <Td className="text-right">
                    {th.paid &&
                      (lic ? (
                        <Button size="sm" variant="secondary" onClick={async () => { await api(`/platform/tenants/${id}/licenses/${th.id}`, { method: 'DELETE' }); reload(); }}>
                          <Lock className="h-3.5 w-3.5" /> Lock
                        </Button>
                      ) : (
                        <Button size="sm" onClick={async () => { await api(`/platform/tenants/${id}/licenses/${th.id}`, { method: 'POST' }); reload(); }}>
                          <Unlock className="h-3.5 w-3.5" /> Unlock
                        </Button>
                      ))}
                  </Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {tab === 'activity' && (
        <Card pad={false}>
          <Table head={['When', 'Action', 'By', 'Details']}>
            {activity.data?.items.map((a: any) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-xs">{dateTime(a.createdAt)}</Td>
                <Td className="font-mono text-xs">{a.action}</Td>
                <Td className="text-xs">{a.actor}</Td>
                <Td className="max-w-md truncate font-mono text-[11px] text-slate-500">{a.detail ? JSON.stringify(a.detail) : ''}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Modal
        open={delOpen}
        onClose={() => setDelOpen(false)}
        title="Delete dealership"
        footer={
          <Button
            variant="danger"
            disabled={del !== t.id}
            onClick={async () => {
              try {
                await api(`/platform/tenants/${id}?confirm=${encodeURIComponent(del)}`, { method: 'DELETE' });
                toast.ok('Dealership deleted');
                router.replace('/platform/dealers');
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Delete forever
          </Button>
        }
      >
        <p className="mb-3">
          Type <b className="font-mono">{t.id}</b> to confirm.
        </p>
        <Input value={del} onChange={(e) => setDel(e.target.value)} />
      </Modal>
    </>
  );
}
