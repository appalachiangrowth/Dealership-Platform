'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Palette, Type, Car, Newspaper, Inbox, Users, Settings2, ExternalLink, LogOut, Menu, Plus, KeyRound, Rss, LifeBuoy, ShieldAlert, X,
} from 'lucide-react';
import { api, auth, mediaUrl, siteUrl, PLATFORM_ADMIN_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Loading, cx } from './ui';

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

type Item = { href: string; label: string; icon: React.ElementType; perm: string[]; step?: number; feature?: string; badge?: number };

export function DealerShell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [tenant, setTenant] = useState<DealerTenant | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
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

  if (loading || !me || !tenant) return <Loading />;

  const groups: { title?: string; items: Item[] }[] = [
    { items: [{ href: '/dealer', label: 'Overview', icon: LayoutDashboard, perm: ['dashboard'] }] },
    {
      title: 'Your website',
      items: [
        { href: '/dealer/business', label: 'Business details', icon: Building2, perm: ['business'], step: 1 },
        { href: '/dealer/design', label: 'Design & colours', icon: Palette, perm: ['design'], step: 2 },
        { href: '/dealer/content', label: 'Website content', icon: Type, perm: ['content'], step: 3 },
      ],
    },
    {
      title: 'Inventory',
      items: [
        { href: '/dealer/inventory', label: 'Inventory', icon: Car, perm: ['inventory'] },
        { href: '/dealer/cargurus', label: 'CarGurus feed', icon: Rss, perm: ['inventory'], feature: 'cargurus' },
        { href: '/dealer/blog', label: 'Blog & news', icon: Newspaper, perm: ['blog'], feature: 'blog' },
      ],
    },
    { title: 'Customers', items: [{ href: '/dealer/leads', label: 'Leads & inquiries', icon: Inbox, perm: ['leads'], badge: unread }] },
    {
      title: 'Settings',
      items: [
        { href: '/dealer/team', label: 'Team & permissions', icon: Users, perm: ['users'] },
      ],
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
    <aside className="flex h-full w-64 flex-col bg-[#0b2340] text-slate-200">
      <div className="flex items-center gap-3 px-5 py-5">
        {tenant.logo ? (
          <img src={mediaUrl(tenant.logo)} alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-1" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 font-heading text-sm font-extrabold">{tenant.name.slice(0, 2).toUpperCase()}</div>
        )}
        <div className="min-w-0">
          <div className="truncate font-heading text-sm font-bold text-white">{tenant.name}</div>
          <div className="text-[11px] text-slate-400">Dealership Portal</div>
        </div>
      </div>
      {can('inventory') && (
        <div className="px-4 pb-3">
          <Link href="/dealer/inventory/new" className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600">
            <Plus className="h-4 w-4" /> Add vehicle
          </Link>
        </div>
      )}
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {visible.map((g, gi) => (
          <div key={gi}>
            {g.title && <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{g.title}</div>}
            {g.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive(i.href) ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                )}
              >
                {i.step ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">{i.step}</span>
                ) : (
                  <i.icon className="h-4 w-4" />
                )}
                <span className="flex-1">{i.label}</span>
                {!!i.badge && <span className="rounded-full bg-blue-500 px-1.5 text-[10px] font-bold text-white">{i.badge}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="space-y-2 border-t border-white/10 p-4">
        <a href={siteUrl(tenant)} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/5">
          <ExternalLink className="h-3.5 w-3.5" /> View your website
        </a>
        {(me.support.email || me.support.phone) && (
          <div className="flex items-start gap-2 px-2 text-[11px] text-slate-400">
            <LifeBuoy className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Need help? {me.support.phone} {me.support.email}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-white">{me.user.name || me.user.login}</div>
            <div className="truncate text-[10px] text-slate-400">{support ? 'Platform owner' : me.catalog.roles[me.user.role]?.label || me.user.role}</div>
          </div>
          {!support && (
            <Link href="/dealer/account" title="Password" className="rounded p-1 text-slate-400 hover:text-white">
              <KeyRound className="h-4 w-4" />
            </Link>
          )}
          <button onClick={logout} title="Log out" className="rounded p-1 text-slate-400 hover:text-white">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <TenantCtx.Provider value={{ tenant, support, refreshTenant: () => void loadTenant() }}>
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
          <main className={cx('mx-auto w-full flex-1 px-4 py-6 sm:px-8', wide ? 'max-w-none sm:py-6' : 'max-w-7xl sm:py-8')}>{children}</main>
        </div>
      </div>
    </TenantCtx.Provider>
  );
}
