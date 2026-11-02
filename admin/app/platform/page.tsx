'use client';

import Link from 'next/link';
import { Building2, Car, CircleDollarSign, Inbox, Users, AlertTriangle, Rss, Palette } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat, StatusBadge, Table, Td } from '@/components/ui';
import { ago, money } from '@/lib/format';

export default function PlatformOverview() {
  const { data, loading, error, reload } = useApi('/platform/overview');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;
  const k = data.kpis;
  const maxLeads = Math.max(1, ...data.chart.map((c: any) => c.count));
  const maxFleet = Math.max(1, ...data.fleet.map((f: any) => f.published));

  return (
    <>
      <PageHeader title="Overview" desc="Every dealership on the platform at a glance." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Dealerships" value={k.dealerships} sub={`${k.active} active`} icon={<Building2 className="h-5 w-5" />} />
        <Stat label="Vehicles for sale" value={k.vehiclesForSale} icon={<Car className="h-5 w-5" />} />
        <Stat label="Inventory value" value={money(k.inventoryValue)} icon={<CircleDollarSign className="h-5 w-5" />} />
        <Stat label="Leads (7 days)" value={k.leads7} sub={`${k.unread} unread`} icon={<Inbox className="h-5 w-5" />} />
        <Stat label="Dealer logins" value={k.dealerLogins} icon={<Users className="h-5 w-5" />} />
        <Stat
          label="Waiting for you"
          value={k.pendingCargurus + k.pendingThemeRequests}
          sub={
            <>
              <Link href="/platform/cargurus" className="underline">{k.pendingCargurus} CarGurus</Link> ·{' '}
              <Link href="/platform/themes" className="underline">{k.pendingThemeRequests} design requests</Link>
            </>
          }
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Inquiries — last 14 days" className="lg:col-span-2">
          <div className="flex h-40 items-end gap-1.5">
            {data.chart.map((c: any) => (
              <div key={c.day} className="group flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100">{c.count}</span>
                <div className="w-full rounded-t bg-blue-600/80" style={{ height: `${(c.count / maxLeads) * 120 + 2}px` }} />
                <span className="text-[9px] text-slate-400">{c.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Needs attention">
          {data.attention.length === 0 ? (
            <p className="text-sm text-slate-500">All good.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.attention.map((a: any, i: number) => (
                <li key={i}>
                  <Link href={`/platform/dealers/${a.tenantId}`} className="flex items-center gap-2 hover:underline">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> <b>{a.name}</b> <span className="text-slate-500">{a.issue}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Dealership fleet" className="mb-6" pad={false}>
        <Table head={['Dealership', 'Status', 'Design', 'Inventory', 'Leads 7d', 'Unread', 'Created']} empty={!data.fleet.length && <Empty title="No dealerships yet" />}>
          {data.fleet.map((f: any) => (
            <tr key={f.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/platform/dealers/${f.id}`} className="font-semibold text-slate-900 hover:underline">
                  {f.name}
                </Link>
                <div className="text-xs text-slate-500">
                  {f.dealerCode} · {f.domain || 'no domain'}
                </div>
              </Td>
              <Td>
                <StatusBadge status={f.status} />
              </Td>
              <Td className="text-xs">
                <Palette className="mr-1 inline h-3 w-3" />
                {f.themeId}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded bg-slate-100">
                    <div className="h-full bg-emerald-500" style={{ width: `${(f.published / maxFleet) * 100}%` }} />
                  </div>
                  <span className="text-xs">{f.published}</span>
                </div>
              </Td>
              <Td>{f.leads7}</Td>
              <Td>{f.unread}</Td>
              <Td className="text-xs text-slate-500">{ago(f.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Latest inquiries" pad={false}>
          <ul className="divide-y divide-slate-100">
            {data.recentLeads.map((l: any) => (
              <li key={l.id} className="px-5 py-3 text-sm">
                <b>{l.name}</b> → {l.tenant.name} <span className="float-right text-xs text-slate-400">{ago(l.createdAt)}</span>
                <div className="truncate text-xs text-slate-500">{l.message}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Platform activity" pad={false}>
          <ul className="divide-y divide-slate-100">
            {data.activity.map((a: any) => (
              <li key={a.id} className="px-5 py-2.5 text-xs">
                <span className="font-mono text-slate-700">{a.action}</span> · {a.actor || 'system'} {a.tenant && <>· {a.tenant.name}</>}
                <span className="float-right text-slate-400">{ago(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-6 text-xs text-slate-400">
        <Rss className="mr-1 inline h-3 w-3" /> CarGurus uploads need your approval before anything is sent.
      </p>
    </>
  );
}
