'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brandRun, onBrandingChange } from '@/lib/branding';
import { useRouter } from 'next/navigation';
import { Car, ImageIcon, Plus, Search, Star, Upload } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Button, ErrorBox, Input, LinkButton, Loading, PageHeader, Pagination, Select, cx } from '@/components/ui';
import { money, vehicleName } from '@/lib/format';

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
    </>
  );
}
