'use client';

import Link from 'next/link';
import { Car, Inbox, CircleDollarSign, Newspaper, CheckCircle2, Circle, ArrowRight, ExternalLink } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { useTenant } from '@/components/DealerShell';
import { Card, ErrorBox, LinkButton, Loading, PageHeader, Stat, StatusBadge, Empty } from '@/components/ui';
import { ago, money, vehicleName } from '@/lib/format';
import { mediaUrl, siteUrl } from '@/lib/api';

export default function DealerOverview() {
  const { can, me } = useSession();
  const { tenant } = useTenant();
  const { data, loading, error, reload } = useApi(can('dashboard') ? '/dealer/dashboard' : null);

  if (!can('dashboard')) return <PageHeader title={`Welcome, ${me?.user.name || ''}`} desc="Use the menu to get started." />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title={`Welcome back${me?.user.name ? ', ' + me.user.name.split(' ')[0] : ''}`}
        desc={`Here is what is happening at ${tenant?.name}.`}
        actions={
          tenant && (
            <LinkButton href={siteUrl(tenant)} target="_blank" variant="secondary">
              <ExternalLink className="h-4 w-4" /> View website
            </LinkButton>
          )
        }
      />

      {data.progress < 100 && (
        <Card className="mb-6" title={`Set-up checklist · ${data.progress}% done`}>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${data.progress}%` }} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.checklist.map((c: { id: string; label: string; done: boolean; href: string }) => (
              <Link key={c.id} href={c.href} className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm hover:border-blue-300 hover:bg-blue-50/40">
                {c.done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
                <span className={c.done ? 'text-slate-400 line-through' : 'font-medium text-slate-800'}>{c.label}</span>
                {!c.done && <ArrowRight className="ml-auto h-4 w-4 text-slate-400" />}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Vehicles for sale" value={data.vehicles.published} sub={`${data.vehicles.draft} drafts · ${data.vehicles.sold} sold`} icon={<Car className="h-5 w-5" />} />
        <Stat label="Inventory value" value={money(data.inventoryValue)} sub={`Average ${money(data.averagePrice)}`} icon={<CircleDollarSign className="h-5 w-5" />} />
        <Stat label="Inquiries (7 days)" value={data.leads.last7} sub={`${data.leads.unread} unread · ${data.leads.last30} in 30 days`} icon={<Inbox className="h-5 w-5" />} />
        <Stat label="Blog posts" value={data.posts} sub="published" icon={<Newspaper className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Latest inquiries" actions={<LinkButton href="/dealer/leads" size="sm" variant="ghost">All inquiries</LinkButton>} pad={false}>
          {data.latestLeads.length === 0 ? (
            <Empty title="No inquiries yet" desc="Messages from your website contact and vehicle forms appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.latestLeads.map((l: any) => (
                <li key={l.id}>
                  <Link href={`/dealer/leads?open=${l.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{l.name}</div>
                      <div className="truncate text-xs text-slate-500">{l.topic} · {l.message}</div>
                    </div>
                    <StatusBadge status={l.status} />
                    <span className="w-20 text-right text-xs text-slate-400">{ago(l.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recently updated vehicles" actions={<LinkButton href="/dealer/vehicles" size="sm" variant="ghost">All vehicles</LinkButton>} pad={false}>
          {data.recentVehicles.length === 0 ? (
            <Empty title="No vehicles yet" action={<LinkButton href="/dealer/vehicles/new" variant="success">Add your first vehicle</LinkButton>} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recentVehicles.map((v: any) => (
                <li key={v.id}>
                  <Link href={`/dealer/vehicles/${v.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="h-10 w-14 overflow-hidden rounded-md bg-slate-100">{v.images[0] && <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{vehicleName(v)}</div>
                      <div className="text-xs text-slate-500">{money(v.price)}</div>
                    </div>
                    <StatusBadge status={v.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
