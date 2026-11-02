'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Card, Empty, ErrorBox, Input, LinkButton, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { date } from '@/lib/format';

export default function DealersPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(`/platform/tenants?q=${encodeURIComponent(term)}&status=${status}`);
  return (
    <>
      <PageHeader
        title="Dealerships"
        actions={
          <LinkButton href="/platform/dealers/new">
            <Plus className="h-4 w-4" /> Add dealership
          </LinkButton>
        }
      />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <form
            className="relative min-w-[220px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setTerm(q);
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Name, id, dealer ID or domain…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} retry={reload} />
          </div>
        ) : (
          <Table head={['Dealership', 'Dealer ID', 'Domains', 'Design', 'Vehicles', 'Leads', 'Logins', 'Status', 'Created']} empty={!data?.length && <Empty title="No dealerships found" />}>
            {data?.map((t: any) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/platform/dealers/${t.id}`} className="font-semibold text-slate-900 hover:underline">
                    {t.name}
                  </Link>
                  <div className="text-xs text-slate-500">{t.id}</div>
                </Td>
                <Td className="font-mono text-xs">{t.dealerCode}</Td>
                <Td className="text-xs">{t.domains.map((d: any) => d.domain).join(', ') || '—'}</Td>
                <Td>{t.themeId}</Td>
                <Td>{t._count.vehicles}</Td>
                <Td>{t._count.leads}</Td>
                <Td>{t._count.users}</Td>
                <Td>
                  <StatusBadge status={t.status} />
                </Td>
                <Td className="text-xs">{date(t.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
