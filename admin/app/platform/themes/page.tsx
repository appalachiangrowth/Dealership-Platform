'use client';

import { useEffect, useState } from 'react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Field, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, Tabs, Td, Textarea, Toggle } from '@/components/ui';
import { dateTime } from '@/lib/format';
import { ThemeInstall } from '@/components/ThemeInstall';
import { AddCustomTheme, VisibilityControl } from '@/components/CustomTheme';
import { Globe, Lock, Plus } from 'lucide-react';

export default function ThemesPage() {
  const { data, setData, loading } = useApi('/platform/themes');
  const requests = useApi('/platform/theme-requests');
  const settings = useApi('/platform/settings');
  const toast = useToast();
  const [tab, setTab] = useState('themes');
  const [edit, setEdit] = useState<any>(null);
  const [release, setRelease] = useState({ version: '', notes: '' });
  const [payment, setPayment] = useState<string | null>(null);
  // "Delete theme" confirmation
  const [del, setDel] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  // Add New Custom Theme panel
  const [adding, setAdding] = useState(false);

  if (loading || !data) return <Loading />;
  const pending = requests.data?.filter((r: any) => r.status === 'PENDING').length || 0;

  async function save() {
    try {
      const { paid, price, currency, billing, priceNote, enabled, stableVersion, betaVersion, name, description, isPrivate, allowedTenantIds } = edit;
      if (isPrivate && !allowedTenantIds?.length) return toast.error('Choose at least one dealership for a private theme, or make it public.');
      setData(
        await api(`/platform/themes/${edit.id}`, {
          method: 'PATCH',
          body: { paid, price, currency, billing, priceNote, enabled, stableVersion, betaVersion, name, description, isPrivate: !!isPrivate, allowedTenantIds: isPrivate ? allowedTenantIds : [] },
        }),
      );
      toast.ok('Theme saved');
      setEdit(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Themes & releases"
        desc="Website themes, their prices and version releases. Dealers on the Beta channel get the beta version; a dealer can be pinned to a version. Private themes are shown only to the dealerships they are assigned to."
        actions={
          <Button onClick={() => setAdding(true)} className="bg-violet-600 hover:bg-violet-700">
            <Plus className="h-4 w-4" /> Add New Custom Theme
          </Button>
        }
      />
      <AddCustomTheme open={adding} onClose={() => setAdding(false)} onDone={(r) => setData(r)} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'themes', label: 'Themes' },
          { id: 'install', label: 'Install & switch' },
          { id: 'requests', label: `Unlock requests${pending ? ` (${pending})` : ''}` },
          { id: 'payment', label: 'Payment instructions' },
          { id: 'storefront', label: 'Storefront features' },
        ]}
      />
      {tab === 'storefront' && <StorefrontFeatures />}
      {tab === 'themes' && (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {data.themes.map((t: any) => (
            <Card key={t.id} pad={false}>
              {t.previewUrl ? (
                <img src={mediaUrl(t.previewUrl)} alt="" className="aspect-[16/9] w-full rounded-t-2xl object-cover" />
              ) : (
                <div className="flex aspect-[16/9] w-full items-center justify-center rounded-t-2xl bg-slate-100 text-sm text-slate-400">No preview picture</div>
              )}
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-bold">{t.name}</h3>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {t.isPrivate ? (
                      <Badge color="violet">
                        <Lock className="h-3 w-3" /> Private
                      </Badge>
                    ) : (
                      <Badge color="slate">
                        <Globe className="h-3 w-3" /> Public
                      </Badge>
                    )}
                    {t.enabled ? <Badge color="green">Enabled</Badge> : <Badge>Hidden</Badge>}
                  </span>
                </div>
                {t.isPrivate && (
                  <p className="mt-1 text-xs text-violet-700">
                    Only for: <b>{t.allowedTenants?.length ? t.allowedTenants.map((a: any) => a.name).join(', ') : 'no dealership yet'}</b>
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  {t.installed?.length > 0 && <>Installed {t.installed.join(', ')} · </>}
                  Stable <b>{t.stableVersion}</b>
                  {t.betaVersion && <> · Beta <b>{t.betaVersion}</b></>} · {t.dealers} dealers · {t.priceLabel} · {t.licenses} licences
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ ...t })}>
                    Edit price, release & visibility
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={t.id === 'classic' || t.dealers > 0}
                    title={
                      t.id === 'classic'
                        ? 'Classic is the theme new dealerships start with — hide it instead'
                        : t.dealers > 0
                          ? `${t.dealers} dealership${t.dealers === 1 ? ' uses' : 's use'} this theme: switch ${t.dealers === 1 ? 'it' : 'them'} first (Install & switch)`
                          : 'Delete this theme'
                    }
                    onClick={() => setDel(t)}
                  >
                    Delete
                  </Button>
                </div>
                {t.dealers > 0 && t.id !== 'classic' && (
                  <p className="mt-1.5 text-[11px] text-slate-400">To delete it, switch its {t.dealers} dealership{t.dealers === 1 ? '' : 's'} to another theme first.</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab === 'install' && (
        <ThemeInstall
          themes={data.themes}
          onChanged={async () => setData(await api('/platform/themes'))}
        />
      )}
      {tab === 'requests' && (
        <Card pad={false}>
          <Table head={['Dealership', 'Theme', 'Price', 'Requested', 'Message', 'Status', '']}>
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
                          toast.ok('Theme unlocked for the dealer');
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
        <Card className="max-w-2xl" title="How dealers pay for a theme">
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
      <Modal
        open={!!del}
        onClose={() => !deleting && setDel(null)}
        title={`Delete ${del?.name || 'theme'}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  const r = await api(`/platform/themes/${del.id}`, { method: 'DELETE' });
                  toast.ok(r?.message || 'Theme deleted');
                  setDel(null);
                  setData(await api('/platform/themes'));
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              Delete theme
            </Button>
          </>
        }
      >
        {del && (
          <div className="space-y-2 text-sm">
            <p>
              <b>{del.name}</b> is removed from the platform for good: its files ({del.installed?.length ? `versions ${del.installed.join(', ')}` : 'all versions'}), its price,
              {del.licenses ? ` ${del.licenses} unlocked licence${del.licenses === 1 ? '' : 's'},` : ''} its unlock requests and the colours dealers saved for it.
            </p>
            <p className="text-slate-500">No dealership uses it now. This cannot be undone — to bring it back you would install its ZIP again.</p>
          </div>
        )}
      </Modal>
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
            <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Show in the dealers’ theme gallery" />
            <Field label="Description">
              <Textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-800">Visibility & dealership assignment</div>
              <VisibilityControl
                isPrivate={!!edit.isPrivate}
                ids={edit.allowedTenantIds || []}
                onChange={(v) => setEdit({ ...edit, isPrivate: v.isPrivate, allowedTenantIds: v.ids })}
              />
              {edit.isPrivate && edit.dealers > 0 && (
                <p className="mt-2 text-xs text-slate-500">A dealership that already uses this theme keeps it, even if it is not on the list.</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <Toggle checked={edit.paid} onChange={(v) => setEdit({ ...edit, paid: v })} label="Paid theme" desc="Dealers can preview it but must request it before using it." />
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
              <p className="mt-2 text-xs text-slate-500">A release records a new version of the theme’s code in frontend/themes/{edit.id}. Point Beta to it, test with one dealer, then point Stable to it.</p>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

/* ───────────────── Storefront features: Financing / Trade-In per dealership ───────────────── */

const STOREFRONT_FLAGS = [
  ['financing', 'Financing', 'Show or hide Financing links, sections, and calculator/application CTAs on the storefront.'],
  ['tradeIn', 'Trade-In', 'Show or hide Trade-In links, sections, and valuation CTAs on the storefront.'],
] as const;
type FlagKey = (typeof STOREFRONT_FLAGS)[number][0];

function StorefrontFeatures() {
  const toast = useToast();
  const tenants = useApi<any[]>('/platform/tenants');
  const settings = useApi('/platform/settings');
  const [id, setId] = useState('');
  const dealer = useApi(id ? `/platform/tenants/${encodeURIComponent(id)}` : null);
  const [draft, setDraft] = useState<Record<FlagKey, boolean>>({ financing: true, tradeIn: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id && tenants.data?.length) setId(tenants.data[0].id);
  }, [tenants.data, id]);
  useEffect(() => {
    const f = dealer.data?.features;
    if (f && dealer.data.tenant?.id === id) setDraft({ financing: f.financing !== false, tradeIn: f.tradeIn !== false });
  }, [dealer.data, id]);

  if (!tenants.data || !settings.data) return <Loading />;
  const defaults = settings.data.features || {};
  const effective = (t: any, k: FlagKey) => (typeof t.features?.[k] === 'boolean' ? t.features[k] : defaults[k] !== false);
  const current = dealer.data?.tenant?.id === id ? dealer.data : null;
  const dirty = !!current && STOREFRONT_FLAGS.some(([k]) => (current.features?.[k] !== false) !== draft[k]);

  async function save() {
    if (!current) return;
    setSaving(true);
    try {
      // only this dealership's own overrides are sent, so its other flags keep following the platform defaults
      await api(`/platform/tenants/${encodeURIComponent(id)}`, { method: 'PATCH', body: { features: { ...(current.featureOverrides || {}), ...draft } } });
      toast.ok(`Saved — live on ${current.tenant?.name || 'the website'} now.`);
      await Promise.all([dealer.reload(), tenants.reload()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card
        title="Dealership storefront"
        actions={
          <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>
            Save
          </Button>
        }
      >
        <div className="space-y-5">
          <Field label="Dealership">
            <Select value={id} onChange={(e) => setId(e.target.value)}>
              {tenants.data.map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          {!current ? (
            <Loading />
          ) : (
            STOREFRONT_FLAGS.map(([k, label, desc]) => (
              <Toggle key={k} checked={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} label={label} desc={desc} />
            ))
          )}
          <p className="text-xs text-slate-500">
            Off hides the feature on every page of this dealership&apos;s website (menus, footers, sections, vehicle-page buttons) and sends visitors of its pages to the home page.
          </p>
        </div>
      </Card>
      <Card title="All dealerships" pad={false}>
        <Table head={['Dealership', ...STOREFRONT_FLAGS.map((f) => f[1])]}>
          {tenants.data.map((t: any) => (
            <tr key={t.id} className={t.id === id ? 'bg-blue-50/60' : 'cursor-pointer hover:bg-slate-50'} onClick={() => setId(t.id)}>
              <Td className="font-semibold">{t.name}</Td>
              {STOREFRONT_FLAGS.map(([k]) => (
                <Td key={k}>
                  {effective(t, k) ? <Badge color="green">On</Badge> : <Badge color="red">Off</Badge>}
                  {typeof t.features?.[k] !== 'boolean' && <span className="ml-2 text-[11px] text-slate-400">default</span>}
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
