'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, CornerDownRight, CornerUpLeft, Eye, EyeOff, FolderPlus, Link2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { MENU_LINKS, newId, type MenuItem } from '@/lib/page-sections';
import { useToast } from './toast';
import { Badge, Button, Card, Field, Input, Loading, Modal, Select, ErrorBox, cx } from './ui';

type MenuPage = { id: string; slug: string; title: string; navLabel: string; showInNav: boolean; status: 'DRAFT' | 'PUBLISHED'; shared: boolean };
type MenuData = {
  scope: string;
  source: 'own' | 'shared' | 'automatic';
  updatedAt: string | null;
  updatedBy: string;
  items: MenuItem[];
  pages: MenuPage[];
};

const MAX_CHILDREN = 15;

/** every page address the menu mentions (top level + dropdowns) */
function mentioned(items: MenuItem[]): Set<string> {
  const out = new Set<string>();
  for (const it of items) {
    if (it.slug) out.add(it.slug);
    for (const c of it.children || []) if (c.slug) out.add(c.slug);
  }
  return out;
}

/** what the website will show: visible entries, published pages only, then published "Show in menu" pages not placed yet */
function preview(items: MenuItem[], pages: MenuPage[]) {
  const live = new Map(pages.filter((p) => p.status === 'PUBLISHED').map((p) => [p.slug, p]));
  const label = (it: MenuItem) => it.label || (it.slug ? live.get(it.slug)?.navLabel : '') || it.slug || '';
  const show = (it: MenuItem) => !it.hidden && (it.type !== 'page' || live.has(it.slug || ''));
  const out: { label: string; children: string[] }[] = [];
  for (const it of items) {
    if (it.hidden) continue;
    const kids = (it.children || []).filter(show).map(label);
    if (it.type === 'group' && !kids.length) continue;
    if (!show(it) && !kids.length) continue;
    out.push({ label: label(it), children: kids });
  }
  const m = mentioned(items);
  for (const p of pages) if (p.status === 'PUBLISHED' && p.showInNav && !m.has(p.slug)) out.push({ label: p.navLabel, children: [] });
  return out;
}

/**
 * Pages & SEO › Header menu: arrange the custom pages in the website header — top-level links and dropdowns
 * (e.g. "Financing" with 3–4 pages under it), in any order, with their own menu text, shown or hidden.
 */
export function MenuBuilder({ scope, scopeName }: { scope: string; scopeName: string }) {
  const toast = useToast();
  const [data, setData] = useState<MenuData | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState<null | { kind: 'group' | 'link'; parent?: string }>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = async () => {
    setError('');
    try {
      const d = await api<MenuData>(`/platform/pages/menu?scope=${encodeURIComponent(scope)}`);
      setData(d);
      setItems(d.items);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const pages = data?.pages || [];
  const bySlug = useMemo(() => new Map(pages.map((p) => [p.slug, p])), [pages]);
  const used = useMemo(() => mentioned(items), [items]);
  const notPlaced = pages.filter((p) => !used.has(p.slug));
  const live = useMemo(() => preview(items, pages), [items, pages]);

  const update = (list: MenuItem[]) => {
    setItems(list);
    setDirty(true);
  };
  const patchTop = (i: number, p: Partial<MenuItem>) => update(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchChild = (i: number, c: number, p: Partial<MenuItem>) =>
    update(items.map((x, j) => (j === i ? { ...x, children: (x.children || []).map((y, k) => (k === c ? { ...y, ...p } : y)) } : x)));
  const swap = <T,>(list: T[], a: number, b: number) => {
    const n = [...list];
    [n[a], n[b]] = [n[b], n[a]];
    return n;
  };

  /** a top-level entry goes into the dropdown of the entry above it */
  const indent = (i: number) => {
    const it = items[i];
    const above = items[i - 1];
    if (!above || it.type === 'group' || (it.children || []).length) return;
    if ((above.children || []).length >= MAX_CHILDREN) return toast.error(`A dropdown can hold at most ${MAX_CHILDREN} entries.`);
    const list = items.filter((_, j) => j !== i).map((x, j) => (j === i - 1 ? { ...x, children: [...(x.children || []), { ...it, children: undefined }] } : x));
    update(list);
  };
  /** a dropdown entry becomes a top-level entry right after its dropdown */
  const outdent = (i: number, c: number) => {
    const kid = items[i].children![c];
    const list = items.map((x, j) => (j === i ? { ...x, children: x.children!.filter((_, k) => k !== c) } : x));
    list.splice(i + 1, 0, { ...kid });
    update(list);
  };

  const addPage = (slug: string, parent?: string) => {
    const it: MenuItem = { id: newId(), type: 'page', slug, label: '', hidden: false };
    if (!parent) return update([...items, it]);
    update(items.map((x) => (x.id === parent ? { ...x, children: [...(x.children || []), it] } : x)));
  };

  const save = async () => {
    setBusy('save');
    try {
      const d = await api<MenuData>('/platform/pages/menu', { method: 'PUT', body: { scope, items } });
      setData(d);
      setItems(d.items);
      setDirty(false);
      toast.ok(`Header menu saved — ${scope === 'all' ? 'every dealership without its own menu' : scopeName} shows it now.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const reset = async () => {
    setBusy('reset');
    setConfirmReset(false);
    try {
      const d = await api<MenuData>(`/platform/pages/menu?scope=${encodeURIComponent(scope)}`, { method: 'DELETE' });
      setData(d);
      setItems(d.items);
      setDirty(false);
      toast.ok(scope === 'all' ? 'Back to the automatic menu.' : 'This dealership uses the menu for every dealership again.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (error) return <ErrorBox error={error} retry={load} />;
  if (!data) return <Loading />;

  const source =
    data.source === 'own' ? (
      <Badge color="green">{scope === 'all' ? 'Menu for every dealership' : 'Own menu'}</Badge>
    ) : data.source === 'shared' ? (
      <Badge color="violet">Using the menu for every dealership</Badge>
    ) : (
      <Badge color="slate">Automatic</Badge>
    );

  const pageLine = (it: MenuItem) => {
    if (it.type === 'group') return <span className="text-slate-500">Dropdown title — no page of its own</span>;
    if (it.type === 'link') return <span className="font-mono text-slate-500">{it.url}</span>;
    const p = bySlug.get(it.slug || '');
    if (!p) return <span className="text-red-600">/{it.slug} — page not found (skipped on the website)</span>;
    return (
      <span className="text-slate-500">
        /{p.slug} · {p.title}
        {p.status !== 'PUBLISHED' && <span className="ml-1 text-amber-600">· draft, shown once published</span>}
        {p.shared && scope !== 'all' && <span className="ml-1 text-violet-600">· shared page</span>}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-slate-900">Header menu</h3>
              {source}
              {dirty && <Badge color="amber">Not saved</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {data.source === 'automatic'
                ? 'Right now the website lists every published page with "Show in the website menu", in their order. Arrange them below and save to take control.'
                : data.source === 'shared'
                  ? `${scopeName} has no menu of its own and shows the menu for every dealership. Saving here gives it its own menu.`
                  : `Appears after the theme's own links (Home, Inventory …) on desktop and mobile, styled like the theme.${data.updatedBy ? ` Last saved by ${data.updatedBy}.` : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.source === 'own' && (
              <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)} loading={busy === 'reset'}>
                <RotateCcw className="h-3.5 w-3.5" /> {scope === 'all' ? 'Back to automatic' : 'Use shared menu'}
              </Button>
            )}
            {dirty && (
              <Button variant="secondary" size="sm" onClick={() => (setItems(data.items), setDirty(false))}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={save} loading={busy === 'save'} disabled={!dirty && data.source === 'own'}>
              Save menu
            </Button>
          </div>
        </div>

        {/* live preview of the header */}
        <div className="border-b border-slate-100 bg-slate-900 px-4 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Website header preview (after the theme&apos;s own links)</div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/90">
            <span className="text-white/40">Home · Inventory · …</span>
            {live.length ? (
              live.map((e, i) => (
                <span key={i} className="group relative inline-flex items-center gap-1">
                  {e.label}
                  {!!e.children.length && (
                    <>
                      <ChevronDown className="h-3.5 w-3.5 text-white/60" />
                      <span className="absolute left-0 top-full z-20 hidden min-w-[180px] rounded-lg bg-white p-1.5 text-slate-800 shadow-xl group-hover:block">
                        {e.children.map((c, k) => (
                          <span key={k} className="block rounded px-2.5 py-1.5 text-xs hover:bg-slate-100">
                            {c}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                </span>
              ))
            ) : (
              <span className="text-white/50">No custom links yet</span>
            )}
          </div>
        </div>

        {/* the tree */}
        <div className="space-y-2 p-4">
          {!items.length && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">The menu is empty. Add pages, a dropdown or a link below.</p>}
          {items.map((it, i) => (
            <div key={it.id} className={cx('rounded-xl border bg-white', it.hidden ? 'border-dashed border-slate-300 opacity-60' : 'border-slate-200')}>
              <Row
                item={it}
                placeholder={it.type === 'page' ? bySlug.get(it.slug || '')?.navLabel || it.slug || '' : it.type === 'group' ? 'Dropdown title' : 'Menu text'}
                line={pageLine(it)}
                onLabel={(v) => patchTop(i, { label: v })}
                onHide={() => patchTop(i, { hidden: !it.hidden })}
                onUp={i > 0 ? () => update(swap(items, i, i - 1)) : undefined}
                onDown={i < items.length - 1 ? () => update(swap(items, i, i + 1)) : undefined}
                onIndent={i > 0 && it.type !== 'group' && !(it.children || []).length ? () => indent(i) : undefined}
                onRemove={() => update(items.filter((_, j) => j !== i))}
                removeTitle={(it.children || []).length ? 'Remove (its dropdown entries move to the top level)' : 'Remove from the menu'}
                onRemoveKeepKids={(it.children || []).length ? () => update([...items.slice(0, i), ...(it.children || []), ...items.slice(i + 1)]) : undefined}
              />
              {(it.type === 'group' || !!(it.children || []).length) && (
                <div className="space-y-1.5 border-t border-slate-100 bg-slate-50/70 px-3 py-2.5 pl-8">
                  {(it.children || []).map((c, k) => (
                    <div key={c.id} className={cx('rounded-lg border bg-white', c.hidden ? 'border-dashed border-slate-300 opacity-60' : 'border-slate-200')}>
                      <Row
                        small
                        item={c}
                        placeholder={c.type === 'page' ? bySlug.get(c.slug || '')?.navLabel || c.slug || '' : 'Menu text'}
                        line={pageLine(c)}
                        onLabel={(v) => patchChild(i, k, { label: v })}
                        onHide={() => patchChild(i, k, { hidden: !c.hidden })}
                        onUp={k > 0 ? () => patchTop(i, { children: swap(it.children!, k, k - 1) }) : undefined}
                        onDown={k < it.children!.length - 1 ? () => patchTop(i, { children: swap(it.children!, k, k + 1) }) : undefined}
                        onOutdent={() => outdent(i, k)}
                        onRemove={() => patchTop(i, { children: it.children!.filter((_, x) => x !== k) })}
                        removeTitle="Remove from the menu"
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Select
                      value=""
                      onChange={(e) => e.target.value && addPage(e.target.value, it.id)}
                      className="w-auto py-1 text-xs"
                      disabled={(it.children || []).length >= MAX_CHILDREN}
                    >
                      <option value="">+ Add a page to this dropdown…</option>
                      {pages
                        .filter((p) => !used.has(p.slug))
                        .map((p) => (
                          <option key={p.slug} value={p.slug}>
                            {p.title} (/{p.slug}){p.status !== 'PUBLISHED' ? ' — draft' : ''}
                          </option>
                        ))}
                    </Select>
                    <button type="button" onClick={() => setAdding({ kind: 'link', parent: it.id })} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-blue-700">
                      <Link2 className="h-3.5 w-3.5" /> Add a link
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* add */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <Button variant="secondary" size="sm" onClick={() => setAdding({ kind: 'group' })}>
            <FolderPlus className="h-3.5 w-3.5" /> Add dropdown
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAdding({ kind: 'link' })}>
            <Link2 className="h-3.5 w-3.5" /> Add link
          </Button>
          <span className="ml-auto text-xs text-slate-500">Tip: ↳ puts an entry into the dropdown of the entry above it — any page can hold a dropdown.</span>
        </div>
      </Card>

      <Card title="Pages not in the menu" className="self-start">
        {!notPlaced.length ? (
          <p className="text-sm text-slate-500">Every page is placed in the menu (hidden entries count as placed).</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {notPlaced.map((p) => (
              <div key={p.slug} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900">{p.title}</div>
                  <div className="text-xs text-slate-500">
                    /{p.slug}
                    {p.status !== 'PUBLISHED' ? ' · draft' : p.showInNav ? ' · added at the end of the menu automatically until you place it' : ' · "Show in the website menu" is off'}
                    {p.shared && scope !== 'all' ? ' · shared page' : ''}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => addPage(p.slug)}>
                  <Plus className="h-3.5 w-3.5" /> Add to menu
                </Button>
                {p.status === 'PUBLISHED' && p.showInNav && (
                  <button type="button" title="Keep it out of the menu" onClick={() => update([...items, { id: newId(), type: 'page', slug: p.slug, label: '', hidden: true }])} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
                    Keep out
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <AddEntry
        state={adding}
        onClose={() => setAdding(null)}
        onAdd={(it) => {
          const parent = adding?.parent;
          setAdding(null);
          if (!parent) return update([...items, it]);
          update(items.map((x) => (x.id === parent ? { ...x, children: [...(x.children || []), it] } : x)));
        }}
      />

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={scope === 'all' ? 'Back to the automatic menu?' : 'Use the menu for every dealership?'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reset}>
              {scope === 'all' ? 'Use automatic menu' : 'Use shared menu'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {scope === 'all'
            ? 'The saved menu for every dealership is removed. Websites without a menu of their own list every published page with "Show in the website menu" again, without dropdowns.'
            : `${scopeName}'s own menu is removed and its website shows the menu for every dealership (or the automatic menu).`}
        </p>
      </Modal>
    </div>
  );
}

function IconBtn({ title, onClick, children, danger }: { title: string; onClick?: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!onClick}
      onClick={onClick}
      className={cx('rounded p-1 text-slate-400 disabled:opacity-25', danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-800')}
    >
      {children}
    </button>
  );
}

function Row({
  item, placeholder, line, small, onLabel, onHide, onUp, onDown, onIndent, onOutdent, onRemove, removeTitle, onRemoveKeepKids,
}: {
  item: MenuItem; placeholder: string; line: React.ReactNode; small?: boolean;
  onLabel: (v: string) => void; onHide: () => void; onUp?: () => void; onDown?: () => void; onIndent?: () => void; onOutdent?: () => void;
  onRemove: () => void; removeTitle: string; onRemoveKeepKids?: () => void;
}) {
  const kind = item.type === 'group' ? 'Dropdown' : item.type === 'link' ? 'Link' : 'Page';
  return (
    <div className={cx('flex items-center gap-2', small ? 'px-2.5 py-1.5' : 'px-3 py-2.5')}>
      <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', item.type === 'group' ? 'bg-violet-100 text-violet-700' : item.type === 'link' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600')}>
        {kind}
      </span>
      <div className="min-w-0 flex-1">
        <input
          value={item.label}
          onChange={(e) => onLabel(e.target.value.slice(0, 40))}
          placeholder={placeholder}
          className={cx('w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-blue-400 focus:bg-white', small ? 'text-sm' : 'text-[15px]')}
          aria-label="Menu text"
        />
        <div className="truncate px-1.5 text-xs">{line}</div>
      </div>
      <div className="flex shrink-0 items-center">
        <IconBtn title="Move up" onClick={onUp}>
          <ArrowUp className="h-4 w-4" />
        </IconBtn>
        <IconBtn title="Move down" onClick={onDown}>
          <ArrowDown className="h-4 w-4" />
        </IconBtn>
        {onIndent && (
          <IconBtn title="Put into the dropdown above" onClick={onIndent}>
            <CornerDownRight className="h-4 w-4" />
          </IconBtn>
        )}
        {onOutdent && (
          <IconBtn title="Move out of the dropdown" onClick={onOutdent}>
            <CornerUpLeft className="h-4 w-4" />
          </IconBtn>
        )}
        <IconBtn title={item.hidden ? 'Show in the header' : 'Hide from the header'} onClick={onHide}>
          {item.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </IconBtn>
        <IconBtn title={removeTitle} onClick={onRemoveKeepKids || onRemove} danger>
          <Trash2 className="h-4 w-4" />
        </IconBtn>
      </div>
    </div>
  );
}

/** a new dropdown title or link */
function AddEntry({ state, onClose, onAdd }: { state: null | { kind: 'group' | 'link'; parent?: string }; onClose: () => void; onAdd: (it: MenuItem) => void }) {
  const [label, setLabel] = useState('');
  const [quick, setQuick] = useState('inventory');
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (state) {
      setLabel('');
      setQuick('inventory');
      setUrl('');
    }
  }, [state]);
  const group = state?.kind === 'group';
  const target = quick === '__custom' ? url.trim() : quick;
  const ok = !!label.trim() && (group || !!target);
  return (
    <Modal
      open={!!state}
      onClose={onClose}
      title={group ? 'Add a dropdown' : state?.parent ? 'Add a link to the dropdown' : 'Add a link'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ok}
            onClick={() =>
              onAdd(group ? { id: newId(), type: 'group', label: label.trim(), hidden: false, children: [] } : { id: newId(), type: 'link', url: target, label: label.trim(), hidden: false })
            }
          >
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Menu text" hint={group ? 'e.g. "Financing" — then add pages to it. To make a page itself open a dropdown, use ↳ on the entries below it instead.' : undefined}>
          <Input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 40))} placeholder={group ? 'Financing' : 'SUVs'} autoFocus />
        </Field>
        {!group && (
          <Field label="Goes to" hint="Quick links follow the dealership's theme. Other: /a-page, https://…, tel:… or mailto:…">
            <div className="flex gap-2">
              <Select value={quick} onChange={(e) => setQuick(e.target.value)} className="w-44 shrink-0">
                {MENU_LINKS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
                <option value="__custom">Other address…</option>
              </Select>
              {quick === '__custom' && <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/trade-in or https://…" />}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
