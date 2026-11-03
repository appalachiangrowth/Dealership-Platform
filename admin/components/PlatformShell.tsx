'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Gauge, Building2, Car, Inbox, Users, Palette, ToggleRight, Settings, ShieldCheck, ScrollText, Server, LogOut, Menu, Plus, Search, KeyRound, Rss, X, FileText,
} from 'lucide-react';
import { api, auth, DEALER_PORTAL_URL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Loading, cx } from './ui';

const NAV: { title: string; items: { href: string; label: string; icon: React.ElementType }[] }[] = [
  {
    title: 'Monitor',
    items: [
      { href: '/platform', label: 'Overview', icon: Gauge },
      { href: '/platform/dealers', label: 'Dealerships', icon: Building2 },
      { href: '/platform/accounts', label: 'Dealer accounts', icon: Users },
      { href: '/platform/inventory', label: 'Inventory', icon: Car },
      { href: '/platform/leads', label: 'Leads & inquiries', icon: Inbox },
      { href: '/platform/cargurus', label: 'CarGurus audit', icon: Rss },
    ],
  },
  {
    title: 'Control',
    items: [
      { href: '/platform/themes', label: 'Themes & releases', icon: Palette },
      { href: '/platform/pages', label: 'Pages & SEO', icon: FileText },
      { href: '/platform/features', label: 'Feature flags', icon: ToggleRight },
      { href: '/platform/settings', label: 'Platform settings', icon: Settings },
    ],
  },
  {
    title: 'Access',
    items: [
      { href: '/platform/owners', label: 'Platform owners', icon: ShieldCheck },
      { href: '/platform/activity', label: 'Activity log', icon: ScrollText },
      { href: '/platform/system', label: 'System', icon: Server },
    ],
  },
];

function Jump() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ id: string; name: string; domain: string }[]>([]);
  const router = useRouter();
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(t.current);
    if (!q.trim()) return setRes([]);
    t.current = setTimeout(() => api(`/platform/jump?q=${encodeURIComponent(q)}`).then(setRes).catch(() => {}), 200);
  }, [q]);
  return (
    <div className="relative hidden w-72 md:block">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Jump to a dealership…"
        className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
      />
      {res.length > 0 && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
          {res.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setQ('');
                router.push(`/platform/dealers/${r.id}`);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-700"
            >
              {r.name} <span className="text-xs text-slate-500">{r.domain}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (me.user.kind !== 'owner') {
      // dealer logins use the separate Dealership Portal app
      auth.clear();
      window.location.href = DEALER_PORTAL_URL;
    }
    else auth.setSupportTenant('');
  }, [me, loading, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (loading || !me || me.user.kind !== 'owner') return <Loading />;
  const isActive = (h: string) => (h === '/platform' ? pathname === h : pathname.startsWith(h));

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-800 bg-slate-950 text-slate-300">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 font-heading text-sm font-extrabold text-white">AGS</div>
        <div>
          <div className="font-heading text-sm font-bold text-white">Platform Admin</div>
          <div className="text-[11px] text-slate-500">Appalachian Growth Solutions</div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => (
          <div key={g.title}>
            <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">{g.title}</div>
            {g.items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium', isActive(i.href) ? 'bg-slate-800 text-white' : 'hover:bg-slate-900 hover:text-white')}
              >
                <i.icon className="h-4 w-4" /> {i.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2 border-t border-slate-800 p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">PO</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white">{me.user.name || me.user.login}</div>
          <div className="text-[10px] text-slate-500">Platform owner</div>
        </div>
        <Link href="/platform/account" title="Password" className="p-1 text-slate-500 hover:text-white">
          <KeyRound className="h-4 w-4" />
        </Link>
        <button onClick={logout} title="Log out" className="p-1 text-slate-500 hover:text-white">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-slate-100">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64">{sidebar}</div>
          <button className="absolute left-[16.5rem] top-4 text-white" onClick={() => setOpen(false)}>
            <X />
          </button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 sm:px-8">
          <button onClick={() => setOpen(true)} className="text-white lg:hidden" aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-sm text-slate-400">{pathname.replace('/platform', 'Platform') || 'Platform'}</div>
          <div className="flex items-center gap-3">
            <Jump />
            <Link href="/platform/dealers/new" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Add dealership
            </Link>
          </div>
        </header>
        <main className={cx('mx-auto w-full flex-1', /^\/platform\/pages\/[^/]+$/.test(pathname) ? 'max-w-none' : 'max-w-7xl px-4 py-6 sm:px-8 sm:py-8')}>{children}</main>
      </div>
    </div>
  );
}
