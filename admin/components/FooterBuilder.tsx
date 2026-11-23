'use client';

/**
 * Pages & SEO › Footer: the link columns of the website footer (Quick Links, Company, Legal …). Columns can be added,
 * renamed, moved, hidden and deleted; each link goes to a standard page of the design (Inventory, Used SUVs …), a
 * Pages & SEO page or any address, in the same or a new window. The website draws them in the theme's own footer
 * style, in place of the design's built-in link columns (address, hours, social icons … stay).
 *
 * Saved for one dealership or for every dealership (a dealership without its own footer uses that one). Nothing
 * saved = the starter columns shown here; the website keeps the design's own footer links until the first save.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ExternalLink, Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { newId, type DefaultPage, type FooterColumn, type FooterLink } from '@/lib/page-sections';
import { useToast } from './toast';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Select, cx } from './ui';

type FooterPage = { id: string; slug: string; title: string; status: 'DRAFT' | 'PUBLISHED'; shared: boolean };
type FooterData = {
  scope: string;
  source: 'own' | 'shared' | 'design';
  updatedAt: string | null;
  updatedBy: string;
  columns: FooterColumn[];
  defaults: DefaultPage[];
  pages: FooterPage[];
};

const MAX_COLUMNS = 8;
const MAX_LINKS = 25;
/** what a custom link may point to (same rule as the backend) */
const CUSTOM_URL = /^(\/[^\s"'<>]{0,300}|#[A-Za-z0-9_-]{1,60}|https?:\/\/[^\s"'<>]+|tel:[+0-9 ()-]+|mailto:[^\s"'<>]+)$/i;

type Draft = { col: number; index: number | null; target: string; url: string; label: string; newTab: boolean };

export function FooterBuilder({ scope, scopeName }: { scope: string; scopeName: string }) {
  const toast = useToast();
  const [data, setData] = useState<FooterData | null>(null);
  const [cols, setCols] = useState<FooterColumn[]>([]);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const load = async () => {
    setError('');
    try {
      const d = await api<FooterData>(`/platform/pages/footer?scope=${encodeURIComponent(scope)}`);
      setData(d);
      setCols(d.columns);
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
  const defaults = useMemo(() => new Map((data?.defaults || []).map((d) => [d.key, d])), [data]);

  const update = (list: FooterColumn[]) => {
    setCols(list);
    setDirty(true);
  };
  const patchCol = (i: number, p: Partial<FooterColumn>) => update(cols.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const swap = <T,>(list: T[], a: number, b: number) => {
    const n = [...list];
    [n[a], n[b]] = [n[b], n[a]];
    return n;
  };
  const moveLink = (i: number, k: number, d: number) => {
    const links = cols[i].links;
    if (k + d < 0 || k + d >= links.length) return;
    patchCol(i, { links: swap(links, k, k + d) });
  };

  const labelOf = (l: FooterLink) =>
    l.label || (l.type === 'page' ? bySlug.get(l.slug || '')?.title || l.slug : l.type === 'default' ? defaults.get(l.key || '')?.label || l.key : l.url) || '';
  const whereOf = (l: FooterLink) => {
    if (l.type === 'default') return `Standard page · ${defaults.get(l.key || '')?.label || l.key}`;
    if (l.type === 'page') {
      const p = bySlug.get(l.slug || '');
      if (!p) return `/${l.slug} — page deleted (not shown on the website)`;
      return `/${p.slug}${p.status === 'DRAFT' ? ' — draft (shown once published)' : ''}`;
    }
    return l.url || '';
  };

  const openDraft = (col: number, index: number | null) => {
    const l = index === null ? null : cols[col].links[index];
    setDraft({
      col,
      index,
      target: !l ? 'default:inventory' : l.type === 'default' ? `default:${l.key}` : l.type === 'page' ? `page:${l.slug}` : '__custom',
      url: l?.type === 'link' ? l.url || '' : '',
      label: l?.label || '',
      newTab: !!l?.newTab,
    });
  };
  const draftError = (d: Draft) => {
    if (d.target !== '__custom') return '';
    if (!d.url.trim()) return 'Enter the address the link goes to.';
    if (!CUSTOM_URL.test(d.url.trim())) return 'Use a page address (/trade-in), https://…, tel:… or mailto:…';
    if (!d.label.trim()) return 'A link to another address needs a link text.';
    return '';
  };
  const saveDraft = () => {
    if (!draft || draftError(draft)) return;
    const base = { id: draft.index === null ? newId() : cols[draft.col].links[draft.index].id, label: draft.label.trim().slice(0, 60), newTab: draft.newTab };
    const link: FooterLink = draft.target.startsWith('default:')
      ? { ...base, type: 'default', key: draft.target.slice(8) }
      : draft.target.startsWith('page:')
        ? { ...base, type: 'page', slug: draft.target.slice(5) }
        : { ...base, type: 'link', url: draft.url.trim() };
    const links = [...cols[draft.col].links];
    if (draft.index === null) links.push(link);
    else links[draft.index] = link;
    patchCol(draft.col, { links });
    setDraft(null);
  };

  const save = async () => {
    if (cols.some((c) => !c.heading.trim() && c.links.length && !c.hidden)) return toast.error('Every column needs a heading (or hide it).');
    setBusy('save');
    try {
      const d = await api<FooterData>('/platform/pages/footer', { method: 'PUT', body: { scope, columns: cols } });
      setData(d);
      setCols(d.columns);
      setDirty(false);
      toast.ok(`Footer saved — ${scope === 'all' ? 'every dealership without its own footer' : scopeName} shows it now.`);
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
      const d = await api<FooterData>(`/platform/pages/footer?scope=${encodeURIComponent(scope)}`, { method: 'DELETE' });
      setData(d);
      setCols(d.columns);
      setDirty(false);
      toast.ok(scope === 'all' ? "Back to the designs' own footer links." : 'This dealership uses the footer for every dealership again.');
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
      <Badge color="green">{scope === 'all' ? 'Footer for every dealership' : 'Own footer'}</Badge>
    ) : data.source === 'shared' ? (
      <Badge color="violet">Using the footer for every dealership</Badge>
    ) : (
      <Badge color="slate">Design&apos;s own footer links</Badge>
    );
  const visible = cols.filter((c) => !c.hidden);

  return (
    <div className="space-y-4">
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">Footer links — {scopeName}</h3>
              {source}
              {dirty && <Badge color="amber">Not saved</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {data.source === 'design' && !dirty
                ? "Nothing saved yet: the website shows the design's own footer links. Below is a starting point — change it and save to use it."
                : `Replaces the design's footer link columns (address, hours and social icons stay), styled like the theme.${data.updatedBy && data.source === 'own' ? ` Last saved by ${data.updatedBy}.` : ''}`}
            </p>
          </div>
          {(data.source === 'own' || (scope === 'all' && data.source !== 'design')) && (
            <Button variant="secondary" size="sm" onClick={() => setConfirmReset(true)} disabled={!!busy}>
              <RotateCcw className="h-3.5 w-3.5" /> {scope === 'all' ? 'Use the designs’ links' : 'Use the shared footer'}
            </Button>
          )}
          {dirty && (
            <Button variant="secondary" size="sm" onClick={() => (setCols(data.columns), setDirty(false))} disabled={!!busy}>
              Undo changes
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!!busy || (!dirty && data.source !== 'design')}>
            {busy === 'save' ? 'Saving…' : 'Save footer'}
          </Button>
        </div>

        {/* preview */}
        <div className="bg-slate-900 px-5 py-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Website footer preview</div>
          {visible.length ? (
            <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${Math.min(visible.length, 4)}, minmax(0, 1fr))` }}>
              {visible.map((c) => (
                <div key={c.id} className="min-w-0">
                  <div className="mb-2 truncate text-sm font-semibold text-white">{c.heading || 'Untitled'}</div>
                  <ul className="space-y-1">
                    {c.links.map((l) => (
                      <li key={l.id} className="flex items-center gap-1 truncate text-xs text-white/70">
                        {labelOf(l)}
                        {l.newTab && <ExternalLink className="h-3 w-3 shrink-0 text-white/40" />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/50">No visible columns — the footer will show no link columns.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cols.map((c, i) => (
          <Card key={c.id} pad={false} className={cx(c.hidden && 'opacity-60')}>
            <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">
              <Input
                value={c.heading}
                onChange={(e) => patchCol(i, { heading: e.target.value.slice(0, 60) })}
                placeholder="Column heading"
                aria-label="Column heading"
                className="min-w-0 flex-1 py-1.5 font-semibold"
              />
              <Icon title="Move left" onClick={i > 0 ? () => update(swap(cols, i, i - 1)) : undefined}>
                <ArrowLeft className="h-4 w-4" />
              </Icon>
              <Icon title="Move right" onClick={i < cols.length - 1 ? () => update(swap(cols, i, i + 1)) : undefined}>
                <ArrowRight className="h-4 w-4" />
              </Icon>
              <Icon title={c.hidden ? 'Show on the website' : 'Hide from the website'} onClick={() => patchCol(i, { hidden: !c.hidden })}>
                {c.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Icon>
              <Icon title="Delete column" danger onClick={() => (c.links.length ? setConfirmDelete(i) : update(cols.filter((_, j) => j !== i)))}>
                <Trash2 className="h-4 w-4" />
              </Icon>
            </div>
            <ul className="divide-y divide-slate-100">
              {c.links.map((l, k) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
                      {labelOf(l)}
                      {l.type === 'default' && <span className="rounded bg-emerald-100 px-1 text-[9px] font-bold uppercase text-emerald-700">Default</span>}
                      {l.newTab && <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" aria-label="Opens in a new window" />}
                    </div>
                    <div className={cx('truncate text-xs', l.type === 'page' && !bySlug.get(l.slug || '') ? 'text-red-600' : 'text-slate-500')}>{whereOf(l)}</div>
                  </div>
                  <Icon title="Move up" onClick={k > 0 ? () => moveLink(i, k, -1) : undefined}>
                    <ArrowUp className="h-4 w-4" />
                  </Icon>
                  <Icon title="Move down" onClick={k < c.links.length - 1 ? () => moveLink(i, k, 1) : undefined}>
                    <ArrowDown className="h-4 w-4" />
                  </Icon>
                  <Icon title="Edit link" onClick={() => openDraft(i, k)}>
                    <Pencil className="h-4 w-4" />
                  </Icon>
                  <Icon title="Delete link" danger onClick={() => patchCol(i, { links: c.links.filter((_, x) => x !== k) })}>
                    <Trash2 className="h-4 w-4" />
                  </Icon>
                </li>
              ))}
              {!c.links.length && <li className="px-3 py-3 text-xs text-slate-500">No links yet.</li>}
            </ul>
            <div className="border-t border-slate-100 px-3 py-2">
              <Button variant="secondary" size="sm" onClick={() => openDraft(i, null)} disabled={c.links.length >= MAX_LINKS}>
                <Plus className="h-3.5 w-3.5" /> Add link
              </Button>
            </div>
          </Card>
        ))}
        {cols.length < MAX_COLUMNS && (
          <button
            type="button"
            onClick={() => update([...cols, { id: newId(), heading: 'New column', hidden: false, links: [] }])}
            className="flex min-h-[140px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-600 hover:border-blue-500 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" /> Add column
          </button>
        )}
      </div>

      {/* add / edit link */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.index === null ? 'Add a footer link' : 'Edit footer link'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={saveDraft} disabled={!draft || !!draftError(draft)}>
              {draft?.index === null ? 'Add link' : 'Save link'}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Goes to">
              <Select value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })}>
                <optgroup label="Standard pages (follow each design)">
                  {(data.defaults || []).map((d) => (
                    <option key={d.key} value={`default:${d.key}`}>
                      {d.label}
                    </option>
                  ))}
                </optgroup>
                {!!pages.length && (
                  <optgroup label="Pages & SEO pages">
                    {pages.map((p) => (
                      <option key={p.id} value={`page:${p.slug}`}>
                        {p.title} (/{p.slug}){p.status === 'DRAFT' ? ' — draft' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="__custom">Other address (custom URL)…</option>
              </Select>
            </Field>
            {draft.target === '__custom' && (
              <Field label="Address" hint="/a-page, https://…, tel:… or mailto:…">
                <Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://…" />
              </Field>
            )}
            <Field label="Link text" hint={draft.target === '__custom' ? undefined : 'Leave empty to use the page name.'}>
              <Input
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value.slice(0, 60) })}
                placeholder={
                  draft.target.startsWith('default:')
                    ? defaults.get(draft.target.slice(8))?.label
                    : draft.target.startsWith('page:')
                      ? bySlug.get(draft.target.slice(5))?.title
                      : 'e.g. Careers'
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={draft.newTab} onChange={(e) => setDraft({ ...draft, newTab: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Open in a new window
              <span className="text-xs text-slate-400">(otherwise the same window)</span>
            </label>
            {draftError(draft) && draft.target === '__custom' && (draft.url || draft.label) && <p className="text-xs text-red-600">{draftError(draft)}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete this column?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => (confirmDelete !== null && update(cols.filter((_, j) => j !== confirmDelete)), setConfirmDelete(null))}>
              Delete column
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          “{confirmDelete !== null ? cols[confirmDelete]?.heading || 'Untitled' : ''}” and its {confirmDelete !== null ? cols[confirmDelete]?.links.length : 0} link(s) leave the footer when you save. To keep them for later, hide the column instead.
        </p>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={scope === 'all' ? "Go back to the designs' footer links?" : 'Use the footer for every dealership?'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reset}>
              {busy === 'reset' ? 'Working…' : 'Yes, reset'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {scope === 'all'
            ? "The saved footer for every dealership is removed. Dealerships without their own footer show their design's built-in footer links again."
            : `${scopeName}'s own footer is removed; it shows the footer for every dealership (or the design's links if none is saved).`}
        </p>
      </Modal>
    </div>
  );
}

function Icon({ title, onClick, children, danger }: { title: string; onClick?: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!onClick}
      onClick={onClick}
      className={cx('shrink-0 rounded p-1 text-slate-400 disabled:opacity-25', danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-slate-800')}
    >
      {children}
    </button>
  );
}
