'use client';

import { useState } from 'react';
import { useApi } from '@/lib/useApi';
import { Card, Input, Loading, PageHeader, Pagination, Select, Table, Td } from '@/components/ui';
import { dateTime } from '@/lib/format';

export default function Activity() {
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const tenants = useApi('/platform/tenants');
  const { data, loading } = useApi(`/platform/activity?tenantId=${tenantId}&action=${encodeURIComponent(action)}&page=${page}`);
  return (
    <>
      <PageHeader title="Activity log" desc="Who did what, on the platform and in every dealership." />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(1); }} className="w-56">
            <option value="">Everything</option>
            <option value="platform">Platform only</option>
            {tenants.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Input placeholder="Action starts with… (login, vehicle, cargurus)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="max-w-sm" />
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <Table head={['When', 'Dealership', 'Action', 'By', 'IP', 'Details']}>
              {data?.items.map((a: any) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap text-xs">{dateTime(a.createdAt)}</Td>
                  <Td className="text-xs">{a.tenant?.name || 'Platform'}</Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs">{a.actor}</Td>
                  <Td className="text-xs text-slate-400">{a.ip}</Td>
                  <Td className="max-w-md truncate font-mono text-[11px] text-slate-500">{a.detail ? JSON.stringify(a.detail) : ''}</Td>
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
