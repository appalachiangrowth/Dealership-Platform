'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brandRun, onBrandingChange } from '@/lib/branding';
import { useRouter } from 'next/navigation';
import { Car, ExternalLink, ImageIcon, Plus, Search, Star, Upload } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Button, ErrorBox, Input, LinkButton, Loading, Modal, PageHeader, Pagination, Select, cx } from '@/components/ui';
import { money, vehicleName } from '@/lib/format';
import { FacebookIcon, fb, getSavedFbPostingConfig, saveFbPostingConfig, type FbPostingConfig } from '@/lib/facebook';

type Issue = { field: string; label: string; msg: string };

const WEBSITE: Record<string, [string, string]> = {
  PUBLISHED: ['For sale', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  DRAFT: ['Draft', 'bg-slate-100 text-slate-600 ring-slate-200'],
  SOLD: ['Sold', 'bg-blue-50 text-blue-700 ring-blue-200'],
};

/** "CarGurus ready" / "CarGurus: N issues" (click → editor on the first field to fix) / "Not on CarGurus". */
function CgPill({ v, onFix }: { v: any; onFix: (field: string) => void }) {
  if (!v.cargurus) return <span className="whitespace-nowrap text-xs font-semibold text-slate-400" title="Only vehicles for sale go to CarGurus">Not on CarGurus</span>;
  const iss: Issue[] = v.cargurus.issues;
  if (!iss.length)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200" title="Meets every CarGurus requirement">
        <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> CarGurus ready
      </span>
    );
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onFix(iss[0].field);
      }}
      title={iss.map((x) => `• ${x.msg}`).join('\n') + '\n\nClick to fix'}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 ring-1 ring-red-200 hover:bg-red-100"
    >
      <i className="h-1.5 w-1.5 rounded-full bg-red-500" /> CarGurus: {iss.length} issue{iss.length === 1 ? '' : 's'}
    </button>
  );
}

export default function InventoryPage() {
  const [status, setStatus] = useState('');
  const [cg, setCg] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const toast = useToast();
  const router = useRouter();
  const { data, setData, loading, error, reload } = useApi(
    `/dealer/vehicles?status=${status}&cg=${cg}&q=${encodeURIComponent(q.trim())}&sort=${sort}&page=${page}&pageSize=50`,
  );

  const [fbVehicle, setFbVehicle] = useState<any>(null);
  const [fbConfig, setFbConfig] = useState<FbPostingConfig | null>(null);
  const [fbCaption, setFbCaption] = useState('');
  const [fbHashtags, setFbHashtags] = useState('');
  const [fbPosting, setFbPosting] = useState(false);
  const [fbLoadingText, setFbLoadingText] = useState(false);

  useEffect(() => {
    const cfg = getSavedFbPostingConfig();
    if (cfg) {
      setFbConfig(cfg);
    } else {
      fb.get<{ quickPost: FbPostingConfig }>('quick-config')
        .then((r) => {
          if (r.quickPost?.configured) {
            saveFbPostingConfig(r.quickPost);
            setFbConfig(r.quickPost);
          }
        })
        .catch(() => {});
    }
  }, []);

  async function openFbModal(v: any) {
    setFbVehicle(v);
    const cfg = getSavedFbPostingConfig() || fbConfig;
    setFbConfig(cfg);

    const name = vehicleName(v);
    const priceStr = v.price ? money(v.price) : '';
    const milesStr = v.mileage ? `${(Number(v.mileage) || 0).toLocaleString()} miles` : '';

    setFbLoadingText(true);
    setFbCaption(`🚗 ${name}\n${priceStr ? `💰 Price: ${priceStr}\n` : ''}${milesStr ? `📍 Mileage: ${milesStr}\n` : ''}Stock #: ${v.stockNumber || '—'}\n\nCall or visit us today!`);
    setFbHashtags(cfg?.hashtags || '#carsforsale #usedcars');

    try {
      const r = await fb.post<{ copy: { hashtags: string }; text: string; photos: string[] }>(`mp/vehicles/${v.id}/generate`, { ai: false, save: false });
      if (r?.text) {
        setFbCaption(r.text.replace(r.copy?.hashtags || '', '').replace(/\n{3,}/g, '\n\n').trim());
        if (r.copy?.hashtags) setFbHashtags(r.copy.hashtags);
      }
    } catch {
      // fallback caption already set
    } finally {
      setFbLoadingText(false);
    }
  }

  async function postVehicleToFacebook() {
    if (!fbVehicle || !fbConfig) return;
    const targets: string[] = [];
    const names: Record<string, string> = {};

    if (fbConfig.includePage && fbConfig.page?.url) {
      targets.push(fbConfig.page.url);
      names[fbConfig.page.url] = fbConfig.page.name || fbConfig.page.url;
    }
    for (const g of fbConfig.groups || []) {
      if (g.url && !targets.includes(g.url)) {
        targets.push(g.url);
        names[g.url] = g.name || g.url;
      }
    }

    if (!targets.length) {
      toast.error('No targets selected. Click "Change settings" to configure your Page and groups.');
      return;
    }

    setFbPosting(true);
    try {
      const form = new FormData();
      const order = fbVehicle.images.map((u: string) => `v:${u}`);
      form.append('targets', JSON.stringify(targets));
      form.append('names', JSON.stringify(names));
      form.append('order', JSON.stringify(order));
      form.append('caption', fbCaption || vehicleName(fbVehicle));
      form.append('hashtags', fbHashtags || '');
      form.append('delayMin', String(fbConfig.delayMin || 45));
      form.append('delayMax', String(fbConfig.delayMax || 90));

      await api('/dealer/facebook/post', { method: 'POST', form });
      toast.ok(`Posting to Facebook started for ${vehicleName(fbVehicle)}!`);
      setFbVehicle(null);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to start Facebook post.');
    } finally {
      setFbPosting(false);
    }
  }

  // photos that still need the branding bands are done in the background (progress pill at the bottom)
  useEffect(() => {
    void brandRun();
    return onBrandingChange(() => reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string, field?: string) => router.push(`/dealer/inventory/${id}${field ? `?focus=${encodeURIComponent(field)}` : ''}`);

  async function quick(v: any, body: Record<string, unknown>, msg: string) {
    // update the row at once, then save (like the old portal)
    setData({ ...data, items: data.items.map((x: any) => (x.id === v.id ? { ...x, ...body } : x)) });
    try {
      await api(`/dealer/vehicles/${v.id}`, { method: 'PATCH', body });
      toast.ok(msg);
    } catch (e) {
      toast.error((e as Error).message);
    }
    reload();
  }

  const counts = data?.counts || {};
  const all = (counts.PUBLISHED || 0) + (counts.DRAFT || 0) + (counts.SOLD || 0);
  const CG = !!data?.cargurusOn;
  const filtered = !!(status || cg || q.trim());

  return (
    <>
      <PageHeader
        title="Inventory"
        desc="Everything on your lot. Published vehicles appear on your website and feeds straight away; drafts and sold vehicles stay hidden."
        actions={
          <>
            <LinkButton href="/dealer/inventory/import" variant="secondary">
              <Upload className="h-4 w-4" /> Import CSV / XML
            </LinkButton>
            <LinkButton href="/dealer/inventory/new">
              <Plus className="h-4 w-4" /> Add vehicle
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-white p-1 text-xs font-semibold ring-1 ring-slate-200">
          {[
            ['', 'All', all],
            ['PUBLISHED', 'For sale', counts.PUBLISHED || 0],
            ['DRAFT', 'Drafts', counts.DRAFT || 0],
            ['SOLD', 'Sold', counts.SOLD || 0],
          ].map(([k, label, n]) => (
            <button
              key={k as string}
              onClick={() => {
                setStatus(k as string);
                setCg('');
                setPage(1);
              }}
              className={cx('rounded-md px-3 py-1.5', status === k && !cg ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-50')}
            >
              {label} <span className={status === k && !cg ? 'text-blue-200' : 'text-slate-400'}>{n}</span>
            </button>
          ))}
        </div>
        {CG && (
          <div className="flex rounded-lg bg-white p-1 text-xs font-semibold ring-1 ring-slate-200">
            {[
              ['', 'All inventory', null],
              ['ready', 'CarGurus ready', counts.cgReady || 0],
              ['bad', 'CarGurus excluded', counts.cgExcluded || 0],
            ].map(([k, label, n]) => (
              <button
                key={k as string}
                onClick={() => {
                  setCg(k as string);
                  if (k) setStatus('');
                  setPage(1);
                }}
                className={cx('rounded-md px-3 py-1.5', cg === k ? (k === 'bad' ? 'bg-red-600 text-white' : k === 'ready' ? 'bg-emerald-600 text-white' : 'bg-blue-700 text-white') : 'text-slate-600 hover:bg-slate-50')}
              >
                {label} {n !== null && <span className={cg === k ? 'text-white/70' : 'text-slate-400'}>{n as number}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            type="search"
            className="pl-9"
            placeholder="Search make, model, stock number or VIN"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
          <option value="newest">Newest first</option>
          <option value="price_desc">Price: high to low</option>
          <option value="price_asc">Price: low to high</option>
          <option value="year_desc">Year: newest</option>
          <option value="mileage_asc">Mileage: lowest</option>
        </Select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : !data.items.length ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Car className="mb-3 h-10 w-10 text-slate-300" />
            <b className="text-slate-900">{filtered ? 'No vehicle matches this filter' : 'Your lot is empty'}</b>
            <span className="mt-1 max-w-md text-sm text-slate-500">
              {filtered ? 'Try another search or status.' : 'Add your first vehicle with photos and a price, or import your whole inventory from a CSV, TSV or XML file.'}
            </span>
            {!filtered && (
              <div className="mt-4 flex gap-2">
                <LinkButton href="/dealer/inventory/new">
                  <Plus className="h-4 w-4" /> Add vehicle
                </LinkButton>
                <LinkButton href="/dealer/inventory/import" variant="secondary">
                  <Upload className="h-4 w-4" /> Import a file
                </LinkButton>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Vehicle</th>
                  <th className="px-4 py-3">Stock #</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Mileage</th>
                  <th className="px-4 py-3">Website</th>
                  {CG && <th className="px-4 py-3">CarGurus</th>}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((v: any) => {
                  const [stLabel, stCls] = WEBSITE[v.status] || WEBSITE.DRAFT;
                  return (
                    <tr key={v.id} className="cursor-pointer hover:bg-slate-50" onClick={() => open(v.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                            {v.images[0] ? <img src={mediaUrl(v.images[0])} alt="" loading="lazy" className="h-full w-full object-cover" /> : <ImageIcon className="h-4 w-4 text-slate-400" />}
                          </div>
                          <div className="min-w-0">
                            <b className="block truncate text-slate-900">{vehicleName(v)}</b>
                            <div className="text-xs text-slate-500">
                              {[v.bodyStyle, v.exteriorColor].filter(Boolean).join(' · ') || '—'} ·{' '}
                              {v.images.length ? `${v.images.length} photo${v.images.length === 1 ? '' : 's'}` : <span className="font-semibold text-amber-600">no photos</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{v.stockNumber || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{money(v.price)}</td>
                      <td className="px-4 py-3 text-right">{(Number(v.mileage) || 0).toLocaleString('en-US')} mi</td>
                      <td className="px-4 py-3">
                        <span className={cx('rounded-full px-2.5 py-1 text-xs font-bold ring-1', stCls)}>{stLabel}</span>
                      </td>
                      {CG && (
                        <td className="px-4 py-3">
                          <CgPill v={v} onFix={(f) => open(v.id, f)} />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          title={v.featured ? 'Featured on your home page' : 'Feature on your home page'}
                          onClick={() => quick(v, { featured: !v.featured }, v.featured ? 'Removed from featured' : 'Featured on your home page')}
                          className="mr-1 rounded-md p-1.5 hover:bg-slate-100"
                        >
                          <Star className={cx('h-4 w-4', v.featured ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
                        </button>
                        <Button
                          size="sm"
                          className="mr-1 inline-flex items-center gap-1 border-transparent bg-[#1877F2] text-xs font-bold text-white hover:bg-[#166fe5]"
                          onClick={() => openFbModal(v)}
                          title="Post to Facebook"
                        >
                          <FacebookIcon className="h-3.5 w-3.5" /> FB
                        </Button>
                        {v.status === 'PUBLISHED' ? (
                          <Button size="sm" variant="secondary" onClick={() => quick(v, { status: 'SOLD' }, 'Marked as sold - hidden from your website')}>
                            Mark sold
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              if (!v.images.length) {
                                toast.error('Add at least one photo before publishing.');
                                open(v.id, 'images');
                                return;
                              }
                              void quick(v, { status: 'PUBLISHED' }, 'Published - live on your website');
                            }}
                          >
                            Publish
                          </Button>
                        )}{' '}
                        <Link href={`/dealer/inventory/${v.id}`} className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </div>

      <Modal
        open={!!fbVehicle}
        onClose={() => !fbPosting && setFbVehicle(null)}
        title={
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1877F2] text-white">
              <FacebookIcon className="h-4 w-4" />
            </span>
            <span className="font-heading font-bold text-slate-900">Post to Facebook</span>
          </div>
        }
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFbVehicle(null);
                router.push('/dealer/facebook');
              }}
              disabled={fbPosting}
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              Change settings
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setFbVehicle(null)} disabled={fbPosting}>
                Cancel
              </Button>
              <Button
                className="border-transparent bg-[#1877F2] font-bold text-white hover:bg-[#166fe5]"
                loading={fbPosting}
                disabled={!fbConfig || (!fbConfig.page && !fbConfig.groups?.length)}
                onClick={postVehicleToFacebook}
              >
                <FacebookIcon className="mr-1.5 h-3.5 w-3.5" />
                Post to Facebook
              </Button>
            </div>
          </div>
        }
      >
        {fbVehicle && (
          <div className="space-y-4">
            {/* Vehicle preview */}
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                {fbVehicle.images?.[0] ? (
                  <img src={mediaUrl(fbVehicle.images[0])} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-slate-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm text-slate-900">{vehicleName(fbVehicle)}</b>
                <div className="mt-0.5 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{money(fbVehicle.price)}</span> · {(Number(fbVehicle.mileage) || 0).toLocaleString()} mi · Stock: #{fbVehicle.stockNumber || '—'}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800">
                    {fbVehicle.images?.length || 0} photo{fbVehicle.images?.length === 1 ? '' : 's'}
                  </span>
                  {fbVehicle.vin && <span className="font-mono text-[11px] text-slate-400">VIN: {fbVehicle.vin}</span>}
                </div>
              </div>
            </div>

            {/* Configured settings */}
            {!fbConfig || (!fbConfig.page && !fbConfig.groups?.length) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <b>No Facebook posting targets configured yet</b>
                <p className="mt-1 text-xs text-amber-800">
                  You haven't selected a Facebook Page or Groups to post to yet. Go to FB Poster to select your Page and groups.
                </p>
                <Button
                  size="sm"
                  className="mt-3 border-transparent bg-[#1877F2] font-semibold text-white hover:bg-[#166fe5]"
                  onClick={() => {
                    setFbVehicle(null);
                    router.push('/dealer/facebook');
                  }}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Configure in FB Poster
                </Button>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 text-sm">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Configured Posting Options</div>

                {/* Page */}
                <div className="flex items-center justify-between border-b border-slate-100 py-1 text-xs">
                  <span className="font-medium text-slate-500">Facebook Page:</span>
                  {fbConfig.page ? (
                    <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 font-semibold text-purple-700">
                      {fbConfig.page.name || fbConfig.page.url}
                    </span>
                  ) : (
                    <span className="italic text-slate-400">None (personal profile)</span>
                  )}
                </div>

                {/* Collection */}
                {fbConfig.collection && (
                  <div className="flex items-center justify-between border-b border-slate-100 py-1 text-xs">
                    <span className="font-medium text-slate-500">Selected Collection:</span>
                    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">
                      {fbConfig.collection.name}
                    </span>
                  </div>
                )}

                {/* Groups */}
                <div className="space-y-1.5 py-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-500">Selected Groups:</span>
                    <span className="font-bold text-slate-700">{fbConfig.groups?.length || 0} group{fbConfig.groups?.length === 1 ? '' : 's'}</span>
                  </div>
                  {fbConfig.groups && fbConfig.groups.length > 0 ? (
                    <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto pt-0.5">
                      {fbConfig.groups.map((g) => (
                        <span key={g.url} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700" title={g.url}>
                          {g.name || g.url}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="italic text-slate-400">No groups selected</span>
                  )}
                </div>

                {/* Caption preview */}
                <div className="space-y-1 border-t border-slate-100 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">Post description & hashtags:</span>
                    {fbLoadingText && <span className="text-slate-400">Loading preview…</span>}
                  </div>
                  <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-xs text-slate-700">
                    {fbCaption}
                    {fbHashtags ? `\n\n${fbHashtags}` : ''}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
