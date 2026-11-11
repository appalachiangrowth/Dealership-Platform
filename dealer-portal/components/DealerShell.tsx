'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  House, Store, Palette, FileText, Car, Newspaper, Mail, Users, ExternalLink, LogOut, Menu, Plus, KeyRound, Rss, ShieldAlert, X, Send, Check, Bell,
} from 'lucide-react';
import { api, auth, mediaUrl, siteUrl, PLATFORM_ADMIN_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Loading, cx } from './ui';
import { FbActivityBar } from './fb/FbActivityBar';
import { CommandBar } from './CommandBar';
import { AddVehicleChooser } from './AddVehicleChooser';

export interface DealerTenant {
  id: string;
  name: string;
  logo: string;
  dealerCode: string;
  domains: string[];
  siteUrl: string;
  features: Record<string, boolean>;
}

const TenantCtx = createContext<{ tenant: DealerTenant | null; support: boolean; refreshTenant: () => void }>({ tenant: null, support: false, refreshTenant: () => {} });
export const useTenant = () => useContext(TenantCtx);

type Item = { href: string; label: string; icon: React.ElementType; perm: string[]; feature?: string; badge?: number; done?: boolean };

export function DealerShell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [tenant, setTenant] = useState<DealerTenant | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // setup ticks next to "Your website" and the number of vehicles for sale (from the Overview numbers)
  const [setup, setSetup] = useState<{ done: Set<string>; forSale: number } | null>(null);
  const support = me?.user.kind === 'owner';

  const loadTenant = async () => {
    if (!me) return;
    if (me.user.kind === 'dealer') {
      setTenant(me.tenant);
      return;
    }
    const id = auth.supportTenant();
    if (!id) {
      // a platform owner without a chosen dealership belongs in the Platform Admin
      auth.clear();
      window.location.href = `${PLATFORM_ADMIN_URL}/platform`;
      return;
    }
    const d = await api(`/platform/tenants/${id}`);
    setTenant({
      id: d.tenant.id,
      name: d.settings.name || d.tenant.name,
      logo: d.settings.logo,
      dealerCode: d.tenant.dealerCode,
      domains: d.tenant.domains.map((x: { domain: string }) => x.domain),
      siteUrl: d.settings.siteUrl,
      features: d.features,
    });
  };

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else void loadTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, loading]);

  useEffect(() => {
    if (tenant && can('leads')) api('/dealer/leads?pageSize=1').then((r) => setUnread(r.unread)).catch(() => {});
  }, [tenant, pathname, can]);

  useEffect(() => setOpen(false), [pathname]);

  const onOverview = pathname === '/dealer';
  useEffect(() => {
    if (!tenant || !can('dashboard')) return;
    api('/dealer/dashboard')
      .then((d) => setSetup({ done: new Set((d.checklist || []).filter((c: { done: boolean }) => c.done).map((c: { id: string }) => c.id)), forSale: d.vehicles?.published ?? 0 }))
      .catch(() => {});
  }, [tenant, onOverview, can]);

  if (loading || !me || !tenant) return <Loading />;

  const done = (...ids: string[]) => !!setup && ids.every((id) => setup.done.has(id));
  const groups: { title?: string; items: Item[] }[] = [
    { items: [{ href: '/dealer', label: 'Overview', icon: House, perm: ['dashboard'] }] },
    {
      title: 'Your website',
      items: [
        { href: '/dealer/business', label: 'Business details', icon: Store, perm: ['business'], done: done('business', 'logo', 'hours') },
        { href: '/dealer/design', label: 'Design & colours', icon: Palette, perm: ['design'], done: done('design') },
        { href: '/dealer/content', label: 'Website content', icon: FileText, perm: ['content'], done: done('content') },
      ],
    },
    {
      title: 'Inventory & marketing',
      items: [
        { href: '/dealer/inventory', label: 'Inventory', icon: Car, perm: ['inventory'], badge: setup?.forSale },
        { href: '/dealer/cargurus', label: 'CarGurus feed', icon: Rss, perm: ['inventory'], feature: 'cargurus' },
        { href: '/dealer/facebook', label: 'FB Poster', icon: Send, perm: ['inventory'], feature: 'facebook' },
        { href: '/dealer/blog', label: 'Blog & news', icon: Newspaper, perm: ['blog'], feature: 'blog' },
      ],
    },
    { title: 'Customers', items: [{ href: '/dealer/leads', label: 'Leads & inquiries', icon: Mail, perm: ['leads'], badge: unread }] },
    {
      title: 'Settings',
      items: [{ href: '/dealer/team', label: 'Team & permissions', icon: Users, perm: ['users'] }],
    },
  ];
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => can(...i.perm) && (!i.feature || tenant.features[i.feature] !== false)) }))
    .filter((g) => g.items.length);
  // editors with a live website preview use the full width
  const wide = pathname.startsWith('/dealer/content') || pathname.startsWith('/dealer/design');
  const isActive = (href: string) => (href === '/dealer' ? pathname === '/dealer' : pathname.startsWith(href));
  const initials = (me.user.name || me.user.login).split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();

  const exitSupport = () => {
    // leave support mode: forget the owner login in this app and go back to the Platform Admin
    auth.clear();
    window.location.href = `${PLATFORM_ADMIN_URL}/platform/dealers/${tenant.id}`;
  };

  const sidebar = (
    <aside className="flex h-full w-64 flex-col gap-5 border-r border-[#1E293B] bg-[#0F172A] px-3.5 py-5 text-[#CBD5E1]">
      <div className="flex items-center gap-3 px-1.5">
        {tenant.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(tenant.logo)} alt="" className="h-10 w-10 shrink-0 rounded-[10px] bg-white object-contain p-1" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#2563EB] text-white">
            <Car className="h-[22px] w-[22px]" />
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base font-bold text-white">{tenant.name}</span>
          <span className="text-xs text-[#94A3B8]">Dealer Portal</span>
        </div>
      </div>

      {can('inventory') && (
        <Link
          href="/dealer/inventory/new"
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white transition hover:brightness-110"
        >
          <Plus className="h-[18px] w-[18px]" /> Add vehicle
        </Link>
      )}

      <nav aria-label="Main" className="-mx-1 flex flex-1 flex-col gap-[18px] overflow-y-auto px-1">
        {visible.map((g, gi) => (
          <div key={gi} className="flex flex-col gap-0.5">
            {g.title && <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#94A3B8]">{g.title}</span>}
            {g.items.map((i) => {
              const active = isActive(i.href);
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-3 rounded-lg px-3 py-[9px] text-sm transition',
                    active ? 'bg-[#1E3A8A] font-semibold text-white' : 'font-medium text-[#CBD5E1] hover:bg-[#1E293B]',
                  )}
                >
                  <i.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                  <span className="flex-1 truncate">{i.label}</span>
                  {i.done && <Check className="h-4 w-4 text-[#22C55E]" strokeWidth={2.4} aria-label="Complete" />}
                  {!!i.badge && <span className="rounded-full bg-[#1E293B] px-2 py-px text-xs font-semibold text-[#CBD5E1]">{i.badge}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-2 rounded-xl border border-[#1E293B] bg-[#131D33] p-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
            <span className="text-[13px] font-semibold text-white">Website is live</span>
          </div>
          <span className="text-xs text-[#94A3B8]">Visitors can see your published vehicles right now.</span>
          <a href={siteUrl(tenant)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#93C5FD] hover:underline">
            View website <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="flex items-center gap-2.5 border-t border-[#1E293B] px-1.5 pt-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-sm font-bold text-white">{initials}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-white">{me.user.name || me.user.login}</span>
            <span className="truncate text-xs text-[#94A3B8]">{support ? 'Platform owner' : me.catalog.roles[me.user.role]?.label || me.user.role}</span>
          </div>
          {!support && (
            <Link href="/dealer/account" title="Password" aria-label="Account settings" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94A3B8] hover:bg-[#1E293B] hover:text-white">
              <KeyRound className="h-[18px] w-[18px]" />
            </Link>
          )}
          <button onClick={logout} title="Log out" aria-label="Log out" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94A3B8] hover:bg-[#1E293B] hover:text-white">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <TenantCtx.Provider value={{ tenant, support, refreshTenant: () => void loadTenant() }}>
      <AddVehicleChooser />
      <div className="flex min-h-screen">
        <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="relative h-full w-64">{sidebar}</div>
            <button className="absolute left-[16.5rem] top-4 text-white" onClick={() => setOpen(false)}>
              <X />
            </button>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
          {support && (
            <div className="flex items-center justify-between gap-3 bg-amber-400 px-5 py-2 text-sm font-semibold text-amber-950">
              <span className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" /> Support mode — you are working inside {tenant.name} as the platform owner.
              </span>
              <button onClick={exitSupport} className="rounded-md bg-amber-950/10 px-3 py-1 text-xs hover:bg-amber-950/20">
                Back to Platform Admin
              </button>
            </div>
          )}
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
            <button onClick={() => setOpen(true)} aria-label="Menu">
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-heading text-sm font-bold">{tenant.name}</span>
            {can('inventory') ? (
              <Link href="/dealer/inventory/new" className="rounded-lg bg-emerald-500 p-1.5 text-white">
                <Plus className="h-4 w-4" />
              </Link>
            ) : (
              <span />
            )}
          </header>
          {/* top bar on every page: the "Just tell it" AI command bar (also searches the inventory) + new inquiries */}
          {(can('inventory') || can('leads')) && (
          <header className="relative z-30 flex flex-wrap items-center gap-3 border-b border-[#E5E9F0] bg-white px-4 py-3 sm:px-7 lg:gap-4 lg:py-3.5">
            {can('inventory') && <CommandBar enabled={tenant.features.ai !== false} />}
            <div className="ml-auto hidden items-center gap-2 lg:flex">
              {can('leads') && (
                <Link
                  href="/dealer/leads"
                  aria-label={unread ? `Inquiries, ${unread} new` : 'Inquiries'}
                  title={unread ? `${unread} new ${unread === 1 ? 'inquiry' : 'inquiries'}` : 'Inquiries'}
                  className="relative flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#E5E9F0] bg-white text-[#0F172A] hover:bg-[#F8FAFC]"
                >
                  <Bell className="h-5 w-5" strokeWidth={1.8} />
                  {!!unread && <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full border-2 border-white bg-[#2563EB]" />}
                </Link>
              )}
            </div>
          </header>
          )}
          {/* Facebook posting / Marketplace progress, on every page until it is done */}
          <FbActivityBar enabled={tenant.features.facebook !== false && can('inventory')} />
          <main className={cx('w-full flex-1 px-4 py-6 sm:px-7', wide ? 'max-w-none sm:py-6' : 'max-w-[1240px] sm:py-7')}>{children}</main>
        </div>
      </div>
    </TenantCtx.Provider>
  );
}
