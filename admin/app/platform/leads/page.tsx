'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Card, Drawer, Empty, Input, Loading, PageHeader, Pagination, Select, StatusBadge, Table, Td } from '@/components/ui';
import { ago, dateTime, vehicleName } from '@/lib/format';

export default function PlatformLeads() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null);
  const tenants = useApi('/platform/tenants');
  const { data, loading } = useApi(`/platform/leads?q=${encodeURIComponent(term)}&status=${status}&tenantId=${tenantId}&page=${page}`);
  return (
    <>
      <PageHeader title="Leads & inquiries" desc="Inquiries across all dealerships (read-only)." />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <form className="relative min-w-[200px] flex-1" onSubmit={(e) => { e.preventDefault(); setTerm(q); setPage(1); }}>
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Name, email, phone, message…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Select value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(1); }} className="w-56">
            <option value="">All dealerships</option>
            {tenants.data?.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-36">
            <option value="">Any status</option>
            {['UNREAD', 'READ', 'REPLIED', 'CLOSED'].map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : (
          <>
            <Table head={['Customer', 'Dealership', 'Topic', 'Status', 'Received']} empty={!data?.items.length && <Empty title="No inquiries" />}>
              {data?.items.map((l: any) => (
                <tr key={l.id} onClick={() => setOpen(l)} className="cursor-pointer hover:bg-slate-50">
                  <Td>
                    <b>{l.name}</b>
                    <div className="text-xs text-slate-500">{l.email || l.phone}</div>
                  </Td>
                  <Td>
                    <Link className="hover:underline" href={`/platform/dealers/${l.tenant.id}`} onClick={(e) => e.stopPropagation()}>
                      {l.tenant.name}
                    </Link>
                  </Td>
                  <Td>
                    {l.topic}
                    <div className="max-w-xs truncate text-xs text-slate-500">{l.message}</div>
                  </Td>
                  <Td><StatusBadge status={l.status} /></Td>
                  <Td className="text-xs">{ago(l.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} → ${open.tenant.name}` : ''}>
        {open && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-500">{dateTime(open.createdAt)} · {open.email} {open.phone}</p>
            <p className="whitespace-pre-line rounded-xl bg-slate-50 p-4">{open.message}</p>
            {open.vehicle && <p>Vehicle: {vehicleName(open.vehicle)}</p>}
            {open.replies.map((r: any) => (
              <div key={r.id} className="ml-6 rounded-xl bg-blue-50 p-3">
                <div className="text-xs text-slate-500">{dateTime(r.createdAt)} · {r.sentBy}</div>
                <p className="whitespace-pre-line">{r.body}</p>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
}
