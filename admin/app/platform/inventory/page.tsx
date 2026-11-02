'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { Card, Empty, Input, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td } from '@/components/ui';
import { ago, money, num, vehicleName } from '@/lib/format';

export default function PlatformInventory() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [page, setPage] = useState(1);
  const tenants = useApi('/platform/tenants');
  const { data, loading } = useApi(`/platform/inventory?q=${encodeURIComponent(term)}&status=${status}&tenantId=${tenantId}&page=${page}`);
  return (
    <>
      <PageHeader title="Inventory" desc="Vehicles across all dealerships (read-only)." />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q);
              setPage(1);
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Make, model, VIN, stock…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(1); }} className="w-56">
            <option value="">All dealerships</option>
            {tenants.data?.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-36">
            <option value="">Any status</option>
            <option value="PUBLISHED">For sale</option>
            <option value="DRAFT">Draft</option>
            <option value="SOLD">Sold</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <Table head={['Vehicle', 'Dealership', 'Price', 'Mileage', 'VIN', 'Status', 'Updated']} empty={!data?.items.length && <Empty title="No vehicles" />}>
              {data?.items.map((v: any) => (
                <tr key={v.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-14 overflow-hidden rounded bg-slate-100">{v.images[0] && <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" />}</div>
                      <b>{vehicleName(v)}</b>
                    </div>
                  </Td>
                  <Td>
                    <Link className="hover:underline" href={`/platform/dealers/${v.tenant.id}`}>
                      {v.tenant.name}
                    </Link>
                  </Td>
                  <Td>{money(v.price)}</Td>
                  <Td>{num(v.mileage)}</Td>
                  <Td className="font-mono text-xs">{v.vin}</Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                  <Td className="text-xs">{ago(v.updatedAt)}</Td>
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
