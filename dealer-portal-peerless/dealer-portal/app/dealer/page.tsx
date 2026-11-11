'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Car, Check, ChevronDown, CircleDollarSign, ExternalLink, CircleHelp, ImageIcon, Info, Mail, Newspaper, Phone, Plus, Send } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { useSession } from '@/lib/session';
import { useTenant } from '@/components/DealerShell';
import { ErrorBox, Loading, PageHeader, cx } from '@/components/ui';
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
  { id: 'business', label: 'Business details', desc: 'Dealership name, phone and address', href: '/dealer/business' },
  { id: 'logo', label: 'Logo', desc: 'Shown in your website header and footer', href: '/dealer/business' },
  { id: 'hours', label: 'Opening hours', desc: 'So customers know when to call or visit', href: '/dealer/business' },
  { id: 'design', label: 'Website design', desc: 'The theme your website uses', href: '/dealer/design' },
  { id: 'content', label: 'Website text', desc: 'Headlines, your story and reviews', href: '/dealer/content' },
  { id: 'leads', label: 'Inquiry email', desc: 'Where customer messages are sent', href: '/dealer/leads' },
  { id: 'vehicle', label: 'First vehicle', desc: 'At least one vehicle published', href: '/dealer/inventory/new' },
];

/* Clean Light palette of the new design */
const card = 'rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
const btnP =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white transition hover:brightness-110';
const btnS =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-3.5 text-sm font-semibold text-[#0F172A] transition hover:bg-[#F8FAFC]';
const lnk = 'font-semibold text-[#1D4ED8] hover:underline';
const iconTile = 'flex shrink-0 items-center justify-center rounded-[10px] bg-[#EAF1FF] text-[#1D4ED8]';

const STATUS_PILL: Record<string, string> = {
  PUBLISHED: 'bg-[#E8F7EE] text-[#15803D]',
  DRAFT: 'bg-[#F1F5F9] text-[#526077]',
  SOLD: 'bg-[#EAF1FF] text-[#1D4ED8]',
  NEW: 'bg-[#EAF1FF] text-[#1D4ED8]',
  REPLIED: 'bg-[#E8F7EE] text-[#15803D]',
  CLOSED: 'bg-[#F1F5F9] text-[#526077]',
};
const STATUS_DOT: Record<string, string> = { PUBLISHED: 'bg-[#15803D]', DRAFT: 'bg-[#94A3B8]', SOLD: 'bg-[#1D4ED8]' };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DealerOverview() {
  const { can, me } = useSession();
  const { tenant } = useTenant();
  const { data, loading, error, reload } = useApi(can('dashboard') ? '/dealer/dashboard' : null);
  const [showSteps, setShowSteps] = useState(false);

  if (!can('dashboard')) return <PageHeader title={`Welcome, ${me?.user.name || ''}`} desc="Use the menu to get started." />;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;

  const apiChecklist: { id: string; done: boolean; href?: string; desc?: string }[] = data.checklist || [];
  const steps = STEP_DEFAULTS.map((def) => {
    const match = apiChecklist.find((c) => c.id === def.id);
    return { ...def, done: !!match?.done, href: match?.href || def.href };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const allDone = doneCount === total;
  const activeIndex = steps.findIndex((s) => !s.done);

  const firstName = (me?.user.name || me?.user.login || '').split(/\s+/)[0];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
  const published: number = data.vehicles.published;
  const features = tenant?.features || {};
  const canInv = can('inventory');

  // simple suggestions that help a dealer get more inquiries
  const nextSteps: { key: string; icon: React.ElementType; title: string; desc: string; tag?: 'Recommended' | 'Optional'; href: string; action: string; primary?: boolean }[] = [];
  if (canInv && published < 10)
    nextSteps.push({
      key: 'vehicles',
      icon: Car,
      title: 'Add more vehicles',
      desc: `You have ${published} vehicle${published === 1 ? '' : 's'} for sale. More choice gives visitors more reasons to contact you.`,
      tag: 'Recommended',
      href: '/dealer/inventory/new',
      action: 'Add vehicle',
      primary: true,
    });
  if (can('blog') && features.blog !== false && !data.posts)
    nextSteps.push({ key: 'blog', icon: Newspaper, title: 'Publish your first blog post', desc: 'Short news and buying tips help your website show up in Google searches.', href: '/dealer/blog', action: 'Write a post' });
  if (canInv && features.facebook !== false)
    nextSteps.push({
      key: 'fb',
      icon: Send,
      title: 'Share your vehicles on Facebook',
      desc: 'Log in to Facebook once in FB Poster, then post vehicles to your profile and Marketplace.',
      tag: 'Optional',
      href: '/dealer/facebook',
      action: 'Open FB Poster',
    });

  const support = me?.support || { email: '', phone: '' };

  return (
    <div className="flex flex-col gap-6">
      {/* Page heading */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-[280px] flex-1 flex-col gap-1">
          <span className="text-[13px] font-medium text-[#526077]">{today}</span>
          <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.02em] text-[#0F172A]">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="m-0 text-[15px] text-[#526077]">Here’s what’s happening at {tenant?.name} today.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {tenant && (
            <a href={siteUrl(tenant)} target="_blank" rel="noreferrer" className={btnS}>
              <ExternalLink className="h-4 w-4" /> View website
            </a>
          )}
          {canInv && (
            <Link href="/dealer/inventory/new" className={btnP}>
              <Plus className="h-4 w-4" /> Add vehicle
            </Link>
          )}
        </div>
      </div>

      {/* Website setup */}
      {allDone ? (
        <section aria-label="Website setup" className="overflow-hidden rounded-[14px] border border-[#BBE5CB] bg-[#E8F7EE]">
          <div className="flex flex-wrap items-center gap-4 px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#15803D] text-white">
              <Check className="h-5 w-5 stroke-[2.6]" />
            </span>
            <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-bold text-[#0F172A]">Your website setup is complete</span>
              <span className="text-sm text-[#526077]">All {total} setup steps are done. Your website is live and shows every vehicle you publish.</span>
            </div>
            <button type="button" className={btnS} onClick={() => setShowSteps((s) => !s)} aria-expanded={showSteps}>
              {showSteps ? 'Hide steps' : 'Review steps'}
              <ChevronDown className={cx('h-4 w-4 transition', showSteps && 'rotate-180')} />
            </button>
          </div>
          {showSteps && (
            <div className="grid gap-x-4 gap-y-0.5 border-t border-[#BBE5CB] bg-white px-3 py-2 sm:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
              {steps.map((s) => (
                <Link key={s.id} href={s.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[#F8FAFC]">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#E8F7EE] text-[#15803D]">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold text-[#0F172A]">{s.label}</span>
                    <span className="truncate text-xs text-[#526077]">{s.desc}</span>
                  </span>
                  <span className={cx(lnk, 'text-[13px]')}>Edit</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section aria-label="Website setup" className={cx(card, 'overflow-hidden')}>
          <div className="flex flex-wrap items-center gap-4 border-b border-[#E5E9F0] px-5 py-4">
            <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-bold text-[#0F172A]">Finish setting up your website</span>
              <span className="text-sm text-[#526077]">Follow the steps in order. Your website shows friendly placeholders until each detail is filled in.</span>
            </div>
            <span className="text-sm font-bold text-[#0F172A]">
              {doneCount} of {total} done
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#EEF2F7]">
              <div className="h-full rounded-full bg-[#2563EB] transition-all duration-500" style={{ width: `${(doneCount / total) * 100}%` }} />
            </div>
          </div>
          <div className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
            {steps.map((s, i) => {
              const active = i === activeIndex;
              return (
                <Link key={s.id} href={s.href} className={cx('flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-[#F8FAFC]', active && 'bg-[#EAF1FF]/60')}>
                  {s.done ? (
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#E8F7EE] text-[#15803D]">
                      <Check className="h-3 w-3 stroke-[3]" />
                    </span>
                  ) : (
                    <span
                      className={cx(
                        'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                        active ? 'bg-[#2563EB] text-white' : 'bg-[#F1F5F9] text-[#526077]',
                      )}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx('text-sm font-semibold', s.done ? 'text-[#526077]' : 'text-[#0F172A]')}>{s.label}</span>
                    <span className="truncate text-xs text-[#526077]">{s.desc}</span>
                  </span>
                  <span className={cx('text-[13px]', active ? 'rounded-md bg-[#2563EB] px-2.5 py-1 font-semibold text-white' : lnk)}>
                    {s.done ? 'Edit' : active ? 'Start' : 'Open'}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Key numbers */}
      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Vehicles for sale" icon={Car} value={published} sub={`${data.vehicles.draft} draft${data.vehicles.draft === 1 ? '' : 's'} · ${data.vehicles.sold} sold`} />
        <StatCard label="Inventory value" icon={CircleDollarSign} value={money(data.inventoryValue)} sub={`Average price ${money(data.averagePrice)}`} />
        <StatCard
          label="Inquiries · last 7 days"
          icon={Mail}
          value={data.leads.last7}
          sub={`${data.leads.unread ? `${data.leads.unread} unread` : 'No unread messages'} · ${data.leads.last30} in the last 30 days`}
        />
        <StatCard
          label="Blog posts"
          icon={Newspaper}
          value={data.posts}
          sub={
            !data.posts && can('blog') && features.blog !== false ? (
              <Link href="/dealer/blog" className={lnk}>
                Write your first post →
              </Link>
            ) : (
              'published'
            )
          }
        />
      </section>

      {/* Two columns */}
      <div className="flex flex-wrap items-start gap-6">
        {/* Left */}
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-6">
          {nextSteps.length > 0 && (
            <section aria-labelledby="next-h" className={card}>
              <div className="flex items-start gap-3 border-b border-[#E5E9F0] px-5 pb-3.5 pt-[18px]">
                <div className="flex flex-1 flex-col gap-0.5">
                  <h2 id="next-h" className="m-0 text-[17px] font-bold text-[#0F172A]">
                    Recommended next steps
                  </h2>
                  <span className="text-[13px] text-[#526077]">Simple things that help you get more inquiries.</span>
                </div>
                <span className="rounded-full border border-[#E5E9F0] bg-[#F8FAFC] px-2.5 py-1 text-xs font-semibold text-[#526077]">
                  {nextSteps.length} suggestion{nextSteps.length === 1 ? '' : 's'}
                </span>
              </div>
              {nextSteps.map((n, i) => (
                <div key={n.key} className={cx('flex flex-wrap items-center gap-4 px-5 py-4', i < nextSteps.length - 1 && 'border-b border-[#E5E9F0]')}>
                  <span className={cx(iconTile, 'h-10 w-10')}>
                    <n.icon className="h-5 w-5" />
                  </span>
                  <div className="flex min-w-[220px] flex-1 flex-col gap-[3px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-[#0F172A]">{n.title}</span>
                      {n.tag === 'Recommended' && (
                        <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#B45309]">Recommended</span>
                      )}
                      {n.tag === 'Optional' && (
                        <span className="rounded-full border border-[#E5E9F0] bg-[#F8FAFC] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] text-[#526077]">Optional</span>
                      )}
                    </div>
                    <span className="text-[13px] text-[#526077]">{n.desc}</span>
                  </div>
                  <Link href={n.href} className={n.primary ? btnP : btnS}>
                    {n.action}
                  </Link>
                </div>
              ))}
            </section>
          )}

          <section aria-labelledby="veh-h" className={card}>
            <div className="flex items-center gap-3 border-b border-[#E5E9F0] px-5 pb-3.5 pt-[18px]">
              <h2 id="veh-h" className="m-0 flex-1 text-[17px] font-bold text-[#0F172A]">
                Recently updated vehicles
              </h2>
              <Link href="/dealer/inventory" className={cx(lnk, 'inline-flex items-center gap-1 text-[13px]')}>
                View all inventory <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {data.recentVehicles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
                <span className="text-sm text-[#526077]">No vehicles yet.</span>
                {canInv && (
                  <Link href="/dealer/inventory/new" className={btnP}>
                    <Plus className="h-4 w-4" /> Add your first vehicle
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-col px-2 py-1.5">
                {data.recentVehicles.map((v: RecentVehicle) => (
                  <Link key={v.id} href={`/dealer/inventory/${v.id}`} className="flex items-center gap-3.5 rounded-[10px] p-3 hover:bg-[#F8FAFC]">
                    <span className="flex h-[52px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E5E9F0] bg-[#F8FAFC] text-[#526077]">
                      {v.images?.[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-[22px] w-[22px]" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-semibold text-[#0F172A]">{vehicleName(v)}</span>
                      <span className="text-sm tabular-nums text-[#526077]">{money(v.price)}</span>
                    </span>
                    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_PILL[v.status] || STATUS_PILL.DRAFT)}>
                      <span className={cx('h-1.5 w-1.5 rounded-full', STATUS_DOT[v.status] || STATUS_DOT.DRAFT)} />
                      {label(v.status)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right */}
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-6">
          {can('leads') && (
            <section aria-labelledby="inq-h" className={card}>
              <div className="flex items-center gap-3 border-b border-[#E5E9F0] px-5 pb-3.5 pt-[18px]">
                <h2 id="inq-h" className="m-0 flex-1 text-[17px] font-bold text-[#0F172A]">
                  Latest inquiries
                </h2>
                <Link href="/dealer/leads" className={cx(lnk, 'inline-flex items-center gap-1 text-[13px]')}>
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {data.latestLeads.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-[#526077]">No inquiries yet. Messages from your website forms appear here.</p>
              ) : (
                <div className="flex flex-col px-2 py-1.5">
                  {data.latestLeads.map((l: LeadItem) => (
                    <Link key={l.id} href={`/dealer/leads?open=${l.id}`} className="flex items-start gap-3 rounded-[10px] p-3 hover:bg-[#F8FAFC]">
                      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#EAF1FF] text-[13px] font-bold text-[#1D4ED8]">
                        {(l.name || '?').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="flex-1 truncate text-sm font-semibold text-[#0F172A]">{l.name}</span>
                          <span className="shrink-0 text-xs text-[#526077]">{ago(l.createdAt)}</span>
                        </span>
                        {l.topic && <span className="text-xs font-semibold text-[#526077]">{l.topic}</span>}
                        {l.message && <span className="truncate text-[13px] text-[#0F172A]">“{l.message}”</span>}
                        <span className={cx('mt-1 self-start rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_PILL[l.status] || STATUS_PILL.CLOSED)}>{label(l.status)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {!data.leads.unread && (
                <div className="mx-5 mb-[18px] flex items-start gap-2.5 rounded-[10px] border border-[#E5E9F0] bg-[#F8FAFC] px-3.5 py-3">
                  <Info className="mt-px h-[18px] w-[18px] shrink-0 text-[#1D4ED8]" />
                  <span className="text-[13px] text-[#526077]">You’re all caught up. New messages from your website appear here and are emailed to you.</span>
                </div>
              )}
            </section>
          )}

          {(support.email || support.phone) && (
            <section aria-labelledby="help-h" className={cx(card, 'flex flex-col gap-3 px-5 py-[18px]')}>
              <div className="flex items-center gap-3">
                <span className={cx(iconTile, 'h-10 w-10')}>
                  <CircleHelp className="h-5 w-5" />
                </span>
                <div className="flex flex-col">
                  <h2 id="help-h" className="m-0 text-[15px] font-bold text-[#0F172A]">
                    Need a hand?
                  </h2>
                  <span className="text-[13px] text-[#526077]">Our team can help you with listings, design or Facebook posting.</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {support.phone && (
                  <a href={`tel:${support.phone.replace(/[^\d+]/g, '')}`} className={cx(btnS, 'flex-1')}>
                    <Phone className="h-4 w-4" /> Call support
                  </a>
                )}
                {support.email && (
                  <a href={`mailto:${support.email}`} className={cx(btnS, 'flex-1')}>
                    <Mail className="h-4 w-4" /> Contact support
                  </a>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon: React.ElementType }) {
  return (
    <div className={cx(card, 'flex flex-col gap-2.5 p-[18px]')}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#526077]">{label}</span>
        <span className={cx(iconTile, 'h-[34px] w-[34px] rounded-[9px]')}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <span className="text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums text-[#0F172A]">{value}</span>
      {sub && <span className="text-[13px] text-[#526077]">{sub}</span>}
    </div>
  );
}
