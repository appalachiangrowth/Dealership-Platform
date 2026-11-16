'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, FileUp, Link2, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Button, Card, Empty, Input, Loading, Modal, Pagination, Select, Spinner, Table, Td, cx } from '@/components/ui';

/* ───────────────── Platform Admin › SEO & URLs › URL Redirects (301 / 302 / 307 / 410) ───────────────── */

type Code = 301 | 302 | 307 | 410;
type Rule = { id: string; sourcePath: string; destinationUrl: string | null; statusCode: Code; isActive: boolean; hits: number; lastHitAt: string | null; createdAt: string; updatedAt: string };
type List = { items: Rule[]; total: number; page: number; pageSize: number; counts: { all: number; active: number; inactive: number } };
type ImportRow = { line: number; source_url: string; destination_url: string; type: string; status: string };
type ImportResult = { created: number; updated: number; skipped: number; errors: { line: number; source: string; error: string }[] };

const TYPES: { code: Code; label: string; short: string }[] = [
  { code: 301, label: '301 – Permanent Redirect', short: 'Permanent' },
  { code: 302, label: '302 – Temporary Redirect', short: 'Temporary' },
  { code: 307, label: '307 – Temporary Redirect (Preserve Method)', short: 'Temporary (preserve method)' },
  { code: 410, label: '410 – Gone (Permanently Removed)', short: 'Gone' },
];
const PILL: Record<Code, string> = {
  301: 'bg-violet-100 text-violet-700 ring-violet-200',
  302: 'bg-blue-100 text-blue-700 ring-blue-200',
  307: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
  410: 'bg-orange-100 text-orange-700 ring-orange-200',
};
const VIOLET = 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm';

const EMPTY_FORM = { sourceUrl: '', destinationUrl: '', statusCode: 301 as Code, isActive: true };

/* ---------------- CSV ---------------- */

/** RFC 4180-ish: quotes, "" inside quotes, CRLF / LF, BOM; "," ";" or tab picked from the first line */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] || '';
  const count = (c: string) => first.split(c).length - 1;
  const sep = count('\t') > count(',') && count('\t') >= count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADERS: Record<keyof Omit<ImportRow, 'line'>, string[]> = {
  source_url: ['source_url', 'source', 'source url', 'from', 'old_url', 'old url', 'url', 'urls', 'address', 'page', 'top pages'],
  destination_url: ['destination_url', 'destination', 'destination url', 'to', 'new_url', 'new url', 'target'],
  type: ['type', 'redirect_type', 'redirect type', 'code', 'status_code', 'status code', 'http_status'],
  status: ['status', 'active', 'state', 'enabled'],
};

/** rows of the file → import rows; a file without a header row is read as source, destination, type, status */
function csvRows(text: string): ImportRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((c) => c.trim().toLowerCase().replace(/^'/, ''));
  const col = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h));
  const hasHeader = col('source_url') >= 0;
  const idx = hasHeader
    ? { source_url: col('source_url'), destination_url: col('destination_url'), type: col('type'), status: col('status') }
    : { source_url: 0, destination_url: 1, type: 2, status: 3 };
  // "status" may be the HTTP code in some exports: a column of 3-digit numbers is the type
  const body = hasHeader ? rows.slice(1) : rows;
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : '');
  return body
    .map((r, n) => ({
      line: n + (hasHeader ? 2 : 1),
      source_url: get(r, idx.source_url),
      destination_url: get(r, idx.destination_url),
      type: get(r, idx.type) || (/^\d{3}$/.test(get(r, idx.status)) ? get(r, idx.status) : ''),
      status: /^\d{3}$/.test(get(r, idx.status)) ? '' : get(r, idx.status),
    }))
    .filter((r) => r.source_url);
}

/* ---------------- component ---------------- */

export function UrlRedirects({ dealerId, dealerName, view }: { dealerId: string; dealerName: string; view: (path: string) => string }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const sourceRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const base = `/platform/seo/${encodeURIComponent(dealerId)}/redirects`;
  const { data, loading, error, reload } = useApi<List>(`${base}?q=${encodeURIComponent(term)}&type=${type}&status=${status}&page=${page}&pageSize=50`);

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setSelected(new Set()), [term, type, status, page, dealerId]);

  const items = data?.items || [];
  const allOnPage = items.length > 0 && items.every((r) => selected.has(r.id));
  const gone = form.statusCode === 410;

  function startAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => sourceRef.current?.focus(), 250);
  }

  function startEdit(r: Rule) {
    setEditing(r);
    setForm({ sourceUrl: r.sourcePath, destinationUrl: r.destinationUrl || '', statusCode: r.statusCode, isActive: r.isActive });
    setFormError('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => sourceRef.current?.focus(), 250);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.sourceUrl.trim()) return setFormError('Enter the old URL.');
    if (!gone && !form.destinationUrl.trim()) return setFormError('Enter the new URL (or choose 410 – Gone).');
    setSaving(true);
    try {
      const body = { ...form, destinationUrl: gone ? null : form.destinationUrl };
      if (editing) {
        await api(`${base}/${editing.id}`, { method: 'PATCH', body });
        toast.ok('Redirect saved');
      } else {
        await api(base, { method: 'POST', body });
        toast.ok(`Redirect added — ${form.sourceUrl.trim()} now ${gone ? 'answers 410 Gone' : `goes to ${form.destinationUrl.trim()}`}`);
      }
      setEditing(null);
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: Rule) {
    setBusy(r.id);
    try {
      await api(`${base}/${r.id}`, { method: 'PATCH', body: { isActive: !r.isActive } });
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function bulk(action: 'activate' | 'deactivate' | 'delete', ids = [...selected]) {
    setBusy(action);
    try {
      const r = await api<{ count: number }>(`${base}/bulk`, { method: 'POST', body: { ids, action } });
      toast.ok(`${r.count} redirect${r.count === 1 ? '' : 's'} ${action === 'delete' ? 'deleted' : action === 'activate' ? 'activated' : 'deactivated'}`);
      setSelected(new Set());
      if (editing && ids.includes(editing.id) && action === 'delete') {
        setEditing(null);
        setForm(EMPTY_FORM);
      }
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
      setConfirm(null);
    }
  }

  async function exportCsv() {
    setBusy('export');
    try {
      const slug = dealerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dealership';
      await download(`${base}/export`, `redirects-${slug}.csv`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  const pick = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div className="space-y-5">
      {/* ---------------- header ---------------- */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
            <Link2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">URL Redirects</h2>
            <p className="text-sm text-slate-500">Add and manage URL redirects (301, 302, 307, and 410).</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button variant="secondary" onClick={exportCsv} loading={busy === 'export'} disabled={!data?.counts.all}>
            {busy !== 'export' && <Download className="h-4 w-4" />} Export CSV
          </Button>
          <Button className={VIOLET} onClick={startAdd}>
            <Plus className="h-4 w-4" /> Add Redirect
          </Button>
        </div>
      </div>

      {/* ---------------- add / edit ---------------- */}
      <div ref={formRef} className={cx('scroll-mt-24 rounded-2xl border p-5 shadow-sm transition', editing ? 'border-violet-300 bg-violet-50/40' : 'border-slate-200 bg-slate-50/70')}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900">{editing ? 'Edit Redirect' : 'Add Redirect'}</h3>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setForm(EMPTY_FORM);
                setFormError('');
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              <X className="h-3.5 w-3.5" /> Cancel editing
            </button>
          )}
        </div>
        <form onSubmit={submit} className="grid items-end gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.15fr)_minmax(0,0.9fr)_auto_auto]">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">
              Source URL (Old URL) <span className="text-red-600">*</span>
            </span>
            <Input ref={sourceRef} value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="e.g. /vehicle.html?id=123" maxLength={1000} className="bg-white font-mono text-[13px]" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">
              Destination URL (New URL) {!gone && <span className="text-red-600">*</span>}
            </span>
            <Input
              value={gone ? '' : form.destinationUrl}
              onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })}
              placeholder={gone ? 'Not required for 410 Gone' : 'e.g. /inventory/chevrolet-express'}
              disabled={gone}
              maxLength={1000}
              className={cx('font-mono text-[13px]', gone ? 'bg-slate-100' : 'bg-white')}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">
              Redirect Type <span className="text-red-600">*</span>
            </span>
            <Select value={form.statusCode} onChange={(e) => setForm({ ...form, statusCode: Number(e.target.value) as Code })} className="bg-white">
              {TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">Status</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.isActive}
              onClick={() => setForm({ ...form, isActive: !form.isActive })}
              className="flex h-[38px] items-center gap-2.5 pr-2 text-sm font-medium text-slate-800"
            >
              <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition', form.isActive ? 'bg-emerald-500' : 'bg-slate-300')}>
                <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', form.isActive ? 'left-[22px]' : 'left-0.5')} />
              </span>
              {form.isActive ? 'Active' : 'Inactive'}
            </button>
          </div>
          <Button type="submit" loading={saving} className={cx(VIOLET, 'h-[38px] px-5')}>
            {editing ? 'Save Changes' : 'Add Redirect'}
          </Button>
        </form>
        {formError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
        <p className="mt-3 text-xs text-slate-500">
          Paste a path or a full URL — the query (e.g. <code className="font-mono">?id=123</code>) is matched too, in any order; tracking parameters (utm_…, gclid, fbclid) are ignored. A rule without a query also catches the same path with any query.
        </p>
      </div>

      {/* ---------------- list ---------------- */}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[240px] flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-9" placeholder="Search by URL..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              Type:
              <Select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
                className="w-40"
              >
                <option value="">All Types</option>
                {TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.code}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              Status:
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                className="w-36"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </label>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-y border-violet-100 bg-violet-50 px-4 py-2.5 text-sm">
            <span className="font-semibold text-violet-800">{selected.size} selected</span>
            <span className="mx-1 h-4 w-px bg-violet-200" />
            <Button size="sm" variant="secondary" onClick={() => bulk('activate')} loading={busy === 'activate'}>
              Activate
            </Button>
            <Button size="sm" variant="secondary" onClick={() => bulk('deactivate')} loading={busy === 'deactivate'}>
              Deactivate
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm({ ids: [...selected], label: `${selected.size} selected redirect${selected.size === 1 ? '' : 's'}` })}>
              <Trash2 className="h-3.5 w-3.5" /> Delete Selected
            </Button>
            <button onClick={() => setSelected(new Set())} className="ml-auto text-xs font-semibold text-violet-700 hover:underline">
              Clear selection
            </button>
          </div>
        )}

        {error ? (
          <p className="p-5 text-sm text-red-700">{error}</p>
        ) : loading && !data ? (
          <Loading />
        ) : (
          <>
            <Table
              head={[
                <input
                  key="all"
                  type="checkbox"
                  aria-label="Select all on this page"
                  className="h-4 w-4 rounded border-slate-300 accent-violet-600"
                  checked={allOnPage}
                  onChange={(e) => setSelected(e.target.checked ? new Set(items.map((r) => r.id)) : new Set())}
                />,
                'Source URL (Old URL)',
                'Destination URL (New URL)',
                <span key="t" className="block text-center">Redirect Type</span>,
                <span key="s" className="block text-center">Status</span>,
                <span key="a" className="block text-center">Actions</span>,
              ]}
              empty={
                !items.length && (
                  <Empty
                    title={term || type || status ? 'No redirect matches' : 'No URL redirects yet'}
                    desc={term || type || status ? 'Try another search or filter.' : 'Add one above, or import old URLs from Google Search Console with Import CSV.'}
                  />
                )
              }
            >
              {items.map((r) => (
                <tr key={r.id} className={cx('hover:bg-slate-50', selected.has(r.id) && 'bg-violet-50/50', editing?.id === r.id && 'bg-violet-50')}>
                  <Td className="w-10">
                    <input type="checkbox" aria-label={`Select ${r.sourcePath}`} className="h-4 w-4 rounded border-slate-300 accent-violet-600" checked={selected.has(r.id)} onChange={(e) => pick(r.id, e.target.checked)} />
                  </Td>
                  <Td className="max-w-[340px]">
                    <a href={view(r.sourcePath)} target="_blank" rel="noopener" title="Test this URL on the website" className="block truncate font-mono text-[13px] text-slate-900 hover:text-violet-700 hover:underline">
                      {r.sourcePath}
                    </a>
                    {r.hits > 0 && <span className="text-[11px] text-slate-400">{r.hits.toLocaleString()} hit{r.hits === 1 ? '' : 's'}</span>}
                  </Td>
                  <Td className="max-w-[340px]">
                    {r.statusCode === 410 ? (
                      <span className="text-sm italic text-slate-400">— (Permanently Removed)</span>
                    ) : (
                      <span className="block truncate font-mono text-[13px]" title={r.destinationUrl || ''}>
                        {r.destinationUrl}
                      </span>
                    )}
                  </Td>
                  <Td className="text-center">
                    <span title={TYPES.find((t) => t.code === r.statusCode)?.label} className={cx('inline-block min-w-[48px] rounded-md px-2.5 py-1 text-xs font-bold ring-1 ring-inset', PILL[r.statusCode])}>
                      {r.statusCode}
                    </span>
                  </Td>
                  <Td className="text-center">
                    <button
                      onClick={() => toggle(r)}
                      disabled={busy === r.id}
                      title={r.isActive ? 'Click to deactivate' : 'Click to activate'}
                      className={cx(
                        'inline-flex min-w-[78px] items-center justify-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-60',
                        r.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-200 text-slate-600 hover:bg-slate-300',
                      )}
                    >
                      {busy === r.id ? <Spinner className="h-3 w-3" /> : null}
                      {r.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </Td>
                  <Td>
                    <div className="flex items-center justify-center gap-4 whitespace-nowrap">
                      <button onClick={() => startEdit(r)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-violet-700">
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                      <button onClick={() => setConfirm({ ids: [r.id], label: r.sourcePath })} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-red-700">
                        <Trash2 className="h-4 w-4 text-red-600" /> Delete
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
            {data && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                <span>
                  {data.counts.all.toLocaleString()} redirect{data.counts.all === 1 ? '' : 's'} · {data.counts.active.toLocaleString()} active · {data.counts.inactive.toLocaleString()} inactive
                </span>
                {loading && <Spinner className="h-3.5 w-3.5" />}
              </div>
            )}
            {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>

      {/* ---------------- delete confirmation ---------------- */}
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete redirect?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={() => confirm && bulk('delete', confirm.ids)}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          Delete <b className="break-all font-mono text-slate-800">{confirm?.label}</b>? The old URL will no longer redirect (visitors get the website&apos;s normal page or “not found”). To keep the rule but switch it off, set it
          to Inactive instead.
        </p>
      </Modal>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} base={base} dealerName={dealerName} onDone={reload} />
    </div>
  );
}

/* ---------------- Import CSV ---------------- */

function ImportModal({ open, onClose, base, dealerName, onDone }: { open: boolean; onClose: () => void; base: string; dealerName: string; onDone: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [missing, setMissing] = useState<'gone' | 'skip'>('gone');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile('');
      setRows(null);
      setResult(null);
      setErr('');
    }
  }, [open]);

  async function read(f: File | undefined) {
    setErr('');
    setResult(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return setErr('The file is larger than 5 MB.');
    const r = csvRows(await f.text());
    setFile(f.name);
    if (!r.length) return setErr('No URLs found. The file needs a column source_url (or URL).');
    if (r.length > 5000) return setErr(`The file has ${r.length.toLocaleString()} URLs — at most 5,000 per import. Split it and import the parts.`);
    setRows(r);
  }

  const withoutDest = rows ? rows.filter((r) => !r.destination_url && !r.type).length : 0;

  async function send() {
    if (!rows) return;
    setSending(true);
    setErr('');
    try {
      const r = await api<ImportResult>(`${base}/import`, { method: 'POST', body: { rows, missingDestination: missing } });
      setResult(r);
      toast.ok(`Imported — ${r.created} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ''}`);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function template() {
    const csv = '﻿source_url,destination_url,type,status\r\n/vehicle.html?id=123,/inventory/2014-chevrolet-express-lt-3500,301,active\r\n/vdp/24475536/used-2004-honda-accord,/inventory/2004-honda-accord,302,active\r\n/brochure?dealer=19827&id=24475400,,410,active\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'redirects-template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Import redirects — ${dealerName}`}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button className={VIOLET} onClick={send} loading={sending} disabled={!rows}>
              {rows ? `Import ${rows.length.toLocaleString()} URL${rows.length === 1 ? '' : 's'}` : 'Import'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-semibold text-emerald-700">
            <CheckCircle2 className="h-5 w-5" /> Import finished
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Added', result.created, 'text-emerald-700'],
              ['Updated', result.updated, 'text-blue-700'],
              ['Skipped', result.skipped, result.skipped ? 'text-amber-700' : 'text-slate-500'],
            ].map(([l, n, c]) => (
              <div key={l as string} className="rounded-xl border border-slate-200 py-2">
                <div className={cx('text-xl font-bold', c as string)}>{(n as number).toLocaleString()}</div>
                <div className="text-xs text-slate-500">{l}</div>
              </div>
            ))}
          </div>
          {result.errors.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {result.errors.map((e, i) => (
                <div key={i} className="py-0.5">
                  Line {e.line}: <span className="break-all font-mono">{e.source || '(empty)'}</span> — {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p>
            Columns: <code className="font-mono text-xs text-slate-800">source_url,destination_url,type,status</code>. A URL already in the list is updated. Old URLs exported from Google Search Console (one URL column) work as
            they are.{' '}
            <button type="button" onClick={template} className="font-semibold text-violet-700 hover:underline">
              Download a template
            </button>
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void read(e.dataTransfer.files?.[0]);
            }}
            className={cx('flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition', drag ? 'border-violet-500 bg-violet-50' : 'border-slate-300 hover:border-violet-400 hover:bg-slate-50')}
          >
            <FileUp className="h-7 w-7 text-violet-600" />
            <span className="text-sm font-semibold text-slate-800">{file || 'Choose a CSV file or drop it here'}</span>
            {rows && <span className="text-xs text-slate-500">{rows.length.toLocaleString()} URLs found</span>}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.txt"
            className="hidden"
            onChange={(e) => {
              void read(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {rows && withoutDest > 0 && (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-700">
                {withoutDest.toLocaleString()} URL{withoutDest === 1 ? ' has' : 's have'} no destination and no type:
              </div>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" className="accent-violet-600" checked={missing === 'gone'} onChange={() => setMissing('gone')} /> Mark them <b className="text-slate-800">410 – Gone</b> (Google drops them)
              </label>
              <label className="flex items-center gap-2 py-0.5">
                <input type="radio" className="accent-violet-600" checked={missing === 'skip'} onChange={() => setMissing('skip')} /> Skip them
              </label>
            </div>
          )}
          {rows && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
              {rows.slice(0, 8).map((r) => (
                <div key={r.line} className="truncate">
                  {r.source_url} {r.destination_url ? `→ ${r.destination_url}` : ''} {r.type ? `[${r.type}]` : ''}
                </div>
              ))}
              {rows.length > 8 && <div className="pt-1 text-slate-400">… and {(rows.length - 8).toLocaleString()} more</div>}
            </div>
          )}
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
