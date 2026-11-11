'use client';

import { useEffect, useState } from 'react';
import { Check, Eye, Lock, Monitor, Smartphone } from 'lucide-react';
import { api, mediaUrl, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useTenant } from '@/components/DealerShell';
import { useToast } from '@/components/toast';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, PageHeader, Textarea, cx } from '@/components/ui';

export default function DesignPage() {
  const { data, setData, loading, error, reload } = useApi('/dealer/design');
  const { tenant } = useTenant();
  const toast = useToast();
  const [colors, setColors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [request, setRequest] = useState<any>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ id: string; device: 'desktop' | 'mobile' } | null>(null);

  useEffect(() => {
    if (data) setColors(data.colors.values);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !tenant) return null;

  async function activate(id: string) {
    setBusy(id);
    try {
      setData(await api('/dealer/design/activate', { body: { themeId: id } }));
      toast.ok('Your website now uses this design');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function saveColors() {
    setBusy('colors');
    try {
      setData(await api('/dealer/design/colors', { method: 'PUT', body: { colors } }));
      toast.ok('Colours saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader
        title="② Design & colours"
        desc="Pick how your website looks. Your text, vehicles and business details follow you to any design."
      />

      <Card title={`Brand colours · ${data.current.name}`} className="mb-6" actions={<Button size="sm" onClick={saveColors} loading={busy === 'colors'}>Save colours</Button>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.colors.slots.map((s: { key: string; label: string; default: string; hint: string }) => (
            <Field key={s.key} label={s.label} hint={s.hint}>
              <div className="flex items-center gap-2">
                <input type="color" value={colors[s.key] || s.default} onChange={(e) => setColors({ ...colors, [s.key]: e.target.value })} className="h-10 w-12 cursor-pointer rounded border border-slate-300" />
                <Input value={colors[s.key] || ''} onChange={(e) => setColors({ ...colors, [s.key]: e.target.value })} className="font-mono uppercase" />
                {colors[s.key]?.toUpperCase() !== s.default.toUpperCase() && (
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => setColors({ ...colors, [s.key]: s.default })}>
                    Reset
                  </button>
                )}
              </div>
            </Field>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {data.catalog.map((t: any) => (
          <div key={t.id} className={cx('overflow-hidden rounded-2xl border bg-white shadow-sm', t.active ? 'border-blue-600 ring-2 ring-blue-600/30' : 'border-slate-200')}>
            <div className="relative aspect-[16/10] bg-slate-100">
              {t.previewUrl && <img src={mediaUrl(t.previewUrl)} alt={t.name} className="h-full w-full object-cover" />}
              {t.active && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-blue-700 px-2.5 py-1 text-xs font-bold text-white">
                  <Check className="h-3.5 w-3.5" /> Your design
                </span>
              )}
              {t.access.paid && !t.access.unlocked && !t.active && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-bold text-white">
                  <Lock className="h-3 w-3" /> {t.access.label}
                </span>
              )}
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-heading text-base font-bold text-slate-900">{t.name}</h3>
                <Badge>{t.style}</Badge>
              </div>
              <p className="mt-1 min-h-[40px] text-sm text-slate-500">{t.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPreview({ id: t.id, device: 'desktop' })}>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </Button>
                {!t.active &&
                  (t.access.allowed ? (
                    <Button size="sm" onClick={() => activate(t.id)} loading={busy === t.id}>
                      Use this design
                    </Button>
                  ) : t.access.requested ? (
                    <Badge color="amber">Requested — waiting for confirmation</Badge>
                  ) : (
                    <Button size="sm" variant="success" onClick={() => setRequest(t)}>
                      <Lock className="h-3.5 w-3.5" /> Unlock · {t.access.label}
                    </Button>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 p-4">
          <div className="mb-3 flex items-center justify-between text-white">
            <div className="flex gap-2">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button key={d} onClick={() => setPreview({ ...preview, device: d })} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold', preview.device === d ? 'bg-white text-slate-900' : 'bg-white/10')}>
                  {d === 'desktop' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />} {d}
                </button>
              ))}
            </div>
            <span className="text-sm">Preview with your own details — nothing changes until you choose “Use this design”.</span>
            <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>
              Close
            </Button>
          </div>
          <div className="flex flex-1 justify-center">
            <iframe src={siteUrl(tenant, `index.html?pa_theme_preview=${preview.id}`)} className={cx('h-full rounded-xl bg-white', preview.device === 'desktop' ? 'w-full' : 'w-[390px]')} />
          </div>
        </div>
      )}

      <Modal
        open={!!request}
        onClose={() => setRequest(null)}
        title={`Unlock ${request?.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRequest(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'request'}
              onClick={async () => {
                setBusy('request');
                try {
                  await api('/dealer/design/request', { body: { themeId: request.id, note } });
                  toast.ok('Request sent. The design is unlocked once your payment is confirmed.');
                  setRequest(null);
                  setNote('');
                  reload();
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}
            >
              Send request
            </Button>
          </>
        }
      >
        <p className="mb-3">
          <b>{request?.access.label}</b> — {request?.description}
        </p>
        {data.paymentInstructions && <p className="mb-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-xs">{data.paymentInstructions}</p>}
        <Field label="Message (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid by bank transfer on…" />
        </Field>
      </Modal>
    </>
  );
}
