'use client';

import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Eye, FileUp, Settings2, Trash2, Wand2 } from 'lucide-react';
import { api, auth, API_URL } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, Drawer, ErrorBox, Input, Loading, Select, cx } from '@/components/ui';

/**
 * Official fillable state form (Virginia DMV VSA 17A): upload the government PDF, its fields are found and matched
 * to deal values automatically, and the mapping can be corrected. Used by Business details (base
 * "/dealer/deals/form-templates") and Platform Admin › State forms (base "/platform/state-forms").
 */
type Key = { key: string; label: string; group: string; bool: boolean };
type Tpl = { id: string; stateCode: string; formName: string; pdfFields: { name: string; type: string }[]; fieldMappings: Record<string, string>; isActive: boolean; createdAt: string; uploadedBy: string };

async function openPdf(path: string) {
  const w = window.open('', '_blank');
  const headers: Record<string, string> = {};
  const token = auth.token();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenant = (auth as { supportTenant?: () => string }).supportTenant?.() || '';
  if (tenant && path.startsWith('/dealer/')) headers['X-Tenant-Id'] = tenant;
  const res = await fetch(API_URL + path, { headers, cache: 'no-store' });
  if (!res.ok) {
    w?.close();
    throw new Error('The PDF could not be opened.');
  }
  const url = URL.createObjectURL(await res.blob());
  if (w) w.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const isBox = (t: string) => /check|radio|button/i.test(t);

export function StateFormTemplates({ base, scope }: { base: string; scope: 'dealer' | 'platform' }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ templates: Tpl[]; global: Tpl | null; keys: Key[] }>(base);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<Tpl | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function upload(f?: File) {
    if (!f) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('stateCode', 'VA');
      const t = await api<Tpl>(base, { form: fd });
      const n = Object.keys(t.fieldMappings || {}).length;
      toast.ok(`Uploaded: ${t.pdfFields.length} fields found, ${n} matched automatically`);
      await reload();
      setEdit(t);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function patch(t: Tpl, body: Record<string, unknown>, msg: string) {
    setBusy(t.id);
    try {
      const r = await api<Tpl>(`${base}/${t.id}`, { method: 'PATCH', body });
      toast.ok(msg);
      await reload();
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy('');
    }
  }

  async function remove(t: Tpl) {
    if (!window.confirm('Delete this form? The built-in layout is used instead.')) return;
    setBusy(t.id);
    try {
      await api(`${base}/${t.id}`, { method: 'DELETE' });
      toast.ok('Form deleted');
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  const list = data?.templates || [];
  const active = list.find((t) => t.isActive);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {active ? (
          <>
            <CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />
            {scope === 'dealer' ? 'Your uploaded form is used for VSA 17A.' : 'This form is used for every dealership without its own.'}
          </>
        ) : scope === 'dealer' && data?.global ? (
          'The platform’s official VSA 17A is used. Upload your own copy only if you need a different version.'
        ) : (
          'The built-in VSA 17A layout is used. Upload the official fillable PDF from the DMV to fill it instead.'
        )}
      </p>

      {list.map((t) => {
        const mapped = Object.keys(t.fieldMappings || {}).length;
        return (
          <div key={t.id} className={cx('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', t.isActive ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200')}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <b className="truncate text-sm text-slate-900">{t.formName}</b>
                {t.isActive ? <Badge color="green">In use</Badge> : <Badge>Off</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {t.stateCode} · {t.pdfFields.length} fields · {mapped} mapped · {new Date(t.createdAt).toLocaleDateString('en-US')}
              </div>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => openPdf(`${base}/${t.id}/pdf`).catch((e) => toast.error(e.message))}>
              <Eye className="h-3.5 w-3.5" /> View
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setEdit(t)}>
              <Settings2 className="h-3.5 w-3.5" /> Field mapping
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => openPdf(`${base}/${t.id}/pdf?sample=1`).catch((e) => toast.error(e.message))}>
              <Wand2 className="h-3.5 w-3.5" /> Test fill
            </Button>
            <Button type="button" size="sm" variant="ghost" loading={busy === t.id} onClick={() => patch(t, { isActive: !t.isActive }, t.isActive ? 'Form switched off' : 'Form in use')}>
              {t.isActive ? 'Switch off' : 'Use'}
            </Button>
            <button type="button" title="Delete" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(t)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <input ref={file} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        void upload(f);
      }} />
      <Button type="button" variant="secondary" loading={busy === 'upload'} onClick={() => file.current?.click()}>
        <FileUp className="h-4 w-4" /> Upload fillable VSA 17A (PDF)
      </Button>

      {edit && data && (
        <Mapper
          tpl={edit}
          keys={data.keys}
          busy={busy === edit.id}
          onClose={() => setEdit(null)}
          onAuto={async () => {
            const r = await patch(edit, { autoMap: true }, 'Fields matched automatically');
            if (r) setEdit(r);
          }}
          onSave={async (m) => {
            const r = await patch(edit, { fieldMappings: m }, 'Field mapping saved');
            if (r) setEdit(null);
          }}
          onTest={() => openPdf(`${base}/${edit.id}/pdf?sample=1`).catch((e) => toast.error(e.message))}
        />
      )}
    </div>
  );
}

function Mapper({
  tpl, keys, busy, onClose, onAuto, onSave, onTest,
}: {
  tpl: Tpl;
  keys: Key[];
  busy: boolean;
  onClose: () => void;
  onAuto: () => void;
  onSave: (m: Record<string, string>) => void;
  onTest: () => void;
}) {
  const [m, setM] = useState<Record<string, string>>(tpl.fieldMappings || {});
  const [q, setQ] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const groups = useMemo(() => {
    const g = new Map<string, Key[]>();
    for (const k of keys) g.set(k.group, [...(g.get(k.group) || []), k]);
    return [...g.entries()];
  }, [keys]);
  const fields = tpl.pdfFields.filter((f) => (!q || f.name.toLowerCase().includes(q.toLowerCase())) && (!onlyOpen || !m[f.name]));
  const mapped = Object.values(m).filter(Boolean).length;

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={`Field mapping · ${mapped} of ${tpl.pdfFields.length} fields filled`}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onTest}>
            <Eye className="h-4 w-4" /> Test with sample data
          </Button>
          <Button type="button" variant="secondary" loading={busy} onClick={onAuto}>
            <Wand2 className="h-4 w-4" /> Match automatically
          </Button>
          <Button type="button" loading={busy} onClick={() => onSave(Object.fromEntries(Object.entries(m).filter(([, v]) => v)))}>
            Save mapping
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Choose which deal value goes into each field of the PDF. Fields left empty stay blank.</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search fields" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Only empty
        </label>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-3">PDF field</th>
            <th className="py-2">Filled with</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {fields.map((f) => (
            <tr key={f.name}>
              <td className="py-1.5 pr-3 align-middle">
                <div className="break-all font-mono text-xs text-slate-800">{f.name}</div>
                <div className="text-[11px] text-slate-400">{isBox(f.type) ? 'Checkbox' : f.type.replace(/Field$/, '') || 'Text'}</div>
              </td>
              <td className="py-1.5">
                <Select value={m[f.name] || ''} onChange={(e) => setM({ ...m, [f.name]: e.target.value })} className={cx(!m[f.name] && 'text-slate-400')}>
                  <option value="">— leave blank —</option>
                  {groups.map(([g, ks]) => (
                    <optgroup key={g} label={g}>
                      {ks
                        .filter((k) => (isBox(f.type) ? true : !k.bool))
                        .map((k) => (
                          <option key={k.key} value={k.key}>
                            {k.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Drawer>
  );
}
