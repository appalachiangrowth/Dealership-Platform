'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, CreditCard, Eye, Lock, RotateCcw, Smartphone, Undo2 } from 'lucide-react';
import { api, mediaUrl, siteUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useTenant } from '@/components/DealerShell';
import { useToast } from '@/components/toast';
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, Textarea, cx } from '@/components/ui';
import { LivePreview, SiteThumbnail, type LivePreviewHandle } from '@/components/LivePreview';

type Slot = { key: string; label: string; default: string; hint: string };

/** How a dealer can pay for a design. The payment gateways are connected later: for now the choice is recorded. */
const PAY_METHODS = [
  { id: 'card', name: 'Credit / Debit card', sub: 'Visa, Mastercard, UnionPay', color: 'text-slate-700 bg-slate-100', Icon: CreditCard },
  { id: 'jazzcash', name: 'JazzCash', sub: 'Mobile account or JazzCash app', color: 'text-red-700 bg-red-50', Icon: Smartphone },
  { id: 'easypaisa', name: 'Easypaisa', sub: 'Mobile account or Easypaisa app', color: 'text-emerald-700 bg-emerald-50', Icon: Smartphone },
] as const;

/** Design picture: the saved preview image, or a live picture of the design when there is no image. */
function DesignPicture({ src, alt, live }: { src: string; alt: string; live: string }) {
  const [failed, setFailed] = useState(!src);
  useEffect(() => setFailed(!src), [src]);
  if (failed) return <SiteThumbnail src={live} className="h-full w-full" />;
  return <img src={src} alt={alt} className="h-full w-full object-cover object-top" onError={() => setFailed(true)} />;
}

export default function DesignPage() {
  const { data, setData, loading, error, reload } = useApi('/dealer/design');
  const { tenant } = useTenant();
  const toast = useToast();
  const [colors, setColors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [request, setRequest] = useState<any>(null);
  const [note, setNote] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payDone, setPayDone] = useState('');
  const [previewId, setPreviewId] = useState(''); // a design being tried (not activated)
  const preview = useRef<LivePreviewHandle>(null);

  useEffect(() => {
    if (data) setColors(data.colors.values || {});
  }, [data]);

  const currentId: string = data?.current?.themeId || data?.catalog?.find((t: any) => t.active)?.id || '';
  const showingCurrent = !previewId || previewId === currentId;

  // colour pickers → the preview changes at once (saved only with "Save colours")
  useEffect(() => {
    if (!data || !showingCurrent) return;
    const t = setTimeout(() => preview.current?.send({ pa: 'colors', colors: withDefaults(colors, data.colors.slots) }), 60);
    return () => clearTimeout(t);
  }, [colors, data, showingCurrent]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !tenant) return null;
  const slots: Slot[] = data.colors.slots || [];
  const saved: Record<string, string> = data.colors.values || {};
  const colorsChanged = slots.some((s) => (colors[s.key] || '').toUpperCase() !== (saved[s.key] || '').toUpperCase());
  const tried = data.catalog.find((t: any) => t.id === previewId);

  async function activate(id: string) {
    setBusy(id);
    try {
      setData(await api('/dealer/design/activate', { body: { themeId: id } }));
      setPreviewId('');
      toast.ok('Your website now uses this design');
      preview.current?.reload();
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
      preview.current?.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const previewSrc = siteUrl(tenant, `index.html?pa_live=1&pa_tenant=${encodeURIComponent(tenant.id)}${showingCurrent ? '' : `&pa_theme_preview=${encodeURIComponent(previewId)}`}`);

  return (
    <div className="grid gap-6 lg:h-[calc(100vh-3rem)] lg:grid-cols-[minmax(360px,520px)_1fr]">
      {/* ---------------- designs + colours ---------------- */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 pb-4 pt-5">
          <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Set up your website · Step 2 of 3</div>
          <h1 className="mt-1 font-heading text-xl font-extrabold text-slate-900">Design & colours</h1>
          <p className="mt-1 text-sm text-slate-500">Pick how your website looks. Your text, vehicles and business details follow you to any design.</p>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/60 px-4 py-4">
          {/* brand colours */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">Brand colours</div>
                <div className="text-xs text-slate-500">For {data.current.name} — changes show in the preview right away.</div>
              </div>
              <div className="flex gap-2">
                {colorsChanged && (
                  <Button variant="secondary" size="sm" onClick={() => setColors(saved)}>
                    <Undo2 className="h-3.5 w-3.5" /> Undo
                  </Button>
                )}
                <Button size="sm" onClick={saveColors} loading={busy === 'colors'} disabled={!colorsChanged}>
                  Save colours
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {slots.map((s) => {
                const v = colors[s.key] || '';
                return (
                  <Field key={s.key} label={s.label} hint={s.hint}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(v) ? v : s.default}
                        onChange={(e) => setColors({ ...colors, [s.key]: e.target.value.toUpperCase() })}
                        className="h-10 w-12 shrink-0 cursor-pointer rounded border border-slate-300"
                      />
                      <Input value={v} placeholder={s.default} onChange={(e) => setColors({ ...colors, [s.key]: e.target.value })} className="font-mono uppercase" />
                      {v && v.toUpperCase() !== s.default.toUpperCase() && (
                        <button type="button" title="Back to the design's own colour" className="shrink-0 text-slate-400 hover:text-slate-700" onClick={() => setColors({ ...colors, [s.key]: s.default })}>
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </Field>
                );
              })}
            </div>
          </div>

          {/* designs */}
          <div className="grid gap-4 sm:grid-cols-2">
            {data.catalog.map((t: any) => {
              const isTried = previewId === t.id && !t.active;
              return (
                <div
                  key={t.id}
                  className={cx(
                    'overflow-hidden rounded-xl border bg-white transition',
                    t.active ? 'border-blue-600 ring-2 ring-blue-600/25' : isTried ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-slate-200',
                  )}
                >
                  <button type="button" onClick={() => setPreviewId(t.active ? '' : t.id)} className="relative block aspect-[16/10] w-full bg-slate-100 text-left" title="Show in the preview">
                    <DesignPicture src={t.previewUrl ? mediaUrl(t.previewUrl) : ''} alt={t.name} live={siteUrl(tenant, `index.html?pa_live=1&pa_theme_preview=${encodeURIComponent(t.id)}`)} />
                    {t.active && (
                      <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-blue-700 px-2 py-0.5 text-[11px] font-bold text-white">
                        <Check className="h-3 w-3" /> Your design
                      </span>
                    )}
                    {isTried && <span className="absolute left-2 top-2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">In the preview</span>}
                    {t.access.paid && !t.access.unlocked && !t.active && (
                      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] font-bold text-white">
                        <Lock className="h-3 w-3" /> {t.access.label}
                      </span>
                    )}
                  </button>
                  <div className="p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-heading text-sm font-bold text-slate-900">{t.name}</h3>
                      <Badge>{t.style}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-[32px] text-xs text-slate-500">{t.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {!t.active && (
                        <Button variant="secondary" size="sm" onClick={() => setPreviewId(t.id)} disabled={isTried}>
                          <Eye className="h-3.5 w-3.5" /> {isTried ? 'Showing' : 'Preview'}
                        </Button>
                      )}
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
              );
            })}
          </div>
        </div>
      </div>

      {/* ---------------- live preview ---------------- */}
      <LivePreview
        ref={preview}
        className="hidden min-h-[600px] lg:flex"
        src={previewSrc}
        openUrl={showingCurrent ? siteUrl(tenant) : siteUrl(tenant, `index.html?pa_theme_preview=${encodeURIComponent(previewId)}`)}
        title={showingCurrent ? `Your website · ${data.current.name}` : `Trying ${tried?.name || previewId}`}
        onReady={() => {
          const c = Object.keys(colors).length ? colors : (data?.colors?.values || {});
          if (showingCurrent) preview.current?.send({ pa: 'colors', colors: withDefaults(c, slots) });
        }}
        banner={
          !showingCurrent && tried ? (
            <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <span>
                Previewing <b>{tried.name}</b> with your own details — your website does not change until you choose it.
              </span>
              <span className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPreviewId('')}>
                  Back to my design
                </Button>
                {tried.access.allowed ? (
                  <Button size="sm" onClick={() => activate(tried.id)} loading={busy === tried.id}>
                    Use this design
                  </Button>
                ) : (
                  !tried.access.requested && (
                    <Button size="sm" variant="success" onClick={() => setRequest(tried)}>
                      <Lock className="h-3.5 w-3.5" /> Unlock
                    </Button>
                  )
                )}
              </span>
            </div>
          ) : null
        }
      />

      <Modal
        open={!!request}
        onClose={() => {
          setRequest(null);
          setPayMethod('');
          setPayDone('');
        }}
        title={`Unlock ${request?.name}`}
        footer={
          payDone ? (
            <Button
              onClick={() => {
                setRequest(null);
                setPayMethod('');
                setPayDone('');
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setRequest(null)}>
                Cancel
              </Button>
              <Button
                disabled={!payMethod}
                loading={busy === 'request'}
                onClick={async () => {
                  const m = PAY_METHODS.find((x) => x.id === payMethod);
                  if (!m) return;
                  setBusy('request');
                  try {
                    // until the gateways are connected the choice is sent to the platform team, who completes the payment with the dealer
                    await api('/dealer/design/request', { body: { themeId: request.id, note: [`Payment method: ${m.name}`, note.trim()].filter(Boolean).join('\n') } });
                    setPayDone(m.name);
                    setNote('');
                    reload();
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" />
                {payMethod ? `Pay ${request?.access.label} with ${PAY_METHODS.find((x) => x.id === payMethod)?.name}` : 'Choose a payment method'}
              </Button>
            </>
          )
        }
      >
        {payDone ? (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <Check className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <b className="block">Payment with {payDone} chosen</b>
              Online payment opens here soon. For now the platform team has your request and will contact you to complete the payment; {request?.name} is
              unlocked as soon as it is confirmed.
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <span className="min-w-0">
                <b className="block text-slate-900">{request?.name}</b>
                <span className="line-clamp-2 text-xs text-slate-500">{request?.description}</span>
              </span>
              <b className="shrink-0 text-lg text-slate-900">{request?.access.label}</b>
            </div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Choose how to pay</p>
            <div className="space-y-2" role="radiogroup" aria-label="Payment method">
              {PAY_METHODS.map((m) => {
                const on = payMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPayMethod(m.id)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition',
                      on ? 'border-blue-600 bg-blue-50/60 ring-1 ring-blue-600' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', m.color)}>
                      <m.Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block text-sm text-slate-900">{m.name}</b>
                      <span className="text-xs text-slate-500">{m.sub}</span>
                    </span>
                    <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300')}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <Field label="Message (optional)" className="mt-4">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the platform team should know" />
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
}

/** Colours to show: what is typed; empty / unfinished values ('') fall back to the design's own colours. */
function withDefaults(colors: Record<string, string>, slots: Slot[]) {
  const out: Record<string, string> = {};
  for (const s of slots) {
    const v = colors[s.key] || '';
    out[s.key] = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? v : '';
  }
  return out;
}
