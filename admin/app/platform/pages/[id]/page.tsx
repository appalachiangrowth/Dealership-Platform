'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Copy, ExternalLink, MoreHorizontal, Palette, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { api, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { SECTION_DEFS, TOKENS, make, type Section } from '@/lib/page-sections';
import { SectionCard, cloneSection, ImageField } from '@/components/PageSectionEditor';
import { PagePreview } from '@/components/PagePreview';
import { useToast } from '@/components/toast';
import { Badge, Button, Field, Input, Loading, Modal, Select, Tabs, Textarea, Toggle, ErrorBox, cx } from '@/components/ui';

type Seo = { title?: string; description?: string; image?: string; noindex?: boolean };
type PageData = {
  id: string; tenantId: string | null; tenantName: string; title: string; slug: string; status: 'DRAFT' | 'PUBLISHED';
  sections: Section[]; seo: Seo; showInNav: boolean; navLabel: string; navOrder: number; publishedAt: string | null; unpublishedChanges: boolean;
};
type Tenant = { id: string; name: string; themeId: string; domains: { domain: string }[] };
type ThemeRow = { id: string; name: string; previewUrl?: string };

/** Platform Admin › Pages & SEO › one page: sections on the left, the page inside the real website on the right */
export default function PageEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const loaded = useApi<PageData>(`/platform/pages/${id}`, [id]);
  const tenants = useApi<Tenant[]>('/platform/tenants');
  const themes = useApi<{ themes: ThemeRow[] }>('/platform/themes');

  const [p, setP] = useState<PageData | null>(null);
  const [tab, setTab] = useState('sections');
  const [openId, setOpenId] = useState<string>('');
  const [addAt, setAddAt] = useState<number | null>(null);
  const [saving, setSaving] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // preview
  const [previewTenant, setPreviewTenant] = useState('');
  const [token, setToken] = useState('');
  const [rev, setRev] = useState(0);
  const [focus, setFocus] = useState(-1);

  useEffect(() => {
    if (loaded.data) setP(loaded.data);
  }, [loaded.data]);

  // the dealership used for the preview: the page's own, otherwise the first one
  useEffect(() => {
    if (!p || !tenants.data?.length) return;
    if (p.tenantId) setPreviewTenant(p.tenantId);
    else if (!previewTenant) {
      // came from a dealership in Pages & SEO: preview with that one
      const d = new URLSearchParams(window.location.search).get('dealer');
      setPreviewTenant(tenants.data.some((t) => t.id === d) ? d! : tenants.data[0].id);
    }
  }, [p?.tenantId, tenants.data, previewTenant, p]);

  const refreshToken = useCallback(async () => {
    const r = await api<{ token: string }>(`/platform/pages/${id}/preview-token`, { method: 'POST' });
    setToken(r.token);
  }, [id]);
  useEffect(() => {
    void refreshToken();
    const t = setInterval(() => void refreshToken(), 2 * 3600_000);
    return () => clearInterval(t);
  }, [refreshToken]);

  /* ───── saving: every change is saved as a draft after a short pause, then the preview reloads ───── */
  const pending = useRef<Partial<PageData>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSaving('saving');
    try {
      const r = await api<PageData>(`/platform/pages/${id}`, { method: 'PATCH', body });
      setP((cur) => (cur ? { ...cur, status: r.status, unpublishedChanges: r.unpublishedChanges, slug: r.slug, tenantId: r.tenantId, tenantName: r.tenantName } : r));
      setSaving('saved');
      setRev((n) => n + 1);
    } catch (e) {
      setSaving('error');
      toast.error((e as Error).message);
    }
  }, [id, toast]);

  const change = (patch: Partial<PageData>, delay = 900) => {
    setP((cur) => (cur ? { ...cur, ...patch } : cur));
    pending.current = { ...pending.current, ...patch };
    setSaving('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), delay);
  };
  const flush = async () => {
    clearTimeout(timer.current);
    await save();
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const sections = p?.sections || [];
  const setSections = (list: Section[], focusIndex?: number) => {
    if (focusIndex !== undefined) setFocus(focusIndex);
    change({ sections: list });
  };

  /* ───── actions ───── */
  const act = async (what: string, fn: () => Promise<PageData | unknown>, ok: string) => {
    setBusy(what);
    setMenu(false);
    try {
      await flush();
      const r = await fn();
      if (r && typeof r === 'object' && 'id' in (r as PageData)) setP(r as PageData);
      toast.ok(ok);
      setRev((n) => n + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const tenant = tenants.data?.find((t) => t.id === previewTenant);
  const site = tenant ? siteUrl({ id: tenant.id, domains: tenant.domains.map((d) => d.domain) }) : '';
  const previewSrc = useMemo(() => {
    if (!site || !token || !p) return '';
    const qs = new URLSearchParams({ pa_page_preview: token, _: String(rev) });
    return `${site}/${p.slug}?${qs}${focus >= 0 ? `#pa-s-${focus}` : ''}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, token, p?.slug, rev]);

  if (loaded.error) return <ErrorBox error={loaded.error} retry={loaded.reload} />;
  if (!p) return <Loading />;

  const status =
    p.status !== 'PUBLISHED' ? <Badge color="slate">Draft</Badge> : p.unpublishedChanges ? <Badge color="amber">Changes not published</Badge> : <Badge color="green">Published</Badge>;
  const saveText = { idle: '', dirty: 'Unsaved…', saving: 'Saving…', saved: 'Draft saved', error: 'Not saved' }[saving];
  const themeName = (id?: string) => themes.data?.themes.find((t) => t.id === id)?.name || id || '';
  const tenantThemeName = themeName(tenant?.themeId);
  const backHref = `/platform/pages?dealer=${p.tenantId || '__shared'}`;

  return (
    <div className="flex h-[calc(100vh-60px)] flex-col">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link href={backHref} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="All pages">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-heading text-lg font-extrabold text-slate-900">{p.title}</h1>
            {status}
          </div>
          <div className="text-xs text-slate-500">
            /{p.slug} · {p.tenantId ? `only ${p.tenantName}` : 'every dealership'} {saveText && <span className={cx('ml-2', saving === 'error' ? 'text-red-600' : 'text-slate-400')}>· {saveText}</span>}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {p.status === 'PUBLISHED' && site && (
            <a href={`${site}/${p.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              View live <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <Button
            variant="success"
            loading={busy === 'publish'}
            onClick={() => {
              const inMenu = p.showInNav || !p.publishedAt;
              const where = p.tenantId ? `${p.tenantName}'s website` : 'every dealership website';
              act('publish', () => api(`/platform/pages/${id}/publish`, { method: 'POST' }), inMenu ? `Published on ${where} — “${p.navLabel || p.title}” is now in the header menu.` : `Published on ${where}.`);
            }}
          >
            {p.status === 'PUBLISHED' ? (p.unpublishedChanges ? 'Publish changes' : 'Published') : 'Publish'}
          </Button>
          <div className="relative">
            <Button variant="secondary" onClick={() => setMenu(!menu)}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menu && (
              <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-xl">
                {p.unpublishedChanges && (
                  <MenuBtn onClick={() => act('discard', () => api(`/platform/pages/${id}/discard`, { method: 'POST' }), 'Back to the published version.')}>
                    <Undo2 className="h-4 w-4" /> Discard unpublished changes
                  </MenuBtn>
                )}
                {p.status === 'PUBLISHED' && (
                  <MenuBtn onClick={() => act('unpublish', () => api(`/platform/pages/${id}/unpublish`, { method: 'POST' }), 'Taken off the website.')}>
                    <RotateCcw className="h-4 w-4" /> Unpublish
                  </MenuBtn>
                )}
                <MenuBtn
                  onClick={async () => {
                    setMenu(false);
                    try {
                      await flush();
                      const r = await api<PageData>(`/platform/pages/${id}/duplicate`, { method: 'POST', body: {} });
                      router.push(`/platform/pages/${r.id}`);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  <Copy className="h-4 w-4" /> Duplicate
                </MenuBtn>
                <MenuBtn danger onClick={() => (setMenu(false), setConfirmDelete(true))}>
                  <Trash2 className="h-4 w-4" /> Delete page
                </MenuBtn>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* editor */}
        <div className="flex w-full max-w-[480px] shrink-0 flex-col border-r border-slate-200 bg-slate-50">
          <div className="border-b border-slate-200 bg-white px-4 pt-3">
            <Tabs
              tabs={[
                { id: 'sections', label: `Sections (${sections.length})` },
                { id: 'settings', label: 'Page & menu' },
                { id: 'seo', label: 'SEO' },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {tab === 'sections' && (
              <>
                {sections.map((s, i) => (
                  <SectionCard
                    key={s.id}
                    s={s}
                    index={i}
                    count={sections.length}
                    open={openId === s.id}
                    onToggle={() => {
                      setOpenId(openId === s.id ? '' : s.id);
                      if (openId !== s.id) {
                        setFocus(i);
                        setRev((n) => n + 1);
                      }
                    }}
                    onChange={(n) => setSections(sections.map((x) => (x.id === s.id ? n : x)), i)}
                    onMove={(d) => {
                      const j = i + d;
                      const list = [...sections];
                      [list[i], list[j]] = [list[j], list[i]];
                      setSections(list, j);
                    }}
                    onDuplicate={() => {
                      const list = [...sections];
                      const c = cloneSection(s);
                      list.splice(i + 1, 0, c);
                      setOpenId(c.id);
                      setSections(list, i + 1);
                    }}
                    onDelete={() => setSections(sections.filter((x) => x.id !== s.id), Math.max(0, i - 1))}
                    onAddBelow={() => setAddAt(i + 1)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setAddAt(sections.length)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-4 text-sm font-semibold text-slate-600 hover:border-blue-500 hover:text-blue-700"
                >
                  <Plus className="h-4 w-4" /> Add section
                </button>
                <p className="px-1 text-xs text-slate-500">
                  Texts may use the dealership&apos;s details: <span className="font-mono">{TOKENS}</span>. Pages for every dealership show each one&apos;s own details.
                </p>
              </>
            )}

            {tab === 'settings' && (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                <Field label="Page title">
                  <Input value={p.title} onChange={(e) => change({ title: e.target.value })} />
                </Field>
                <Field label="Address" hint="a–z, 0–9 and dashes. Changing it breaks links to the old address.">
                  <div className="flex items-center rounded-lg border border-slate-300 bg-slate-50 pl-3 text-sm text-slate-500">
                    {site ? site.replace(/^https?:\/\//, '') : 'website'}/
                    <input
                      value={p.slug}
                      onChange={(e) => setP({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                      onBlur={() => change({ slug: p.slug }, 0)}
                      className="min-w-0 flex-1 rounded-r-lg border-0 bg-white px-2 py-2 text-slate-900 outline-none"
                    />
                  </div>
                </Field>
                <Field label="Shown on" hint="A dealership's own page replaces a shared page with the same address.">
                  <Select value={p.tenantId || ''} onChange={(e) => change({ tenantId: e.target.value || null }, 0)}>
                    <option value="">Every dealership&apos;s website</option>
                    {(tenants.data || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        Only {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="border-t border-slate-100 pt-4">
                  <Toggle
                    checked={p.showInNav}
                    onChange={(v) => change({ showInNav: v }, 0)}
                    label="Show in the website menu"
                    desc="On by default: when you publish, the page appears in the website header next to Home, Inventory… and in the mobile menu, styled like the theme's own links."
                  />
                </div>
                {p.showInNav && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Menu text">
                      <Input value={p.navLabel} onChange={(e) => change({ navLabel: e.target.value })} placeholder={p.title} />
                    </Field>
                    <Field label="Order" hint="Lower = first">
                      <Input type="number" value={p.navOrder} onChange={(e) => change({ navOrder: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {tab === 'seo' && <SeoTab seo={p.seo || {}} title={p.title} slug={p.slug} site={site} onChange={(seo) => change({ seo })} />}
          </div>
        </div>

        {/* preview: the real website, full width, scaled to fit (like the Dealership Portal editors) */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 bg-slate-100 p-4">
          {!p.tenantId && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <span className="font-semibold text-slate-600">Shared page — preview on</span>
              <Select value={previewTenant} onChange={(e) => setPreviewTenant(e.target.value)} className="w-auto py-1 text-sm">
                {(tenants.data || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {themeName(t.themeId)}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-slate-500">Every website shows it in its own theme.</span>
            </div>
          )}
          <PagePreview
            className="min-h-0 flex-1"
            src={previewSrc}
            openUrl={previewSrc.split('#')[0]}
            title={
              <span className="inline-flex items-center gap-2">
                {tenant?.name || 'Website'}
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  <Palette className="h-3 w-3" /> {tenantThemeName}
                </span>
              </span>
            }
            banner={
              <div className="border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-900">
                This page uses <b>{tenantThemeName}</b>, the theme {tenant?.name || 'the dealership'} has now. When the dealer switches theme or changes colours, the page — published or not — follows automatically.
              </div>
            }
          />
        </div>
      </div>

      <AddSection
        open={addAt !== null}
        onClose={() => setAddAt(null)}
        onPick={(type) => {
          const s = make(type);
          const list = [...sections];
          const at = addAt ?? list.length;
          list.splice(at, 0, s);
          setAddAt(null);
          setOpenId(s.id);
          setTab('sections');
          setSections(list, at);
        }}
      />

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this page?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'delete'}
              onClick={async () => {
                setBusy('delete');
                try {
                  await api(`/platform/pages/${id}`, { method: 'DELETE' });
                  router.push('/platform/pages');
                } catch (e) {
                  toast.error((e as Error).message);
                  setBusy('');
                }
              }}
            >
              Delete page
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          /{p.slug} is removed from {p.tenantId ? `${p.tenantName}'s website` : 'every dealership website'}, including its menu link. This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}

function MenuBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-slate-50', danger ? 'text-red-600' : 'text-slate-700')}>
      {children}
    </button>
  );
}

function AddSection({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (type: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a section">
      <div className="grid max-h-[60vh] gap-2 overflow-y-auto sm:grid-cols-2">
        {SECTION_DEFS.map((d) => (
          <button key={d.type} type="button" onClick={() => onPick(d.type)} className="flex gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-blue-500 hover:bg-blue-50/50">
            <span className="text-2xl">{d.icon}</span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">{d.label}</span>
              <span className="block text-xs text-slate-500">{d.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** title / description / share picture / hide from Google, with a Google result preview */
function SeoTab({ seo, title, slug, site, onChange }: { seo: Seo; title: string; slug: string; site: string; onChange: (s: Seo) => void }) {
  const set = (p: Partial<Seo>) => onChange({ ...seo, ...p });
  const shownTitle = (seo.title || `${title} | {name}`).replace('{name}', 'Dealership name');
  const tLen = (seo.title || '').length;
  const dLen = (seo.description || '').length;
  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="rounded-lg border border-slate-200 p-3">
        <div className="text-[11px] text-slate-500">{(site || 'https://dealership.com').replace(/^https?:\/\//, '')} › {slug}</div>
        <div className="truncate text-[17px] leading-snug text-[#1a0dab]">{shownTitle}</div>
        <div className="line-clamp-2 text-[13px] text-slate-600">{seo.description || 'Google shows a description here. Without one, the first text of the page is used.'}</div>
      </div>
      <Field label={`Google title (${tLen}/60)`} hint="Empty = page title + dealership name. {name}, {city_state} … work here.">
        <Input value={seo.title || ''} onChange={(e) => set({ title: e.target.value })} placeholder={`${title} | {name}`} />
      </Field>
      <Field label={`Google description (${dLen}/160)`}>
        <Textarea value={seo.description || ''} onChange={(e) => set({ description: e.target.value })} rows={3} />
      </Field>
      <ImageField label="Share picture (Facebook, WhatsApp…)" value={seo.image || ''} onChange={(v) => set({ image: v })} />
      <Toggle checked={!!seo.noindex} onChange={(v) => set({ noindex: v })} label="Hide from Google" desc="The page works, but search engines are asked not to list it and it is left out of sitemap.xml." />
      <p className="text-xs text-slate-500">SEO changes go live with “Publish changes”. Published pages are added to each website&apos;s sitemap.xml automatically.</p>
    </div>
  );
}
