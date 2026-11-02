'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search, Star, Upload, ListChecks } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Button, Card, Empty, ErrorBox, Input, LinkButton, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td, cx } from '@/components/ui';
import { money, num, vehicleName, ago } from '@/lib/format';

export default function VehiclesPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string[]>([]);
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/dealer/vehicles?status=${status}&q=${encodeURIComponent(term)}&sort=${sort}&page=${page}&pageSize=50`);

  async function bulk(action: string) {
    if (action === 'delete' && !confirm(`Delete ${sel.length} vehicle(s)?`)) return;
    try {
      const r = await api('/dealer/vehicles/bulk', { body: { ids: sel, action } });
      toast.ok(`${r.count} vehicle(s) updated`);
      setSel([]);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const tabs = [
    ['', 'All'],
    ['PUBLISHED', 'For sale'],
    ['DRAFT', 'Drafts'],
    ['SOLD', 'Sold'],
  ];
  const counts = data?.counts || {};
  const total = (counts.PUBLISHED || 0) + (counts.DRAFT || 0) + (counts.SOLD || 0);

  return (
    <>
      <PageHeader
        title="Vehicles"
        desc="Everything on your lot. Published vehicles appear on your website and in your feeds."
        actions={
          <>
            <LinkButton href="/dealer/vehicles/rules" variant="secondary">
              <ListChecks className="h-4 w-4" /> Field rules
            </LinkButton>
            <LinkButton href="/dealer/vehicles/import" variant="secondary">
              <Upload className="h-4 w-4" /> Import CSV / XML
            </LinkButton>
            <LinkButton href="/dealer/vehicles/new" variant="success">
              <Plus className="h-4 w-4" /> Add vehicle
            </LinkButton>
          </>
        }
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setStatus(k);
                  setPage(1);
                }}
                className={cx('rounded-md px-3 py-1.5', status === k ? 'bg-white shadow' : 'text-slate-500')}
              >
                {label} <span className="text-slate-400">{k ? counts[k] || 0 : total}</span>
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
            <Input className="pl-9" placeholder="Search make, model, VIN, stock…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-44">
            <option value="newest">Newest first</option>
            <option value="updated">Recently updated</option>
            <option value="price_desc">Price: high to low</option>
            <option value="price_asc">Price: low to high</option>
            <option value="year_desc">Year: newest</option>
            <option value="mileage_asc">Mileage: lowest</option>
          </Select>
        </div>
        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-blue-100 bg-blue-50 px-4 py-2 text-sm">
            <b>{sel.length} selected</b>
            <Button size="sm" variant="secondary" onClick={() => bulk('publish')}>Publish</Button>
            <Button size="sm" variant="secondary" onClick={() => bulk('draft')}>Unpublish</Button>
            <Button size="sm" variant="secondary" onClick={() => bulk('sold')}>Mark sold</Button>
            <Button size="sm" variant="secondary" onClick={() => bulk('feature')}>Feature</Button>
            <Button size="sm" variant="secondary" onClick={() => bulk('unfeature')}>Unfeature</Button>
            <Button size="sm" variant="danger" onClick={() => bulk('delete')}>Delete</Button>
          </div>
        )}
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : (
          <>
            <Table
              head={[
                <input
                  key="all"
                  type="checkbox"
                  checked={!!data?.items.length && sel.length === data.items.length}
                  onChange={(e) => setSel(e.target.checked ? data.items.map((v: any) => v.id) : [])}
                />,
                'Vehicle',
                'Price',
                'Mileage',
                'Stock / VIN',
                'Status',
                'Updated',
              ]}
              empty={
                !data?.items.length && (
                  <Empty title="No vehicles here" desc="Add a vehicle or import your inventory from a CSV / XML file." action={<LinkButton href="/dealer/vehicles/new" variant="success">Add vehicle</LinkButton>} />
                )
              }
            >
              {data?.items.map((v: any) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <Td>
                    <input type="checkbox" checked={sel.includes(v.id)} onChange={(e) => setSel(e.target.checked ? [...sel, v.id] : sel.filter((x) => x !== v.id))} />
                  </Td>
                  <Td>
                    <Link href={`/dealer/vehicles/${v.id}`} className="flex items-center gap-3">
                      <div className="h-11 w-16 shrink-0 overflow-hidden rounded-md bg-slate-100">{v.images[0] && <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" />}</div>
                      <div>
                        <div className="flex items-center gap-1 font-semibold text-slate-900">
                          {vehicleName(v)} {v.featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                        </div>
                        <div className="text-xs text-slate-500">
                          {[v.bodyStyle, v.exteriorColor].filter(Boolean).join(' · ')} · {v.images.length} photos
                        </div>
                      </div>
                    </Link>
                  </Td>
                  <Td className="font-semibold">{money(v.price)}</Td>
                  <Td>{num(v.mileage)}</Td>
                  <Td className="font-mono text-xs">
                    {v.stockNumber || '—'}
                    <div className="text-slate-400">{v.vin || ''}</div>
                  </Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                  <Td className="text-xs text-slate-500">{ago(v.updatedAt)}</Td>
                </tr>
              ))}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
