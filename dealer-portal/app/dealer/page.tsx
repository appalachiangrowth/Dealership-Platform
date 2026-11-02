'use client';

import Link from 'next/link';
import { Car, Inbox, CircleDollarSign, Newspaper, Check, ExternalLink } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { useTenant } from '@/components/DealerShell';
import { Card, ErrorBox, LinkButton, Loading, PageHeader, Stat, StatusBadge, Empty, cx } from '@/components/ui';
import { ago, money, vehicleName } from '@/lib/format';
import { mediaUrl, siteUrl } from '@/lib/api';

interface LeadItem {
  id: string;
  name: string;
  topic: string;
  message: string;
  status: string;
  createdAt: string;
}

interface RecentVehicle {
  id: string;
  images: string[];
  price: number;
  status: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
}

const STEP_DEFAULTS = [
  { id: 'business', label: 'Add your business details', desc: 'Dealership name, phone number and address.', href: '/dealer/business' },
  { id: 'logo', label: 'Upload your logo', desc: 'Shown in the header and footer of every theme.', href: '/dealer/business' },
  { id: 'hours', label: 'Set your opening hours', desc: 'So visitors know when to call or visit.', href: '/dealer/business' },
  { id: 'design', label: 'Choose your website design', desc: 'Preview the themes and pick the one you like.', href: '/dealer/design' },
  { id: 'content', label: 'Write your website text', desc: 'Headlines, your story and customer reviews.', href: '/dealer/content' },
  { id: 'leads', label: 'Choose where inquiries go', desc: 'The email address that receives customer messages.', href: '/dealer/leads' },
  { id: 'vehicle', label: 'Add your first vehicle', desc: 'Publish vehicles with photos and prices.', href: '/dealer/vehicles/new' },
];

export default function DealerOverview() {
  const { can, me } = useSession();
  const { tenant } = useTenant();
  const { data, loading, error, reload } = useApi(can('dashboard') ? '/dealer/dashboard' : null);

  if (!can('dashboard')) return <PageHeader title={`Welcome, ${me?.user.name || ''}`} desc="Use the menu to get started." />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;

  const apiChecklist: { id: string; done: boolean; href?: string; desc?: string; label?: string }[] = data.checklist || [];
  const steps = STEP_DEFAULTS.map((def) => {
    const match = apiChecklist.find((c) => c.id === def.id);
    return {
      ...def,
      done: !!match?.done,
      href: match?.href || def.href,
      desc: match?.desc || def.desc,
    };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const activeIndex = steps.findIndex((s) => !s.done);

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

      {/* Setup Checklist matching exact visual style */}
      <div className="mb-8 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="font-heading text-lg font-bold text-slate-900 sm:text-xl">Set up your website</h2>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Follow these steps in order. Your website shows friendly placeholders (like “Add phone number”) until each detail is filled in.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-heading text-lg font-extrabold text-slate-900 sm:text-xl">
              {doneCount} of {total}
            </div>
            <div className="text-[11px] font-medium text-slate-400">steps done</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out"
            style={{ width: `${(doneCount / total) * 100}%` }}
          />
        </div>

        {/* 7 Steps List */}
        <div className="mt-5 space-y-2.5">
          {steps.map((step, i) => {
            const isDone = step.done;
            const isActive = !isDone && i === activeIndex;

            return (
              <div
                key={step.id}
                className={cx(
                  'flex items-center justify-between gap-3 rounded-2xl border p-3 sm:px-5 sm:py-3.5 transition',
                  isActive
                    ? 'border-blue-600 bg-white ring-2 ring-blue-600/20 shadow-xs'
                    : isDone
                    ? 'border-slate-200/70 bg-white hover:border-slate-300'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                )}
              >
                <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
                  {isDone ? (
                    <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Check className="h-4 w-4 stroke-[2.5]" />
                    </div>
                  ) : isActive ? (
                    <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs sm:text-sm font-bold text-white shadow-xs">
                      {i + 1}
                    </div>
                  ) : (
                    <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs sm:text-sm font-bold text-slate-400">
                      {i + 1}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div
                      className={cx(
                        'truncate text-xs sm:text-sm font-bold',
                        isDone ? 'text-slate-500 line-through decoration-slate-400' : 'text-slate-900',
                      )}
                    >
                      {step.label}
                    </div>
                    <div className="truncate text-[11px] sm:text-xs text-slate-400">
                      {step.desc}
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  {isDone ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      Done
                    </span>
                  ) : isActive ? (
                    <Link
                      href={step.href}
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-blue-700 transition"
                    >
                      Start
                    </Link>
                  ) : (
                    <Link
                      href={step.href}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                    >
                      Open
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
              {data.latestLeads.map((l: LeadItem) => (
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
              {data.recentVehicles.map((v: RecentVehicle) => (
                <li key={v.id}>
                  <Link href={`/dealer/vehicles/${v.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="h-10 w-14 overflow-hidden rounded-md bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {v.images[0] && <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" />}
                    </div>
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
