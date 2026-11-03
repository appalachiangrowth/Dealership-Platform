'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, History, ImageIcon, RotateCcw, Search } from 'lucide-react';
import { api, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useTenant } from '@/components/DealerShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Drawer, ErrorBox, Field, Input, Loading, Textarea, cx } from '@/components/ui';
import { SingleImage } from '@/components/ImageUploader';
import { LivePreview, type LivePreviewHandle } from '@/components/LivePreview';
import { dateTime } from '@/lib/format';

type FieldT = { key: string; type: 'head' | 'para' | 'text' | 'img'; label: string; default: string; hint: string; saved: boolean; value: string };
type Section = { id: string; label: string; help: string; fields: FieldT[] };
type Page = { id: string; label: string; page: string; sections: Section[] };
type KeyMap = { pages: { template: string; label: string; keys: string[] }[] };

const THEME_NAMES: Record<string, string> = { classic: 'Classic', atelier: 'Atelier', 'apex-drift': 'Apex Drift', halcyon: 'Halcyon', vroomfox: 'VroomFox' };

/** Designs that are one single page use #/routes for the other pages. */
const SPA_HASH: Record<string, string> = { about: '#/about', contact: '#/contact', inventory: '#/inventory', blog: '#/blog' };

/** Fills {name}, {city_state} … for the "how it will read" hint. */
const fill = (s: string, t: Record<string, string>) => s.replace(/\{([a-z_]+)\}/g, (m, k) => t[k] || m);

export default function ContentPage() {
  const { data, setData, loading, error, reload } = useApi('/dealer/content');
  const { tenant } = useTenant();
  const toast = useToast();
  const [pageId, setPageId] = useState('home');
  const [values, setValues] = useState<Record<string, string>>({});
  const [reset, setReset] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useApi(historyOpen ? '/dealer/content/history' : null, [historyOpen]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState('');
  const [live, setLive] = useState(true);
  const [keyMap, setKeyMap] = useState<KeyMap | null>(null);
  const [view, setView] = useState<{ template: string; hash: string }>({ template: 'index.html', hash: '' });
  const [shownKeys, setShownKeys] = useState<string[]>([]);
  const [notShown, setNotShown] = useState('');
  const preview = useRef<LivePreviewHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data) return;
    const v: Record<string, string> = {};
    for (const p of data.pages as Page[]) for (const s of p.sections) for (const f of s.fields) v[f.key] = f.value;
    setValues(v);
    setReset([]);
  }, [data]);

  const fields = useMemo(() => {
    const m: Record<string, FieldT & { pageId: string; sectionId: string }> = {};
    if (data) for (const p of data.pages as Page[]) for (const s of p.sections) for (const f of s.fields) m[f.key] = { ...f, pageId: p.id, sectionId: s.id };
    return m;
  }, [data]);

  const site = tenant ? siteUrl(tenant) : '';
  const themeId: string = data?.themeId || '';

  // which texts each page of the dealer's design shows
  useEffect(() => {
    if (!site || !themeId) return;
    let stop = false;
    fetch(`${site}/pa-keys.json?theme=${encodeURIComponent(themeId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !stop && setKeyMap(j))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [site, themeId]);

  const singlePage = !keyMap || keyMap.pages.filter((p) => p.keys.length).length <= 1;

  /** The page of the design that shows the most texts of an editor tab (or one given text). */
  const viewFor = useCallback(
    (tab: string, key?: string): { template: string; hash: string } => {
      if (singlePage || !keyMap) return { template: 'index.html', hash: SPA_HASH[tab] || '' };
      const wanted = key ? [key] : Object.values(fields).filter((f) => f.pageId === tab).map((f) => f.key);
      let best = { template: '', n: 0 };
      for (const p of keyMap.pages) {
        const n = p.keys.filter((k) => wanted.includes(k)).length;
        if (n > best.n || (n === best.n && n > 0 && p.template === 'index.html')) best = { template: p.template, n };
      }
      return { template: best.template || 'index.html', hash: '' };
    },
    [keyMap, singlePage, fields],
  );

  // switching editor tab → show that page; open its first section
  useEffect(() => {
    if (!data) return;
    const p = (data.pages as Page[]).find((x) => x.id === pageId);
    if (p?.sections[0]) setOpen((o) => ({ ...o, [p.sections[0].id]: true }));
    if (pageId !== 'footer' && pageId !== 'seo') setView(viewFor(pageId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, data, keyMap]);

  /** Text as the website shows it: empty → suggested text. */
  const effective = useCallback(
    (all: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, f] of Object.entries(fields)) {
        if (f.type === 'img') continue;
        const v = all[k] ?? '';
        out[k] = v === '' && f.type !== 'para' ? f.default : v;
      }
      return out;
    },
    [fields],
  );

  // typing → the preview changes right away (nothing is saved)
  useEffect(() => {
    if (!live || !Object.keys(fields).length) return;
    const t = setTimeout(() => preview.current?.send({ pa: 'values', values: effective(values) }), 120);
    return () => clearTimeout(t);
  }, [values, live, effective, fields]);

  const focusField = useCallback(
    (key: string) => {
      setActive(key);
      setNotShown('');
      const f = fields[key];
      if (!f) return;
      if (!shownKeys.includes(key) && keyMap && !singlePage) {
        const here = keyMap.pages.find((p) => p.template === view.template);
        if (!here?.keys.includes(key)) {
          const v = viewFor(f.pageId, key);
          if (v.template !== view.template) {
            setView(v); // the focus is sent when the new page is ready
            return;
          }
        }
      }
      preview.current?.send({ pa: 'focus', key, label: f.label });
    },
    [fields, shownKeys, keyMap, singlePage, view.template, viewFor],
  );

  /** A text was clicked in the preview → open it in the editor. */
  const pick = useCallback(
    (key: string) => {
      const f = fields[key];
      if (!f) return;
      setQuery('');
      setPageId(f.pageId);
      setOpen((o) => ({ ...o, [f.sectionId]: true }));
      setActive(key);
      setTimeout(() => {
        const el = scroller.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(key)}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el?.querySelector<HTMLElement>('textarea,input')?.focus({ preventScroll: true });
      }, 80);
    },
    [fields],
  );

  const changed = Object.keys(values).filter((k) => fields[k] && values[k] !== fields[k].value);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !tenant) return null;
  const page = (data.pages as Page[]).find((p) => p.id === pageId)!;
  const q = query.trim().toLowerCase();
  const pageFields = page.sections.flatMap((s) => s.fields);
  const allSuggested = pageFields.every((f) => !f.saved || reset.includes(f.key));

  async function save() {
    setSaving(true);
    try {
      const body = { values: Object.fromEntries(changed.filter((k) => !reset.includes(k)).map((k) => [k, values[k]])), reset };
      setData(await api('/dealer/content', { method: 'PUT', body }));
      toast.ok('Website text saved');
      preview.current?.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    const v: Record<string, string> = {};
    for (const f of Object.values(fields)) v[f.key] = f.value;
    setValues(v);
    setReset([]);
  }

  const previewSrc = `${site}/${view.template}?pa_live=1&pa_tenant=${encodeURIComponent(tenant.id)}${view.hash}`;
  const pageLabel = keyMap?.pages.find((p) => p.template === view.template)?.label || page.label;

  return (
    <div className="grid gap-6 lg:h-[calc(100vh-3rem)] lg:grid-cols-[minmax(360px,500px)_1fr]">
      {/* ---------------- editor ---------------- */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 pb-4 pt-5">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Set up your website · Step 3 of 3</div>
          <div className="mt-1 flex items-start justify-between gap-3">
            <h1 className="font-heading text-xl font-extrabold text-slate-900">Website content</h1>
            <Button variant="secondary" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="h-3.5 w-3.5" /> Earlier versions
            </Button>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Write it once — it is used by <b className="text-slate-700">every design</b>. Showing on: <b className="text-slate-700">{THEME_NAMES[themeId] || themeId}</b>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(data.pages as Page[]).map((p) => {
              const n = p.sections.flatMap((s) => s.fields).filter((f) => changed.includes(f.key)).length;
              return (
                <button
                  key={p.id}
                  onClick={() => setPageId(p.id)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition',
                    pageId === p.id ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  {p.id === 'branding' && <ImageIcon className="h-3.5 w-3.5" />}
                  {p.label}
                  {n > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] text-amber-950">{n}</span>}
                </button>
              );
            })}
            <Link
              href="/dealer/content/branding"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <ImageIcon className="h-3.5 w-3.5" /> Photo branding
            </Link>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a text on this page…" className="pl-9" />
          </div>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 px-4 py-4">
          {page.sections.map((s) => {
            const list = q ? s.fields.filter((f) => f.label.toLowerCase().includes(q) || (values[f.key] || '').toLowerCase().includes(q)) : s.fields;
            if (q && !list.length) return null;
            const isOpen = q ? true : !!open[s.id];
            const n = s.fields.filter((f) => changed.includes(f.key)).length;
            return (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white">
                <button type="button" onClick={() => setOpen({ ...open, [s.id]: !isOpen })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <span className="flex items-center gap-2 font-semibold text-slate-900">
                    {s.label}
                    {n > 0 && <Badge color="amber">{n} not saved</Badge>}
                  </span>
                  <ChevronDown className={cx('h-4 w-4 text-slate-400 transition', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
                    {s.help && <p className="text-xs text-slate-500">{s.help}</p>}
                    {list.map((f) => {
                      const v = values[f.key] ?? '';
                      const isDefault = !f.saved || reset.includes(f.key);
                      const label = (
                        <span className="flex flex-wrap items-center gap-2">
                          {f.label} {isDefault && <Badge>Suggested text</Badge>}
                          {changed.includes(f.key) && <Badge color="amber">Not saved</Badge>}
                        </span>
                      );
                      const hint =
                        notShown === f.key
                          ? 'This text is not visible on this page of your design (it may be used on another page or for Google).'
                          : /\{[a-z_]+\}/.test(v)
                            ? `Reads as: ${fill(v, data.tokens).replace(/\*/g, '')}`
                            : f.hint;
                      return (
                        <div
                          key={f.key}
                          data-field={f.key}
                          onFocusCapture={() => focusField(f.key)}
                          onMouseDown={() => active !== f.key && focusField(f.key)}
                          className={cx('relative -mx-2 rounded-lg px-2 py-1.5 transition', active === f.key && 'bg-blue-50/70 ring-1 ring-blue-200')}
                        >
                          <Field label={label} hint={hint}>
                            {f.type === 'img' ? (
                              <SingleImage value={v} onChange={(u) => setValues({ ...values, [f.key]: u })} />
                            ) : f.type === 'para' || f.type === 'head' ? (
                              <Textarea rows={f.type === 'head' ? 2 : 3} value={v} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                            ) : (
                              <Input value={v} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                            )}
                          </Field>
                          {f.saved && !reset.includes(f.key) && (
                            <button
                              type="button"
                              title="Use the suggested text again"
                              onClick={() => {
                                setReset([...reset, f.key]);
                                setValues({ ...values, [f.key]: f.default });
                              }}
                              className="absolute right-2 top-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                            >
                              <RotateCcw className="h-3 w-3" /> Suggested
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {q && !page.sections.some((s) => s.fields.some((f) => f.label.toLowerCase().includes(q) || (values[f.key] || '').toLowerCase().includes(q))) && (
            <p className="px-2 py-6 text-center text-sm text-slate-500">No text on this page matches “{query}”.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <p className="text-sm text-slate-500">
            {changed.length || reset.length
              ? `${changed.length || reset.length} change${(changed.length || reset.length) === 1 ? '' : 's'} not saved yet`
              : allSuggested
                ? 'Showing suggested text — edit it to make it yours'
                : 'All changes saved'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" onClick={discard} disabled={!changed.length && !reset.length}>
              Discard
            </Button>
            <Button onClick={save} loading={saving} disabled={!changed.length && !reset.length}>
              Save changes
            </Button>
          </div>
        </div>
      </div>

      {/* ---------------- live preview ---------------- */}
      <LivePreview
        ref={preview}
        className="hidden min-h-[600px] lg:flex"
        src={previewSrc}
        openUrl={`${site}/${view.template === 'index.html' ? '' : view.template}${view.hash}`}
        title={pageLabel}
        live={live}
        onLiveChange={(on) => {
          setLive(on);
          if (!on) preview.current?.reload(); // back to the saved texts
        }}
        onReady={(keys) => {
          setShownKeys(keys);
          const curValues = Object.keys(values).length ? values : effective({});
          if (live) preview.current?.send({ pa: 'values', values: effective(curValues) });
          if (active && fields[active]) preview.current?.send({ pa: 'focus', key: active, label: fields[active].label });
        }}
        onPick={pick}
        onFocusResult={(key, found) => setNotShown(found ? '' : key)}
      />

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Earlier versions">
        {history.loading ? (
          <Loading />
        ) : !history.data?.length ? (
          <p className="text-sm text-slate-500">No earlier versions yet. A version is kept every time you save.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.data.map((h: any) => (
              <li key={h.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{dateTime(h.createdAt)}</div>
                  <div className="text-xs text-slate-500">
                    before a save by {h.savedBy || 'unknown'} · {h.count} texts
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      setData(await api(`/dealer/content/history/${h.id}/restore`, { method: 'POST' }));
                      toast.ok('Version restored');
                      setHistoryOpen(false);
                      preview.current?.reload();
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </div>
  );
}
