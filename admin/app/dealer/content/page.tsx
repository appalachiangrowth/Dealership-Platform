'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, History, RotateCcw } from 'lucide-react';
import { api, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useTenant } from '@/components/DealerShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, Drawer, ErrorBox, Field, Input, LinkButton, Loading, PageHeader, Textarea, cx } from '@/components/ui';
import { SingleImage } from '@/components/ImageUploader';
import { dateTime } from '@/lib/format';

type FieldT = { key: string; type: 'head' | 'para' | 'text' | 'img'; label: string; default: string; hint: string; saved: boolean; value: string };
type Section = { id: string; label: string; help: string; fields: FieldT[] };
type Page = { id: string; label: string; page: string; sections: Section[] };

/** Opens the page in the dealer's design (the designs use index.html#/… or their own .html pages). */
const PAGE_PATH: Record<string, string> = { home: '/', about: '/index.html#/about', contact: '/index.html#/contact', inventory: '/index.html#/inventory', blog: '/index.html#/blog', footer: '/', seo: '/' };

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

  useEffect(() => {
    if (!data) return;
    const v: Record<string, string> = {};
    for (const p of data.pages as Page[]) for (const s of p.sections) for (const f of s.fields) v[f.key] = f.value;
    setValues(v);
    setReset([]);
  }, [data]);

  const fields = useMemo(() => {
    const m: Record<string, FieldT> = {};
    if (data) for (const p of data.pages as Page[]) for (const s of p.sections) for (const f of s.fields) m[f.key] = f;
    return m;
  }, [data]);

  const changed = Object.keys(values).filter((k) => fields[k] && values[k] !== fields[k].value);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !tenant) return null;
  const page = (data.pages as Page[]).find((p) => p.id === pageId)!;

  async function save() {
    setSaving(true);
    try {
      const body = { values: Object.fromEntries(changed.filter((k) => !reset.includes(k)).map((k) => [k, values[k]])), reset };
      setData(await api('/dealer/content', { method: 'PUT', body }));
      toast.ok('Website text saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="③ Website content"
        desc={
          <>
            The text visitors read. Put <b>*stars*</b> around words in headlines to highlight them. Use {'{name}'}, {'{phone}'}, {'{city_state}'} to insert your business details. Links: [used SUVs](/used-suvs).
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" /> Earlier versions
            </Button>
            <LinkButton variant="secondary" href={siteUrl(tenant) + (PAGE_PATH[pageId] || '/')} target="_blank">
              <ExternalLink className="h-4 w-4" /> View page
            </LinkButton>
            <Button onClick={save} loading={saving} disabled={!changed.length && !reset.length}>
              Save {changed.length ? `(${changed.length})` : ''}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {(data.pages as Page[]).map((p) => {
            const n = p.sections.flatMap((s) => s.fields).filter((f) => changed.includes(f.key)).length;
            return (
              <button
                key={p.id}
                onClick={() => setPageId(p.id)}
                className={cx('flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold', pageId === p.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-white')}
              >
                {p.label}
                {n > 0 && <span className="ml-2 rounded-full bg-amber-400 px-1.5 text-[10px] text-amber-950">{n}</span>}
              </button>
            );
          })}
        </nav>
        <div className="space-y-6">
          {page.sections.map((s) => (
            <Card key={s.id} title={s.label}>
              {s.help && <p className="-mt-1 mb-4 text-xs text-slate-500">{s.help}</p>}
              <div className="space-y-4">
                {s.fields.map((f) => {
                  const v = values[f.key] ?? '';
                  const isDefault = !f.saved || reset.includes(f.key);
                  const label = (
                    <span className="flex items-center gap-2">
                      {f.label} {isDefault && <Badge>Suggested text</Badge>}
                      {changed.includes(f.key) && <Badge color="amber">Not saved</Badge>}
                    </span>
                  );
                  const preview = /\{[a-z_]+\}/.test(v) ? `Reads as: ${fill(v, data.tokens).replace(/\*/g, '')}` : f.hint;
                  return (
                    <div key={f.key} className="relative">
                      <Field label={label} hint={preview}>
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
                          className="absolute right-0 top-0 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                        >
                          <RotateCcw className="h-3 w-3" /> Suggested
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      </div>

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
    </>
  );
}
