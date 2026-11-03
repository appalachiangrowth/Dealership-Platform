'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Sparkles, FileText, Settings2, Square, Store, ExternalLink, MoreHorizontal, Pencil, AlertTriangle, Monitor, Loader2 } from 'lucide-react';
import { mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { fb, useFb } from '@/lib/facebook';
import { Badge, Button, Card, Drawer, Empty, Field, Input, Modal, Select, Stat, Textarea, Toggle, cx, ErrorBox, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';
import { FbActivity } from '@/components/fb/FbChrome';

type Listing = {
  status: string; url: string; fbId: string; postedPrice: number | null; error: string; publishedAt: string | null; checkedAt: string | null;
  postedBy: string; mine: boolean; history: { at: string; note: string }[];
};
type Copy = { title: string; description: string; hashtags: string; copySource: string; fbCondition: string; cleanTitle: boolean };
type V = {
  id: string; status: string; title: string; year: number | null; make: string; model: string; trim: string; stock: string; vin: string;
  price: number | null; mileage: number | null; photo: string; photos: number; missing: string[]; copy: Copy; listing: Listing; queued: boolean;
};
type Data = { vehicles: V[]; publishedToday: number; dailyLimit: number; autoPublish: string; active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[] };
type Settings = {
  titleTemplate: string; descriptionTemplate: string; defaultHashtags: string; disclaimer: string; dailyLimit: number; autoPublish: string; gapSeconds: number;
  aiProvider: string; aiModel: string; aiKey: string; dealerName: string; phone: string; address: string; city: string; website: string;
};

const STATUS: Record<string, { color: string; text: string }> = {
  none: { color: 'slate', text: 'Not listed' },
  queued: { color: 'blue', text: 'Queued' },
  publishing: { color: 'blue', text: 'Publishing…' },
  awaiting_publish: { color: 'amber', text: 'Needs you' },
  published: { color: 'green', text: 'Published' },
  unconfirmed: { color: 'amber', text: 'Unconfirmed' },
  failed: { color: 'red', text: 'Failed' },
  sold: { color: 'violet', text: 'Sold' },
  removed: { color: 'slate', text: 'Removed' },
};
const FILTERS = [
  ['instock', 'In stock (not sold)'],
  ['all', 'All vehicles'],
  ['notlisted', 'Not on Marketplace yet'],
  ['listed', 'On Marketplace'],
  ['problems', 'Needs attention'],
  ['soldlisted', 'Sold here, still on Facebook'],
] as const;
const money = (n: number | null) => (n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('en-US'));

export default function MarketplacePage() {
  const { state, setViewOpen } = useFb();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<Data>('/dealer/facebook/mp/vehicles');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('instock');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState('');
  const [edit, setEdit] = useState<V | null>(null);
  const [paste, setPaste] = useState<V | null>(null);
  const [priceFor, setPriceFor] = useState<V | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // keep the list fresh while something is happening
  const mpBusy = !!(state?.mp.running || state?.mp.active || state?.mp.queue.length);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (!mpBusy) {
      // finished: one last refresh
      if (wasBusy.current) void reload();
      wasBusy.current = false;
      return;
    }
    wasBusy.current = true;
    const t = setInterval(() => void reload(), 3000);
    void reload();
    return () => clearInterval(t);
  }, [mpBusy, reload]);

  useEffect(() => {
    const close = () => setMenu('');
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.vehicles || []).filter((v) => {
      if (t && !`${v.title} ${v.stock} ${v.vin}`.toLowerCase().includes(t)) return false;
      const st = v.listing.status;
      if (filter === 'instock') return v.status !== 'SOLD';
      if (filter === 'notlisted') return ['none', 'failed', 'removed'].includes(st) && v.status !== 'SOLD';
      if (filter === 'listed') return ['published', 'unconfirmed', 'awaiting_publish', 'publishing', 'queued'].includes(st);
      if (filter === 'problems') return ['failed', 'unconfirmed', 'awaiting_publish'].includes(st) || (st === 'published' && v.listing.postedPrice !== null && v.price !== null && v.listing.postedPrice !== v.price);
      if (filter === 'soldlisted') return v.status === 'SOLD' && st === 'published';
      return true;
    });
  }, [data, q, filter]);

  const act = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(what);
    try {
      await fn();
      if (ok) toast.ok(ok);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const publish = (ids: string[]) =>
    act('publish', async () => {
      const r = await fb.post<{ queued: number; rejected: { id: string; error: string }[] }>('mp/publish', { ids });
      if (r.queued) {
        toast.ok(`${r.queued} vehicle${r.queued === 1 ? '' : 's'} queued for Marketplace.${data?.autoPublish === 'off' ? ' Open "Show browser" to press Publish.' : ''}`);
        setSel(new Set());
      }
      for (const x of r.rejected.slice(0, 4)) toast.error(x.error);
    });

  const bulkText = (ai: boolean) =>
    act('bulk' + ai, async () => {
      const ids = [...sel];
      const r = await fb.post<{ generated: number; errors: string[] }>('mp/generate-bulk', { ids, ai });
      toast.ok(`Listing text written for ${r.generated} vehicle${r.generated === 1 ? '' : 's'}.`);
      for (const e of r.errors.slice(0, 3)) toast.error(e);
    });

  const one = (v: V, path: string, body: unknown, ok: string) => act(path + v.id, () => fb.post(`mp/vehicles/${v.id}/${path}`, body), ok);
  const manual = (v: V, action: string, ok: string) => act('m' + v.id, () => fb.post(`mp/vehicles/${v.id}/listing`, { action }), ok);

  const allShown = list.length > 0 && list.every((v) => sel.has(v.id));
  const activeV = data?.active ? data.vehicles.find((v) => v.id === data.active!.vehicleId) : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="New listings today" value={`${data?.publishedToday ?? 0} / ${data?.dailyLimit ?? 5}`} sub="daily limit for your Facebook login" />
        <Stat label="Publishing" value={data?.autoPublish === 'off' ? 'You click Publish' : 'Automatic'} sub={data?.autoPublish === 'off' ? 'the form is filled, you press Publish' : 'Next + Publish are clicked for you'} />
        <Stat label="Queue" value={data?.queue.length ?? 0} sub={state?.mp.running ? 'working…' : 'one vehicle at a time'} />
        <Stat
          label="Now"
          value={<span className="text-base">{activeV ? activeV.title : '—'}</span>}
          sub={data?.active ? `${data.active.action}${state?.busyWhat === 'Marketplace' ? '' : ''}` : 'nothing running'}
        />
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search year, make, model, stock, VIN…" className="pl-9" />
          </div>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
            {FILTERS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Button variant="success" disabled={!sel.size} loading={busy === 'publish'} onClick={() => publish([...sel])}>
            <Store className="h-4 w-4" /> Post to Marketplace{sel.size ? ` (${sel.size})` : ''}
          </Button>
          <Button variant="secondary" size="sm" disabled={!sel.size} loading={busy === 'bulkfalse'} onClick={() => bulkText(false)} title="Write the listing text from your template">
            <FileText className="h-3.5 w-3.5" /> Template
          </Button>
          <Button variant="secondary" size="sm" disabled={!sel.size} loading={busy === 'bulktrue'} onClick={() => bulkText(true)} title="Write the listing text with AI">
            <Sparkles className="h-3.5 w-3.5" /> AI
          </Button>
          {mpBusy && (
            <Button variant="danger" size="sm" loading={busy === 'stop'} onClick={() => act('stop', () => fb.post('mp/stop'), 'Marketplace stopped.')}>
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" /> Settings
          </Button>
        </div>

        {data?.vehicles.some((v) => v.listing.status === 'awaiting_publish') && (
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4" /> A listing is waiting for you: fix the fields Facebook shows, then press Facebook&apos;s Next and Publish.
            <Button size="sm" variant="secondary" onClick={() => setViewOpen(true)}>
              <Monitor className="h-3.5 w-3.5" /> Show browser
            </Button>
          </div>
        )}

        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-5">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : !list.length ? (
          <Empty title="No vehicles here" desc={data?.vehicles.length ? 'Try another filter or search.' : 'Add vehicles in Inventory first; they show up here ready for Marketplace.'} icon={<Store className="h-6 w-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <input type="checkbox" checked={allShown} onChange={() => setSel(allShown ? new Set() : new Set(list.map((v) => v.id)))} className="h-4 w-4 accent-blue-700" />
                  </th>
                  <th className="px-2 py-2.5">Vehicle</th>
                  <th className="px-3 py-2.5">Price</th>
                  <th className="px-3 py-2.5">Marketplace</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((v) => {
                  const l = v.listing;
                  const s = STATUS[l.status] || { color: 'slate', text: l.status };
                  const working = data?.active?.vehicleId === v.id;
                  const priceDiff = l.status === 'published' && l.postedPrice !== null && v.price !== null && l.postedPrice !== v.price;
                  return (
                    <tr key={v.id} className={cx('align-top', working && 'bg-blue-50/60')}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={sel.has(v.id)}
                          onChange={() =>
                            setSel((x) => {
                              const n = new Set(x);
                              if (n.has(v.id)) n.delete(v.id);
                              else n.add(v.id);
                              return n;
                            })
                          }
                          className="h-4 w-4 accent-blue-700"
                        />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex gap-3">
                          {v.photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={mediaUrl(v.photo)} alt="" className="h-14 w-20 shrink-0 rounded-md object-cover" />
                          ) : (
                            <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] text-slate-400">no photo</div>
                          )}
                          <div className="min-w-0">
                            <Link href={`/dealer/inventory/${v.id}`} className="font-semibold text-slate-900 hover:underline">
                              {v.title || 'Untitled vehicle'}
                            </Link>
                            <div className="text-xs text-slate-500">
                              {[v.stock && `#${v.stock}`, v.vin, v.mileage !== null && `${v.mileage.toLocaleString('en-US')} mi`, `${v.photos} photo${v.photos === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {v.status !== 'PUBLISHED' && <Badge color={v.status === 'SOLD' ? 'violet' : 'slate'}>{v.status === 'SOLD' ? 'Sold in inventory' : 'Draft'}</Badge>}
                              {!!v.missing.length && (
                                <Badge color="amber">
                                  <AlertTriangle className="h-3 w-3" /> missing {v.missing.join(', ')}
                                </Badge>
                              )}
                              {v.copy.title ? <Badge color="slate">text: {v.copy.copySource || 'manual'}</Badge> : <Badge color="slate">no text yet</Badge>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="font-semibold">{money(v.price)}</div>
                        {priceDiff && (
                          <button onClick={() => setPriceFor(v)} className="mt-0.5 text-xs font-semibold text-amber-700 underline">
                            FB shows {money(l.postedPrice)} · update
                          </button>
                        )}
                      </td>
                      <td className="max-w-[320px] px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge color={s.color}>
                            {working && <Loader2 className="h-3 w-3 animate-spin" />}
                            {v.queued && l.status !== 'queued' ? 'Queued' : s.text}
                          </Badge>
                          {l.url && (
                            <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {v.status === 'SOLD' && l.status === 'published' && <Badge color="amber">sold here, still listed</Badge>}
                        </div>
                        {l.error && <div className="mt-1 text-xs text-red-600">{l.error}</div>}
                        {!l.mine && <div className="mt-1 text-xs text-slate-500">Posted with another team member&apos;s Facebook login.</div>}
                        {l.publishedAt && <div className="mt-0.5 text-[11px] text-slate-400">listed {new Date(l.publishedAt).toLocaleDateString()}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <div className="relative inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {['none', 'failed', 'removed'].includes(l.status) && (
                            <Button size="sm" variant="success" loading={busy === 'publish'} onClick={() => publish([v.id])}>
                              Post
                            </Button>
                          )}
                          <Button size="sm" variant="secondary" onClick={() => setEdit(v)}>
                            <Pencil className="h-3.5 w-3.5" /> Text
                          </Button>
                          <button onClick={() => setMenu(menu === v.id ? '' : v.id)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menu === v.id && (
                            <div className="absolute right-0 top-9 z-20 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left text-sm shadow-xl">
                              {l.fbId && l.mine && <MenuItem onClick={() => setPriceFor(v)}>Update price on Facebook</MenuItem>}
                              {l.url && l.mine && <MenuItem onClick={() => one(v, 'remove', { mode: 'sold' }, 'Queued: mark as sold on Facebook.')}>Mark as sold on Facebook</MenuItem>}
                              {l.url && l.mine && <MenuItem onClick={() => one(v, 'remove', { mode: 'delete' }, 'Queued: delete from Facebook.')}>Delete from Facebook</MenuItem>}
                              {l.url && <MenuItem onClick={() => one(v, 'verify', {}, 'Queued: check the listing on Facebook.')}>Check listing on Facebook</MenuItem>}
                              <MenuItem onClick={() => setPaste(v)}>Paste listing link</MenuItem>
                              <div className="my-1 border-t border-slate-100" />
                              <MenuItem onClick={() => manual(v, 'mark_sold', 'Marked as sold.')}>Mark sold (I did it myself)</MenuItem>
                              <MenuItem onClick={() => manual(v, 'mark_removed', 'Marked as removed.')}>Mark removed (I did it myself)</MenuItem>
                              <MenuItem onClick={() => manual(v, 'reset', 'Listing record cleared.')} danger>
                                Clear listing record
                              </MenuItem>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          How it works: the poster opens Facebook&apos;s “Create vehicle listing” form in your Facebook browser, fills every field and uploads the photos (Facebook uses the first
          20), then {data?.autoPublish === 'off' ? 'waits for you to press Next and Publish' : 'presses Next and Publish'}. It then finds the new listing in “Your listings” and saves
          its real link. A listing is only marked Published when its link was found; otherwise it says Unconfirmed and you can paste the link.
        </div>
      </Card>

      <FbActivity />

      {edit && <EditCopy v={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} onSaved={reload} />}

      <PasteLink v={paste} onClose={() => setPaste(null)} onSaved={reload} />
      <PriceModal v={priceFor} onClose={() => setPriceFor(null)} onSaved={reload} />
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('block w-full px-4 py-2 text-left hover:bg-slate-50', danger ? 'text-red-600' : 'text-slate-700')}>
      {children}
    </button>
  );
}

/** Listing text: title, description, hashtags, Facebook condition, clean title + preview */
function EditCopy({ v, onClose, onSaved }: { v: V; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [c, setC] = useState<Copy>(v.copy);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState('');

  const loadPreview = async () => setPreview((await fb.get<{ text: string }>(`mp/vehicles/${v.id}/preview`)).text);
  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = async (ai: boolean) => {
    setBusy(ai ? 'ai' : 'tpl');
    try {
      const r = await fb.post<{ copy: { title: string; description: string; hashtags: string; source: string } }>(`mp/vehicles/${v.id}/generate`, { ai });
      setC((x) => ({ ...x, title: r.copy.title, description: r.copy.description, hashtags: r.copy.hashtags, copySource: r.copy.source }));
      await loadPreview();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      await fb.put(`mp/vehicles/${v.id}`, { title: c.title, description: c.description, hashtags: c.hashtags, fbCondition: c.fbCondition, cleanTitle: c.cleanTitle });
      toast.ok('Saved.');
      await loadPreview();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={`Listing text · ${v.title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} loading={busy === 'save'}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === 'tpl'} onClick={() => write(false)}>
            <FileText className="h-3.5 w-3.5" /> Write from template
          </Button>
          <Button size="sm" variant="secondary" loading={busy === 'ai'} onClick={() => write(true)}>
            <Sparkles className="h-3.5 w-3.5" /> Write with AI
          </Button>
          <span className="self-center text-xs text-slate-500">Vehicle details (price, mileage, colours, photos) come from Inventory.</span>
        </div>
        <Field label="Title (first line of the description)">
          <Input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Description">
          <Textarea value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} rows={10} />
        </Field>
        <Field label="Hashtags">
          <Input value={c.hashtags} onChange={(e) => setC({ ...c, hashtags: e.target.value })} placeholder="#usedcars #honda" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Facebook condition" hint="Empty = Excellent for new / certified cars, Good for used.">
            <Select value={c.fbCondition} onChange={(e) => setC({ ...c, fbCondition: e.target.value })}>
              <option value="">Automatic</option>
              {['Excellent', 'Very good', 'Good', 'Fair', 'Poor'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <div className="pt-5">
            <Toggle checked={c.cleanTitle} onChange={(x) => setC({ ...c, cleanTitle: x })} label="Clean title" />
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview: text posted to Facebook (after Save)</div>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-sans text-sm text-slate-700">{preview || '—'}</pre>
        </div>
        {!!v.listing.history.length && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Marketplace history</div>
            <ul className="space-y-1 text-xs text-slate-600">
              {v.listing.history.map((h, i) => (
                <li key={i}>
                  <span className="text-slate-400">{new Date(h.at).toLocaleString()}</span> · {h.note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function PasteLink({ v, onClose, onSaved }: { v: V | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={!!v}
      onClose={onClose}
      title="Paste the Marketplace link"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await fb.post(`mp/vehicles/${v!.id}/listing`, { action: 'set_url', url });
                toast.ok('Link saved. The listing is marked Published.');
                setUrl('');
                onClose();
                onSaved();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save link
          </Button>
        </>
      }
    >
      <Field label={v?.title || ''} hint="Open the listing on Facebook and copy the address, e.g. https://www.facebook.com/marketplace/item/1234567890/">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.facebook.com/marketplace/item/…" />
      </Field>
    </Modal>
  );
}

function PriceModal({ v, onClose, onSaved }: { v: V | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (v) setPrice(String(v.price ?? ''));
  }, [v]);
  return (
    <Modal
      open={!!v}
      onClose={onClose}
      title="Update the price on Facebook"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await fb.post(`mp/vehicles/${v!.id}/update-listing`, { price });
                toast.ok('Queued: the new price is typed into Facebook. Press Facebook’s Update button in the browser view if asked.');
                onClose();
                onSaved();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Update on Facebook
          </Button>
        </>
      }
    >
      <Field label="New price ($)" hint={`Inventory price: ${money(v?.price ?? null)} · Facebook now: ${money(v?.listing.postedPrice ?? null)}`}>
        <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
    </Modal>
  );
}

function SettingsDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data, error } = useApi<{ settings: Settings }>('/dealer/facebook/mp/settings');
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  const set = (k: keyof Settings, v: string | number) => setS((x) => (x ? { ...x, [k]: v } : x));

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      await fb.put('mp/settings', s);
      toast.ok('Marketplace settings saved.');
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title="Marketplace settings"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!s}>
            Save settings
          </Button>
        </>
      }
    >
      {error && <ErrorBox error={error} />}
      {!s ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            Dealer name, phone, address and website come from <Link href="/dealer/business" className="font-semibold underline">Business details</Link>: {s.dealerName || '—'} · {s.phone || '—'} ·{' '}
            {[s.address, s.city].filter(Boolean).join(', ') || '—'}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Max new listings per day">
              <Input type="number" min={1} max={100} value={s.dailyLimit} onChange={(e) => set('dailyLimit', Number(e.target.value))} />
            </Field>
            <Field label="Pause between listings (s)">
              <Input type="number" min={10} max={900} value={s.gapSeconds} onChange={(e) => set('gapSeconds', Number(e.target.value))} />
            </Field>
            <div className="pt-5">
              <Toggle checked={s.autoPublish !== 'off'} onChange={(v) => set('autoPublish', v ? 'on' : 'off')} label="Publish automatically" desc="Off: the form is filled and you press Publish." />
            </div>
          </div>
          <Field label="Title template" hint="Tokens: {year} {make} {model} {trim} {price} {mileage} {body} {exterior} {interior}">
            <Input value={s.titleTemplate} onChange={(e) => set('titleTemplate', e.target.value)} />
          </Field>
          <Field
            label="Description template"
            hint="Also {transmission} {fuel} {drivetrain} {engine} {features} {features_block} {stock} {vin} {dealer_name} {dealer_phone} {dealer_address} {dealer_website}. Lines whose tokens are all empty are left out."
          >
            <Textarea value={s.descriptionTemplate} onChange={(e) => set('descriptionTemplate', e.target.value)} rows={10} className="font-mono text-xs" />
          </Field>
          <Field label="Default hashtags">
            <Input value={s.defaultHashtags} onChange={(e) => set('defaultHashtags', e.target.value)} />
          </Field>
          <Field label="Disclaimer (added at the end of every listing)">
            <Input value={s.disclaimer} onChange={(e) => set('disclaimer', e.target.value)} placeholder="Price excludes tax, title and fees." />
          </Field>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-3 text-sm font-bold text-slate-800">AI writer (optional)</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Provider">
                <Select value={s.aiProvider} onChange={(e) => set('aiProvider', e.target.value)}>
                  <option value="none">Off (use template)</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                </Select>
              </Field>
              <Field label="Model" hint="blank = default">
                <Input value={s.aiModel} onChange={(e) => set('aiModel', e.target.value)} />
              </Field>
              <Field label="API key" hint="Stored for this dealership only; never shown again.">
                <Input value={s.aiKey} onChange={(e) => set('aiKey', e.target.value)} type="password" autoComplete="off" />
              </Field>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
