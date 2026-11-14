'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Car, ExternalLink, FileText, Globe, Lock, RefreshCw, Search, Undo2, Wand2 } from 'lucide-react';
import { api, mediaUrl, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { money, num } from '@/lib/format';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Select, StatusBadge, Table, Tabs, Td, Textarea, cx } from '@/components/ui';

/* ───────────────────────── types (GET /platform/seo/:dealerId) ───────────────────────── */

type Tenant = { id: string; name: string; status: string; domains: { domain: string; isPrimary?: boolean }[] };

type PageRow = {
  key: string;
  label: string;
  kind: 'theme' | 'custom';
  inTheme: boolean | null;
  defaultPath: string;
  path: string;
  customPath: string | null;
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonicalUrl: string;
  defaultTitle: string;
  defaultDescription: string;
};

type VehicleRow = {
  id: string;
  publicId: string;
  name: string;
  status: string;
  stockNumber: string;
  image: string;
  price: number | null;
  mileage: number | null;
  slug: string;
  slugLocked: boolean;
  path: string;
  metaTitle: string;
  metaDescription: string;
  autoTitle: string;
  autoDescription: string;
};

type SeoData = {
  dealer: { id: string; name: string; status: string; themeId: string; themeName: string; site: { url: string; domain: string; fixed: boolean } };
  ranges: { title: [number, number]; description: [number, number] };
  pages: PageRow[];
  vehicleSettings: {
    inventoryBase: string;
    previousBases: string[];
    titleTemplate: string;
    descriptionTemplate: string;
    defaults: { title: string; description: string };
    vars: string[];
    dealer: { name: string; city: string; state: string };
  };
  vehicles: { items: VehicleRow[]; total: number; page: number; pageSize: number };
  redirects: { from: string; to: string; hits: number; createdAt: string }[];
};

type Draft = Pick<PageRow, 'key' | 'metaTitle' | 'metaDescription' | 'ogTitle' | 'ogDescription' | 'ogImage' | 'canonicalUrl'> & { path: string };

/* ───────────────────────── small pieces ───────────────────────── */

/** live character count: green inside the recommended range, amber when short, red when too long */
function Counter({ value, range, fallback }: { value: string; range: [number, number]; fallback?: string }) {
  const n = value.length;
  const shown = n || (fallback || '').length;
  const color = !n ? 'text-slate-400' : n > range[1] ? 'text-red-600' : n >= range[0] ? 'text-emerald-600' : 'text-amber-600';
  return (
    <span className={cx('text-[11px] font-semibold tabular-nums', color)}>
      {n ? `${n} chars` : fallback ? `${shown} chars (default)` : '0 chars'} · {range[0]}–{range[1]} recommended
    </span>
  );
}

function FieldTop({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {right}
    </div>
  );
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** How the result looks in Google: site, breadcrumb address, blue title, grey description. */
function Snippet({ siteName, url, title, description }: { siteName: string; url: string; title: string; description: string }) {
  let crumbs = url;
  try {
    const u = new URL(url);
    crumbs = [u.origin, ...u.pathname.split('/').filter(Boolean)].join(' › ');
  } catch {
    /* keep */
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 font-[arial,sans-serif]">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Google preview</div>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{(siteName || '?').charAt(0).toUpperCase()}</div>
        <div className="min-w-0">
          <div className="truncate text-[14px] leading-tight text-[#202124]">{siteName || 'Your dealership'}</div>
          <div className="truncate text-[12px] leading-tight text-[#4d5156]">{crumbs}</div>
        </div>
      </div>
      <div className="mt-1.5 text-[19px] leading-snug text-[#1a0dab] hover:underline">{cut(title || 'Page title', 62)}</div>
      <div className="mt-0.5 text-[13px] leading-snug text-[#4d5156]">{cut(description || 'Add a meta description so Google shows your own words here.', 160)}</div>
    </div>
  );
}

/** address input with the dealership's fixed domain in front (read-only) */
function PathInput({ prefix, value, onChange, placeholder, disabled }: { prefix: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div className={cx('flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-600/20', disabled && 'bg-slate-100')}>
      <span className="flex max-w-[55%] shrink-0 items-center gap-1 truncate border-r border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-500" title={prefix}>
        <Lock className="h-3 w-3 shrink-0" /> <span className="truncate">{prefix}</span>
      </span>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
        placeholder={placeholder}
        className="min-w-0 flex-1 px-2.5 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:bg-slate-100"
      />
    </div>
  );
}

/* ───────────────────────── vehicle template preview (same rules as the backend's seo.util.ts) ───────────────────────── */

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let s = String(tpl || '').replace(/\{([a-zA-Z]+)\}/g, (_m, k: string) => {
    const key = Object.keys(vars).find((x) => x.toLowerCase() === k.toLowerCase());
    return key ? vars[key] : '';
  });
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  s = s.replace(/,(\s*,)+/g, ',');
  s = s.replace(/\b(in|at|near|from)\s*,\s*/gi, '$1 ');
  s = s.replace(/\b(in|at|near|from)\s*([|.\-–—]|$)/gi, '$2');
  s = s.replace(/,\s*([|.\-–—])/g, ' $1');
  s = s.replace(/([.!?])\s*\1+/g, '$1');
  s = s.replace(/(^|[.!?]\s)\s*(miles|mi)\b,?\s*/gi, '$1');
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/([,.])(?:\s*[,.])+/g, '$1');
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/([.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  return s.replace(/^[\s|,.\-–—]+|[\s|,\-–—]+$/g, '').trim();
}

function sampleVars(v: VehicleRow | undefined, d: { name: string; city: string; state: string }): Record<string, string> {
  const parts = (v?.name || '2022 Ford F-150 Lariat').split(' ');
  const year = /^\d{4}$/.test(parts[0]) ? parts.shift()! : '';
  return {
    year,
    make: parts[0] || '',
    model: parts[1] || '',
    trim: parts.slice(2).join(' '),
    price: v?.price ? '$' + Math.round(v.price).toLocaleString('en-US') : 'call for price',
    mileage: v?.mileage !== null && v?.mileage !== undefined ? Math.round(v.mileage).toLocaleString('en-US') : '',
    dealerName: d.name,
    city: d.city,
    state: d.state,
    stock: v?.stockNumber || '',
    vin: '',
    body: '',
    condition: 'Used',
    color: '',
  };
}

/** clickable {placeholder} chips that insert at the cursor of the field last focused */
function Chips({ vars, onPick }: { vars: string[]; onPick: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(v)}
          className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
        >
          {`{${v}}`}
        </button>
      ))}
    </div>
  );
}

function insertAt(el: HTMLInputElement | HTMLTextAreaElement | null, value: string, token: string, set: (v: string) => void) {
  if (!el) return set(value + token);
  const a = el.selectionStart ?? value.length;
  const b = el.selectionEnd ?? value.length;
  const next = value.slice(0, a) + token + value.slice(b);
  set(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + token.length, a + token.length);
  });
}

/* ───────────────────────── page ───────────────────────── */

export default function SeoManager() {
  const toast = useToast();
  const tenants = useApi<Tenant[]>('/platform/tenants');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'pages' | 'vehicles'>('pages');
  const [vq, setVq] = useState('');
  const [vqLive, setVqLive] = useState('');
  const [vpage, setVpage] = useState(1);

  // ?dealer=<id>&tab=vehicles
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('dealer')) setSelected(q.get('dealer')!);
    if (q.get('tab') === 'vehicles') setTab('vehicles');
  }, []);
  useEffect(() => {
    if (!selected && tenants.data?.length) setSelected(tenants.data[0].id);
  }, [tenants.data, selected]);
  useEffect(() => {
    if (selected) window.history.replaceState(null, '', `/platform/seo?dealer=${encodeURIComponent(selected)}${tab === 'vehicles' ? '&tab=vehicles' : ''}`);
  }, [selected, tab]);
  useEffect(() => {
    const t = setTimeout(() => {
      setVqLive(vq);
      setVpage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [vq]);

  const path = selected ? `/platform/seo/${encodeURIComponent(selected)}?q=${encodeURIComponent(vqLive)}&page=${vpage}&pageSize=25` : null;
  const seo = useApi<SeoData>(path);
  const data = seo.data && seo.data.dealer.id === selected ? seo.data : null;
  const tenant = tenants.data?.find((t) => t.id === selected);

  /** fixed website address of the dealership (its domain); the shared website app when it has none */
  const domainUrl = data?.dealer.site.url || (tenant ? siteUrl({ id: tenant.id, domains: tenant.domains.map((d) => d.domain) }).replace(/\/\?.*$/, '').replace(/\/$/, '') : '');
  const view = (p: string) => (tenant ? siteUrl({ id: tenant.id, domains: tenant.domains.map((d) => d.domain) }, p.replace(/^\/+/, '')) : '#');

  if (tenants.error) return <ErrorBox error={tenants.error} retry={tenants.reload} />;
  if (!tenants.data) return <Loading />;

  return (
    <>
      <PageHeader
        title="SEO & URLs"
        desc="Clean addresses, Google titles and descriptions for every dealership website. Changing an address never breaks old links: the old address answers with a permanent (301) redirect to the new one."
      />

      {/* dealer selector bar */}
      <Card className="mb-5" pad={false}>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
            <Globe className="h-5 w-5" />
          </div>
          <div className="min-w-[240px] flex-1 sm:max-w-sm">
            <Select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setVq('');
                setVpage(1);
              }}
              aria-label="Dealership"
            >
              {tenants.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.status === 'SUSPENDED' ? '(suspended)' : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Domain</span>
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-700" title="Fixed — change domains in Dealerships">
              <Lock className="h-3 w-3 shrink-0 text-slate-400" />
              <span className="truncate">{domainUrl || '—'}</span>
            </span>
            {data && !data.dealer.site.fixed && <Badge color="amber">No own domain yet — shared website address</Badge>}
          </div>
          {data && (
            <div className="text-xs text-slate-500">
              Design: <span className="font-semibold text-slate-700">{data.dealer.themeName}</span>
            </div>
          )}
          {tenant && (
            <a href={view('')} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline">
              View website <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </Card>

      <Tabs
        tabs={[
          { id: 'pages', label: <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4" /> Pages & URLs</span> },
          { id: 'vehicles', label: <span className="inline-flex items-center gap-1.5"><Car className="h-4 w-4" /> Vehicle URLs & Meta</span> },
        ]}
        value={tab}
        onChange={(v) => setTab(v === 'vehicles' ? 'vehicles' : 'pages')}
      />

      {seo.error && <ErrorBox error={seo.error} retry={seo.reload} />}
      {!data && !seo.error && <Loading />}
      {data && tab === 'pages' && <PagesTab key={data.dealer.id} data={data} domainUrl={domainUrl} view={view} onSaved={seo.reload} toast={toast} />}
      {data && tab === 'vehicles' && (
        <VehiclesTab
          key={data.dealer.id}
          data={data}
          domainUrl={domainUrl}
          view={view}
          reload={seo.reload}
          toast={toast}
          q={vq}
          setQ={setVq}
          loading={seo.loading}
          onPage={setVpage}
        />
      )}
    </>
  );
}

type ToastApi = ReturnType<typeof useToast>;

/* ───────────────────────── Tab 1: Pages & URLs ───────────────────────── */

function toDraft(p: PageRow): Draft {
  return {
    key: p.key,
    path: p.key === 'home' ? '' : p.customPath ?? '',
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    ogTitle: p.ogTitle,
    ogDescription: p.ogDescription,
    ogImage: p.ogImage,
    canonicalUrl: p.canonicalUrl,
  };
}

function PagesTab({ data, domainUrl, view, onSaved, toast }: { data: SeoData; domainUrl: string; view: (p: string) => string; onSaved: () => void; toast: ToastApi }) {
  const initial = useMemo(() => Object.fromEntries(data.pages.map((p) => [p.key, toDraft(p)])), [data.pages]);
  const [draft, setDraft] = useState<Record<string, Draft>>(initial);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  useEffect(() => setDraft(initial), [initial]);

  const dirtyKeys = data.pages.filter((p) => JSON.stringify(draft[p.key]) !== JSON.stringify(initial[p.key])).map((p) => p.key);
  const set = (key: string, patch: Partial<Draft>) => setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api<{ moved: { from: string; to: string }[] }>(`/platform/seo/${encodeURIComponent(data.dealer.id)}/pages`, {
        method: 'PUT',
        body: { pages: dirtyKeys.map((k) => draft[k]) },
      });
      toast.ok(res.moved?.length ? `Saved — ${res.moved.length} address${res.moved.length > 1 ? 'es' : ''} changed, old links redirect (301).` : 'Saved — live on the website now.');
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const shown = data.pages.filter((p) => !filter || `${p.label} ${p.path}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="sticky top-[60px] z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a page…" className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          {dirtyKeys.length > 0 && <span className="text-xs font-semibold text-amber-700">{dirtyKeys.length} page{dirtyKeys.length > 1 ? 's' : ''} changed</span>}
          <Button variant="secondary" disabled={!dirtyKeys.length || saving} onClick={() => setDraft(initial)}>
            <Undo2 className="h-4 w-4" /> Discard
          </Button>
          <Button disabled={!dirtyKeys.length} loading={saving} onClick={save}>
            Save changes
          </Button>
        </div>
      </div>

      {shown.map((p) => {
        const d = draft[p.key] || toDraft(p);
        const effective = p.key === 'home' ? '' : d.path.trim() ? d.path.trim().replace(/^\/+|\/+$/g, '') : p.defaultPath;
        const url = `${domainUrl}/${effective}`;
        const moved = p.key !== 'home' && (p.customPath ?? '') !== d.path.trim().replace(/^\/+|\/+$/g, '');
        return (
          <Card
            key={p.key}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {p.label}
                {p.kind === 'custom' ? <Badge color="violet">Pages & SEO page</Badge> : <Badge color="slate">Design page</Badge>}
                {p.inTheme === false && <Badge color="amber">Shown inside the home page in this design</Badge>}
                {dirtyKeys.includes(p.key) && <Badge color="blue">Unsaved</Badge>}
              </span>
            }
            actions={
              <a href={view(p.path)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                Open <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-4">
                <div>
                  <FieldTop label="URL path" right={p.key === 'home' ? <span className="text-[11px] text-slate-400">The home page always lives at "/"</span> : <span className="text-[11px] text-slate-400">Empty = design address /{p.defaultPath}</span>} />
                  <PathInput prefix={`${domainUrl}/`} value={d.path} onChange={(v) => set(p.key, { path: v })} placeholder={p.key === 'home' ? '' : p.defaultPath} disabled={p.key === 'home'} />
                  {moved && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-amber-700">
                      /{p.customPath || p.defaultPath} <ArrowRight className="h-3 w-3" /> /{effective} — the old address will redirect (301).
                    </p>
                  )}
                </div>
                <div>
                  <FieldTop label="Meta title" right={<Counter value={d.metaTitle} range={data.ranges.title} fallback={p.defaultTitle} />} />
                  <Input value={d.metaTitle} onChange={(e) => set(p.key, { metaTitle: e.target.value })} placeholder={p.defaultTitle || 'Set by the design'} maxLength={200} />
                </div>
                <div>
                  <FieldTop label="Meta description" right={<Counter value={d.metaDescription} range={data.ranges.description} fallback={p.defaultDescription} />} />
                  <Textarea value={d.metaDescription} onChange={(e) => set(p.key, { metaDescription: e.target.value })} placeholder={p.defaultDescription || 'Set by the design'} maxLength={400} className="min-h-[72px]" />
                </div>
                <details className="group rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-slate-600">OpenGraph & canonical (optional — default to the address, title and description above)</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Share title (og:title)">
                      <Input value={d.ogTitle} onChange={(e) => set(p.key, { ogTitle: e.target.value })} placeholder={d.metaTitle || p.defaultTitle || 'Meta title'} />
                    </Field>
                    <Field label="Share image URL (og:image)">
                      <Input value={d.ogImage} onChange={(e) => set(p.key, { ogImage: e.target.value })} placeholder="https://… or /uploads/…" />
                    </Field>
                    <Field label="Share description (og:description)" className="sm:col-span-2">
                      <Textarea value={d.ogDescription} onChange={(e) => set(p.key, { ogDescription: e.target.value })} placeholder={d.metaDescription || p.defaultDescription || 'Meta description'} className="min-h-[60px]" />
                    </Field>
                    <Field label="Canonical URL" hint={`Leave empty to use ${url}`} className="sm:col-span-2">
                      <Input value={d.canonicalUrl} onChange={(e) => set(p.key, { canonicalUrl: e.target.value })} placeholder={url} />
                    </Field>
                  </div>
                </details>
              </div>
              <Snippet siteName={data.dealer.name} url={url} title={d.metaTitle || p.defaultTitle} description={d.metaDescription || p.defaultDescription} />
            </div>
          </Card>
        );
      })}
      {!shown.length && <Empty title="No page matches" />}

      <Card title={`Redirects (${data.redirects.length})`} pad={false}>
        {data.redirects.length ? (
          <Table head={['Old address', 'Goes to (301)', 'Visits', '']}>
            {data.redirects.map((r) => (
              <tr key={r.from}>
                <Td className="font-mono text-xs">{r.from}</Td>
                <Td className="font-mono text-xs">{r.to}</Td>
                <Td>{num(r.hits)}</Td>
                <Td className="text-right">
                  <a href={view(r.from)} target="_blank" rel="noopener" className="text-xs font-semibold text-blue-700 hover:underline">
                    Test
                  </a>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="p-5 text-sm text-slate-500">No redirects yet. They are created automatically when you change a page address or a vehicle slug.</p>
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── Tab 2: Vehicle URLs & Meta ───────────────────────── */

function VehiclesTab({
  data,
  domainUrl,
  view,
  reload,
  toast,
  q,
  setQ,
  loading,
  onPage,
}: {
  data: SeoData;
  domainUrl: string;
  view: (p: string) => string;
  reload: () => void;
  toast: ToastApi;
  q: string;
  setQ: (v: string) => void;
  loading: boolean;
  onPage: (p: number) => void;
}) {
  const vs = data.vehicleSettings;
  const [base, setBase] = useState(vs.inventoryBase);
  const [titleTpl, setTitleTpl] = useState(vs.titleTemplate || vs.defaults.title);
  const [descTpl, setDescTpl] = useState(vs.descriptionTemplate || vs.defaults.description);
  const [savingTpl, setSavingTpl] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [focus, setFocus] = useState<'title' | 'desc'>('title');

  useEffect(() => {
    setBase(vs.inventoryBase);
    setTitleTpl(vs.titleTemplate || vs.defaults.title);
    setDescTpl(vs.descriptionTemplate || vs.defaults.description);
  }, [vs.inventoryBase, vs.titleTemplate, vs.descriptionTemplate, vs.defaults.title, vs.defaults.description]);

  const sample = data.vehicles.items.find((v) => v.status === 'PUBLISHED') || data.vehicles.items[0];
  const vars = sampleVars(sample, vs.dealer);
  const previewTitle = fillTemplate(titleTpl, vars);
  const previewDesc = fillTemplate(descTpl, vars);
  const tplDirty = base !== vs.inventoryBase || titleTpl !== (vs.titleTemplate || vs.defaults.title) || descTpl !== (vs.descriptionTemplate || vs.defaults.description);
  const cleanBase = base.trim().replace(/^\/+|\/+$/g, '') || 'inventory';

  const saveTemplate = async () => {
    setSavingTpl(true);
    try {
      const res = await api<{ inventoryBase: string; slugs: { created: number; updated: number } }>(`/platform/seo/${encodeURIComponent(data.dealer.id)}/vehicle-template`, {
        method: 'PUT',
        body: { inventoryBase: base, titleTemplate: titleTpl, descriptionTemplate: descTpl },
      });
      const extra = res.slugs.created ? ` ${res.slugs.created} vehicle${res.slugs.created > 1 ? 's' : ''} got a clean address.` : '';
      toast.ok(`Vehicle template saved.${base !== vs.inventoryBase ? ` Vehicle addresses now start with /${res.inventoryBase}/ — old ones redirect (301).` : ''}${extra}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingTpl(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const r = await api<{ created: number; updated: number }>(`/platform/seo/${encodeURIComponent(data.dealer.id)}/vehicles/regenerate`, { method: 'POST' });
      toast.ok(`Clean slugs regenerated: ${r.updated} changed, ${r.created} new. Old addresses redirect (301).`);
      setConfirmRegen(false);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const pick = (v: string) => {
    const token = `{${v}}`;
    if (focus === 'desc') insertAt(descRef.current, descTpl, token, setDescTpl);
    else insertAt(titleRef.current, titleTpl, token, setTitleTpl);
  };

  return (
    <div className="space-y-4">
      <Card
        title="Default vehicle URL & meta template"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmRegen(true)}>
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate clean slugs
            </Button>
            <Button size="sm" disabled={!tplDirty} loading={savingTpl} onClick={saveTemplate}>
              Save template
            </Button>
          </>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <div>
              <FieldTop label="Vehicle address" right={<span className="text-[11px] text-slate-400">/{cleanBase}/2022-ford-f150-lariat</span>} />
              <PathInput prefix={`${domainUrl}/`} value={base} onChange={setBase} placeholder="inventory" />
              {vs.previousBases.length > 0 && <p className="mt-1 text-[11px] text-slate-500">Earlier addresses still redirect: {vs.previousBases.map((b) => `/${b}/…`).join(', ')}</p>}
            </div>
            <div>
              <FieldTop label="Meta title template" right={<Counter value={previewTitle} range={data.ranges.title} />} />
              <Input ref={titleRef} value={titleTpl} onFocus={() => setFocus('title')} onChange={(e) => setTitleTpl(e.target.value)} maxLength={300} className="font-mono text-xs" />
            </div>
            <div>
              <FieldTop label="Meta description template" right={<Counter value={previewDesc} range={data.ranges.description} />} />
              <textarea
                ref={descRef}
                value={descTpl}
                onFocus={() => setFocus('desc')}
                onChange={(e) => setDescTpl(e.target.value)}
                maxLength={300}
                className="min-h-[72px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
            <div>
              <span className="text-[11px] text-slate-500">Click to insert into the {focus === 'desc' ? 'description' : 'title'}:</span>
              <Chips vars={vs.vars} onPick={pick} />
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => { setTitleTpl(vs.defaults.title); setDescTpl(vs.defaults.description); }}>
                Use the platform default
              </button>
              <span>· A dealer's own title / description on a vehicle, or an override below, always wins over the template.</span>
            </div>
          </div>
          <Snippet siteName={data.dealer.name} url={`${domainUrl}/${cleanBase}/${sample?.slug || '2022-ford-f150-lariat'}`} title={previewTitle} description={previewDesc} />
        </div>
      </Card>

      <Card
        title={`Vehicles (${num(data.vehicles.total)})`}
        pad={false}
        actions={
          <div className="relative w-64">
            <Search className="absolute left-3 top-2 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Year, make, model, stock #…" className="py-1.5 pl-9" />
          </div>
        }
      >
        <div className={cx(loading && 'opacity-60')}>
          <Table
            head={['Vehicle', 'Clean URL', 'Meta title', '']}
            empty={!data.vehicles.items.length ? <Empty icon={<Car className="h-6 w-6" />} title={q ? 'No vehicle matches' : 'No vehicles yet'} /> : undefined}
          >
            {data.vehicles.items.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <Td>
                  <div className="flex items-center gap-3">
                    {v.image ? <img src={mediaUrl(v.image)} alt="" className="h-10 w-14 shrink-0 rounded object-cover" /> : <div className="h-10 w-14 shrink-0 rounded bg-slate-100" />}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{v.name}</div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <StatusBadge status={v.status} />
                        {v.stockNumber && <span>#{v.stockNumber}</span>}
                        {v.price !== null && <span>{money(v.price)}</span>}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <div className="flex items-center gap-1 font-mono text-xs text-slate-700">
                    {v.slugLocked && <span title="Typed by hand — Regenerate leaves it alone"><Lock className="h-3 w-3 text-slate-400" /></span>}
                    <span className="max-w-[260px] truncate" title={v.path}>{v.path || '—'}</span>
                  </div>
                </Td>
                <Td>
                  <div className={cx('max-w-[320px] truncate text-xs', v.metaTitle ? 'font-medium text-slate-800' : 'text-slate-400')} title={v.metaTitle || v.autoTitle}>
                    {v.metaTitle || v.autoTitle}
                  </div>
                  {v.metaTitle && <Badge color="blue">Override</Badge>}
                </Td>
                <Td className="whitespace-nowrap text-right">
                  {v.status === 'PUBLISHED' && v.path && (
                    <a href={view(v.path)} target="_blank" rel="noopener" className="mr-3 text-xs font-semibold text-slate-500 hover:text-blue-700">
                      View
                    </a>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.vehicles.page} pageSize={data.vehicles.pageSize} total={data.vehicles.total} onPage={onPage} />
        </div>
      </Card>

      <Modal
        open={confirmRegen}
        onClose={() => setConfirmRegen(false)}
        title="Regenerate clean slugs?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRegen(false)}>
              Cancel
            </Button>
            <Button loading={regenerating} onClick={regenerate}>
              <Wand2 className="h-4 w-4" /> Regenerate
            </Button>
          </>
        }
      >
        Every vehicle address that was not typed by hand is rebuilt as <span className="font-mono">/{vs.inventoryBase}/year-make-model-trim</span> (plus the stock number only when two vehicles would
        otherwise share an address). Changed addresses keep working — they redirect (301) to the new ones.
      </Modal>

      <VehicleDrawer v={editing} onClose={() => setEditing(null)} data={data} domainUrl={domainUrl} toast={toast} onSaved={reload} />
    </div>
  );
}

function VehicleDrawer({ v, onClose, data, domainUrl, toast, onSaved }: { v: VehicleRow | null; onClose: () => void; data: SeoData; domainUrl: string; toast: ToastApi; onSaved: () => void }) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!v) return;
    setSlug(v.slug);
    setTitle(v.metaTitle);
    setDesc(v.metaDescription);
  }, [v]);
  if (!v) return null;
  const base = data.vehicleSettings.inventoryBase;

  const save = async (resetSlug = false) => {
    setSaving(true);
    try {
      const body: Record<string, string> = { metaTitle: title, metaDescription: desc };
      if (resetSlug) body.slug = '';
      else if (slug.trim() !== v.slug) body.slug = slug.trim();
      const r = await api<{ path: string }>(`/platform/seo/${encodeURIComponent(data.dealer.id)}/vehicles/${encodeURIComponent(v.id)}`, { method: 'PATCH', body });
      toast.ok(`Saved — ${r.path}${r.path !== v.path ? ' (the old address redirects)' : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={v.name}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => save(false)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {v.status !== 'PUBLISHED' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">This vehicle is not published, so its address is not live yet (it sends visitors to the inventory page).</div>}
        <div>
          <FieldTop
            label="URL slug"
            right={
              v.slugLocked ? (
                <button type="button" disabled={saving} onClick={() => save(true)} className="text-[11px] font-semibold text-blue-700 hover:underline">
                  Back to the automatic slug
                </button>
              ) : (
                <span className="text-[11px] text-slate-400">Automatic — typing a slug locks it</span>
              )
            }
          />
          <PathInput prefix={`${domainUrl}/${base}/`} value={slug} onChange={setSlug} placeholder="2022-ford-f150-lariat" />
        </div>
        <div>
          <FieldTop label="Meta title" right={<Counter value={title} range={data.ranges.title} fallback={v.autoTitle} />} />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={v.autoTitle} maxLength={200} />
        </div>
        <div>
          <FieldTop label="Meta description" right={<Counter value={desc} range={data.ranges.description} fallback={v.autoDescription} />} />
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={v.autoDescription} maxLength={400} />
          <p className="mt-1 text-[11px] text-slate-500">Leave empty to use the dealer's own text or the template.</p>
        </div>
        <Snippet siteName={data.dealer.name} url={`${domainUrl}/${base}/${slug || v.slug}`} title={title || v.autoTitle} description={desc || v.autoDescription} />
      </div>
    </Drawer>
  );
}
