'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Globe, Layers, Palette, Plus, Search } from 'lucide-react';
import { api, mediaUrl, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { TEMPLATES } from '@/lib/page-sections';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, cx } from '@/components/ui';

type Row = {
  id: string; tenantId: string | null; tenantName: string; title: string; slug: string; status: 'DRAFT' | 'PUBLISHED';
  showInNav: boolean; unpublishedChanges: boolean; updatedAt: string; updatedBy: string; sectionCount: number;
};
type Tenant = { id: string; name: string; themeId: string; status: string; domains: { domain: string }[] };
type ThemeRow = { id: string; name: string; previewUrl?: string; style?: string };

const SHARED = '__shared';

function pageStatus(p: { status: string; unpublishedChanges?: boolean }) {
  if (p.status !== 'PUBLISHED') return <Badge color="slate">Draft</Badge>;
  return p.unpublishedChanges ? <Badge color="amber">Published · changes not live</Badge> : <Badge color="green">Published</Badge>;
}

const site = (t?: Tenant, path = '') => (t ? siteUrl({ id: t.id, domains: t.domains.map((d) => d.domain) }, path) : '');

/** Platform Admin › Pages & SEO: every dealership with its theme → its pages → add / edit */
export default function PagesHome() {
  const all = useApi<{ pages: Row[] }>('/platform/pages');
  const tenants = useApi<Tenant[]>('/platform/tenants');
  const themes = useApi<{ themes: ThemeRow[] }>('/platform/themes');
  const [selected, setSelected] = useState('');
  const [q, setQ] = useState('');
  const [newFor, setNewFor] = useState<string | null>(null);

  // ?dealer=<id> opens that dealership (links from the editor come back here)
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('dealer');
    if (d) setSelected(d);
  }, []);
  useEffect(() => {
    if (!selected && tenants.data?.length) setSelected(tenants.data[0].id);
  }, [tenants.data, selected]);
  const pick = (id: string) => {
    setSelected(id);
    window.history.replaceState(null, '', `/platform/pages?dealer=${encodeURIComponent(id)}`);
  };

  const pages = all.data?.pages || [];
  const shared = pages.filter((p) => !p.tenantId);
  const themeOf = (id: string) => themes.data?.themes.find((t) => t.id === id);
  const ownCount = (id: string) => pages.filter((p) => p.tenantId === id).length;

  const list = (tenants.data || []).filter((t) => !q || `${t.name} ${t.id} ${t.domains.map((d) => d.domain).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  const tenant = tenants.data?.find((t) => t.id === selected);
  const theme = tenant ? themeOf(tenant.themeId) : undefined;
  const shown = useMemo(() => {
    if (selected === SHARED) return shared;
    // a dealership's own pages, then the shared ones (its own page wins over a shared page with the same address)
    const own = pages.filter((p) => p.tenantId === selected);
    return [...own, ...shared.filter((s) => !own.some((o) => o.slug === s.slug))];
  }, [pages, shared, selected]);

  if (!tenants.data || !all.data) return <Loading />;

  return (
    <>
      <PageHeader
        title="Pages & SEO"
        desc="Choose a dealership to see its theme and its pages. A page takes the header, footer, fonts and colours of the dealership's theme — when the dealer switches theme, every page switches with it, even pages that are already published."
      />
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* dealerships + their theme */}
        <Card pad={false} className="self-start">
          <div className="border-b border-slate-100 p-3">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dealership…" className="pl-9" />
            </div>
          </div>
          <div className="max-h-[calc(100vh-260px)] divide-y divide-slate-100 overflow-y-auto">
            <DealerRow
              active={selected === SHARED}
              onClick={() => pick(SHARED)}
              icon={<Layers className="h-5 w-5" />}
              name="Every dealership"
              sub="Shared pages, shown on all websites"
              count={shared.length}
              onAdd={() => setNewFor(SHARED)}
            />
            {list.map((t) => {
              const th = themeOf(t.themeId);
              return (
                <DealerRow
                  key={t.id}
                  active={selected === t.id}
                  onClick={() => pick(t.id)}
                  thumb={th?.previewUrl ? mediaUrl(th.previewUrl) : ''}
                  name={t.name}
                  sub={
                    <span className="inline-flex items-center gap-1">
                      <Palette className="h-3 w-3" /> {th?.name || t.themeId}
                      {t.status === 'SUSPENDED' && <span className="ml-1 text-red-600">· suspended</span>}
                    </span>
                  }
                  count={ownCount(t.id)}
                  onAdd={() => setNewFor(t.id)}
                />
              );
            })}
          </div>
        </Card>

        {/* the selected dealership's pages */}
        <div className="space-y-4">
          <Card pad={false}>
            <div className="flex flex-wrap items-center gap-4 p-5">
              {selected === SHARED ? (
                <div className="flex h-16 w-28 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <Layers className="h-7 w-7" />
                </div>
              ) : theme?.previewUrl ? (
                <img src={mediaUrl(theme.previewUrl)} alt="" className="h-16 w-28 rounded-lg border border-slate-200 object-cover" />
              ) : (
                <div className="flex h-16 w-28 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                  <Palette className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-slate-900">{selected === SHARED ? 'Pages for every dealership' : tenant?.name}</h2>
                <p className="text-sm text-slate-500">
                  {selected === SHARED ? (
                    'Each website shows these pages in its own theme, with its own name, phone and address.'
                  ) : (
                    <>
                      Theme <b className="text-slate-700">{theme?.name || tenant?.themeId}</b>
                      {theme?.style ? ` · ${theme.style}` : ''} — its pages use this theme and follow it automatically when it changes.
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tenant && selected !== SHARED && (
                  <a href={site(tenant)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                    <Globe className="h-4 w-4" /> View website
                  </a>
                )}
                <Button onClick={() => setNewFor(selected)}>
                  <Plus className="h-4 w-4" /> Add page
                </Button>
              </div>
            </div>
          </Card>

          <Card pad={false}>
            {!shown.length ? (
              <Empty
                icon={<FileText className="h-6 w-6" />}
                title="No pages yet"
                desc="Start from a ready-made page (Financing, Trade-in, landing page…) or a blank one."
                action={<Button onClick={() => setNewFor(selected)}>Add page</Button>}
              />
            ) : (
              <Table head={['Page', 'Status', 'Menu', 'Updated', '']}>
                {shown.map((p) => {
                  const url = tenant && selected !== SHARED ? site(tenant, p.slug) : tenants.data?.[0] ? site(tenants.data[0], p.slug) : '';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/platform/pages/${p.id}`} className="font-semibold text-slate-900 hover:underline">
                          {p.title}
                        </Link>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          /{p.slug} · {p.sectionCount} section{p.sectionCount === 1 ? '' : 's'}
                          {!p.tenantId && selected !== SHARED && <Badge color="violet">Shared</Badge>}
                        </div>
                      </Td>
                      <Td>{pageStatus(p)}</Td>
                      <Td>{p.showInNav ? <Badge color="green">In menu</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
                      <Td className="text-xs text-slate-500">{new Date(p.updatedAt).toLocaleString()}</Td>
                      <Td className="whitespace-nowrap text-right">
                        {p.status === 'PUBLISHED' && url && (
                          <a href={url} target="_blank" rel="noreferrer" className="mr-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <Link href={`/platform/pages/${p.id}${selected && selected !== SHARED ? `?dealer=${selected}` : ''}`} className="text-xs font-semibold text-slate-700 hover:underline">
                          Edit
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>
      </div>
      <NewPage
        forScope={newFor}
        onClose={() => setNewFor(null)}
        tenants={tenants.data}
        themeName={(id) => {
          const t = tenants.data?.find((x) => x.id === id);
          return t ? themeOf(t.themeId)?.name || t.themeId : '';
        }}
        onCreated={all.reload}
      />
    </>
  );
}

function DealerRow({
  active, onClick, thumb, icon, name, sub, count, onAdd,
}: { active: boolean; onClick: () => void; thumb?: string; icon?: React.ReactNode; name: string; sub: React.ReactNode; count: number; onAdd: () => void }) {
  return (
    <div className={cx('flex items-center gap-3 px-3 py-2.5 transition', active ? 'bg-blue-50' : 'hover:bg-slate-50')}>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {thumb ? (
          <img src={thumb} alt="" className="h-10 w-16 shrink-0 rounded-md border border-slate-200 object-cover" />
        ) : (
          <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">{icon || <Palette className="h-4 w-4" />}</span>
        )}
        <span className="min-w-0">
          <span className={cx('block truncate text-sm font-semibold', active ? 'text-blue-800' : 'text-slate-900')}>{name}</span>
          <span className="block truncate text-xs text-slate-500">{sub}</span>
        </span>
      </button>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600" title="Pages">
        {count}
      </span>
      <button type="button" onClick={onAdd} title="Add page" className="shrink-0 rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:border-blue-500 hover:text-blue-700">
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function NewPage({
  forScope, onClose, tenants, themeName, onCreated,
}: { forScope: string | null; onClose: () => void; tenants: Tenant[]; themeName: (id: string) => string; onCreated: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [tpl, setTpl] = useState('blank');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (forScope !== null) {
      setScope(forScope === SHARED ? '' : forScope);
      setTitle('');
    }
  }, [forScope]);
  const t = TEMPLATES.find((x) => x.id === tpl)!;

  const create = async () => {
    setBusy(true);
    try {
      const p = await api<{ id: string }>('/platform/pages', {
        body: { title: title.trim() || t.title || 'New page', slug: title.trim() ? undefined : t.slug || undefined, tenantId: scope, sections: t.sections(), seo: t.seo || {} },
      });
      onCreated();
      router.push(`/platform/pages/${p.id}${scope ? `?dealer=${scope}` : ''}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={forScope !== null}
      onClose={onClose}
      title="Add page"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} loading={busy}>
            Create & edit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="For" hint={scope ? `Uses ${themeName(scope)} — and whatever theme this dealership switches to later.` : 'Every website shows it in its own theme.'}>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Every dealership (shared page)</option>
            {tenants.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} — {themeName(x.id)}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Start from</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setTpl(x.id)}
                className={cx('rounded-xl border p-3 text-left transition', tpl === x.id ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-400')}
              >
                <div className="text-sm font-semibold text-slate-900">{x.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{x.desc}</div>
              </button>
            ))}
          </div>
        </div>
        <Field label="Page title" hint={t.title ? `Empty = “${t.title}” at /${t.slug}` : 'The address is made from the title; you can change it later.'}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.title || 'e.g. Financing'} />
        </Field>
      </div>
    </Modal>
  );
}
