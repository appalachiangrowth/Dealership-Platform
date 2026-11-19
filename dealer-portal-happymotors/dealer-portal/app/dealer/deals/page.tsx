'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileSignature, Plus, Search } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Badge, ErrorBox, Input, LinkButton, Loading, PageHeader, cx } from '@/components/ui';
import { usd } from '@/lib/deals';

/** Deals / Bill of Sale: every vehicle sale with its forms. */
export default function DealsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, loading, error, reload } = useApi<any[]>(`/dealer/deals?status=${status}&search=${encodeURIComponent(search)}`, [status, search]);

  return (
    <>
      <PageHeader
        title="Deals / Bill of Sale"
        desc="Sell a vehicle, scan the buyer’s license and print the bill of sale, odometer statement, Buyers Guide and VA VSA 17A."
        actions={
          <LinkButton href="/dealer/deals/new">
            <Plus className="h-4 w-4" /> Sell car
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-white p-1 text-xs font-semibold ring-1 ring-slate-200">
          {[
            ['', 'All'],
            ['DRAFT', 'Drafts'],
            ['COMPLETED', 'Completed'],
          ].map(([k, label]) => (
            <button key={k} onClick={() => setStatus(k)} className={cx('rounded-md px-3 py-1.5', status === k ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100')}>
              {label}
            </button>
          ))}
        </div>
        <form
          className="relative min-w-[220px] flex-1 sm:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Deal no., buyer or phone" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} />
        </form>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !data?.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <FileSignature className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-800">{search || status ? 'No deals found' : 'No deals yet'}</p>
          <p className="mt-1 text-sm text-slate-500">Open a vehicle in Inventory and click “Sell car”, or start here.</p>
          <LinkButton href="/dealer/deals/new" className="mt-4">
            <Plus className="h-4 w-4" /> Sell car
          </LinkButton>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Deal</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((d) => {
                const v = d.vehicleSnapshot || {};
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dealer/deals/${d.id}`} className="font-mono text-xs font-bold text-blue-700 hover:underline">
                        {d.dealNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.saleDate ? new Date(`${d.saleDate}T12:00:00`).toLocaleDateString('en-US') : '—'}</td>
                    <td className="px-4 py-3">
                      <Link href={`/dealer/deals/${d.id}`} className="font-semibold text-slate-900 hover:underline">
                        {d.buyerFullName || '—'}
                      </Link>
                      {d.buyerPhone && <div className="text-xs text-slate-500">{d.buyerPhone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-800">{[v.year, v.make, v.model].filter(Boolean).join(' ') || '—'}</div>
                      {v.vin && <div className="font-mono text-[11px] text-slate-500">{v.vin}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{usd(Number(d.totalPrice) || 0)}</td>
                    <td className="px-4 py-3">
                      <Badge color={d.status === 'COMPLETED' ? 'green' : 'amber'}>{d.status === 'COMPLETED' ? 'Completed' : 'Draft'}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
