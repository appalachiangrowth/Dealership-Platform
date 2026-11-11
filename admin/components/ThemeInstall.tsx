'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PackageOpen, RotateCcw, Upload } from 'lucide-react';
import { api, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from './toast';
import { Button, Card, Field, Modal, Select } from './ui';

type Theme = { id: string; name: string; installed: string[]; versions: { version: string }[]; stableVersion: string };

/**
 * Platform Admin › Themes & releases › Install & switch (same as the old platform):
 *  - Switch a dealership's design: one dealership only, pinned to a version; inventory, photos, inquiries, text and settings stay.
 *  - Roll back last change.
 *  - Install a design package: ZIP with one theme.json, templates/, optional partials/ and assets/. Installed as a new
 *    version; nothing is activated.
 */
export function ThemeInstall({ themes, onChanged }: { themes: Theme[]; onChanged: () => void }) {
  const tenants = useApi('/platform/tenants');
  const toast = useToast();
  const [tenantId, setTenantId] = useState('');
  const [themeId, setThemeId] = useState('');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<'' | 'activate' | 'rollback'>('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; preview?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const list: any[] = tenants.data || [];
  const tenant = list.find((t) => t.id === tenantId);
  const theme = themes.find((t) => t.id === themeId);
  const versions = useMemo(() => {
    if (!theme) return [];
    const v = theme.installed?.length ? theme.installed : theme.versions.map((x) => x.version);
    return [...new Set(v)];
  }, [theme]);

  // pick the first dealership; follow its current design + version
  useEffect(() => {
    if (!tenantId && list.length) setTenantId(list[0].id);
  }, [list, tenantId]);
  useEffect(() => {
    if (!tenant) return;
    const known = themes.some((t) => t.id === tenant.themeId);
    setThemeId(known ? tenant.themeId : themes[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);
  useEffect(() => {
    if (!theme) return;
    const pin = tenant && tenant.themeId === theme.id ? tenant.themePin : '';
    setVersion(pin && versions.includes(pin) ? pin : versions[versions.length - 1] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, versions.join(',')]);

  async function run(kind: 'activate' | 'rollback') {
    setBusy(kind);
    try {
      const r =
        kind === 'activate'
          ? await api('/platform/themes/activate-tenant', { body: { tenantId, themeId, version } })
          : await api('/platform/themes/rollback-tenant', { body: { tenantId } });
      toast.ok(r.message || 'Done');
      tenants.reload();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
      setAsk('');
    }
  }

  async function install(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !/\.zip$/i.test(file.name)) return toast.error('Choose a .zip file.');
    if (file.size > 40 * 1024 * 1024) return toast.error('The ZIP must be smaller than 40 MB.');
    setBusy('install');
    setResult({ ok: true, text: 'Checking the manifest and archive paths…' });
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const r = await api('/platform/themes/install', { form });
      const first = list[0] ? { id: list[0].id, domains: list[0].domains?.map((d: any) => d.domain) } : null;
      setResult({
        ok: true,
        text: `Installed ${r.theme.name} ${r.theme.version}. Not activated yet${r.theme.isNew ? ' — it now appears in every dealer’s Design & colours gallery' : ''}.`,
        preview: first ? siteUrl(first, `index.html?pa_theme_preview=${encodeURIComponent(r.theme.id)}`) : '',
      });
      toast.ok(`Installed ${r.theme.name} ${r.theme.version}. Not activated yet.`);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    } catch (er) {
      setResult({ ok: false, text: (er as Error).message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Switch a dealership's design">
        <p className="-mt-1 mb-4 text-sm text-slate-500">Changes one dealership only. Inventory, photos, inquiries, text and settings stay in place.</p>
        {!list.length ? (
          <p className="text-sm text-slate-500">{tenants.loading ? 'Loading…' : 'Add a dealership first.'}</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Dealership" hint={tenant ? `Now: ${themes.find((t) => t.id === tenant.themeId)?.name || tenant.themeId}${tenant.themePin ? ` ${tenant.themePin} (pinned)` : ' (follows its release channel)'}` : undefined}>
                  <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Design">
                <Select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
                  {themes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Version">
                <Select value={version} onChange={(e) => setVersion(e.target.value)}>
                  {versions.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => setAsk('activate')} disabled={!tenantId || !themeId || !version}>
                Activate for dealership
              </Button>
              <Button variant="secondary" onClick={() => setAsk('rollback')} disabled={!tenantId}>
                <RotateCcw className="h-4 w-4" /> Roll back last change
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card title="Install a design package">
        <p className="-mt-1 mb-4 text-sm text-slate-500">
          Upload a ZIP with one <code>theme.json</code>, <code>templates/</code>, optional <code>partials/</code> and <code>assets/</code>. PHP and server files are rejected. Installed as a new version; nothing is activated.
        </p>
        <form onSubmit={install} className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 px-4 py-4 hover:border-slate-400">
            <PackageOpen className="h-6 w-6 shrink-0 text-slate-400" />
            <span className="min-w-0 text-sm">
              <b className="block truncate text-slate-800">{file ? file.name : 'Choose a design ZIP'}</b>
              <span className="text-slate-500">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : 'Up to 40 MB · 800 files · 15 MB per file'}</span>
            </span>
            <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <Button type="submit" loading={busy === 'install'} disabled={!file}>
            <Upload className="h-4 w-4" /> Validate &amp; install
          </Button>
        </form>
        {result && (
          <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`} aria-live="polite">
            {result.text}
            {result.preview && (
              <>
                {' '}
                <a className="font-semibold underline" href={result.preview} target="_blank" rel="noreferrer">
                  Preview newest
                </a>
              </>
            )}
          </div>
        )}
        <details className="mt-4 text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">What the ZIP must contain</summary>
          <pre className="mt-2 rounded-lg bg-slate-50 p-3 leading-5">{`theme.json        { "id": "showroom", "version": "1.0.0", "name": "Showroom",
                    "pages": [{ "id": "home", "label": "Home", "template": "index.html", "sitemap": true }] }
templates/index.html
partials/site-header.html   (optional)
assets/css/theme.css …      (optional: css, js, images, fonts, 3D models)
assets/preview.jpg          (optional: picture shown in the design galleries)`}</pre>
          Reuse the platform's content markers ({'{%text …%}'}, {'{%site …%}'}) and its inventory, settings and lead addresses.
        </details>
      </Card>

      <Modal
        open={!!ask}
        onClose={() => setAsk('')}
        title={ask === 'activate' ? 'Activate design' : 'Roll back'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsk('')}>
              Cancel
            </Button>
            <Button loading={!!busy} onClick={() => run(ask as 'activate' | 'rollback')}>
              {ask === 'activate' ? 'Activate' : 'Roll back'}
            </Button>
          </>
        }
      >
        {ask === 'activate' ? `Activate ${theme?.name} ${version} for ${tenant?.name}?` : `Restore the previous design for ${tenant?.name}?`}
      </Modal>
    </div>
  );
}
