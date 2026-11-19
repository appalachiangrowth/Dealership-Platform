'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Car, ImageIcon, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useToast } from '@/components/toast';
import { Badge, Button, ErrorBox, Input, Loading, Toggle, cx } from '@/components/ui';
import { brandRun, drawFooter, drawHeader, fontsReady, loadPicture, onBrandingChange, type BrandView } from '@/lib/branding';

const SWATCHES = ['#EAF0F8', '#FFFFFF', '#F3F4F6', '#0F2B4C', '#111827', '#7F1D1D', '#14532D'];

/** Picture of a band (canvas or bitmap) as an <img> source. */
function toUrl(d: HTMLCanvasElement | ImageBitmap): string {
  if (d instanceof HTMLCanvasElement) return d.toDataURL('image/png');
  const c = document.createElement('canvas');
  c.width = d.width;
  c.height = d.height;
  c.getContext('2d')!.drawImage(d, 0, 0);
  return c.toDataURL('image/png');
}

/** Dealership Portal › Website content › Photo branding (same screen as the old portal). */
export default function PhotoBrandingPage() {
  const { data, setData, loading, error, reload } = useApi<BrandView>('/dealer/branding');
  const toast = useToast();
  const [color, setColor] = useState('#EAF0F8');
  const [bands, setBands] = useState<{ header: string; footer: string }>({ header: '', footer: '' });
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [upWhich, setUpWhich] = useState<'header' | 'footer'>('header');

  useEffect(() => onBrandingChange(() => reload()), [reload]);
  useEffect(() => {
    if (data) setColor(data.details.color);
  }, [data?.details.color]); // eslint-disable-line react-hooks/exhaustive-deps

  // band pictures: own PNG, else drawn from Business details (with the colour being chosen, as a live preview)
  useEffect(() => {
    if (!data) return;
    let stop = false;
    (async () => {
      await fontsReady();
      const d = { ...data.details, color: /^#[0-9a-f]{6}$/i.test(color) ? color : data.details.color };
      const logo = !data.header.custom && d.logo ? await loadPicture(d.logo).catch(() => null) : null;
      const header = data.header.custom ? toUrl(await loadPicture(data.header.url)) : toUrl(drawHeader(d, logo));
      const footer = data.footer.custom ? toUrl(await loadPicture(data.footer.url)) : toUrl(drawFooter(d));
      if (!stop) setBands({ header, footer });
    })().catch(() => {});
    return () => {
      stop = true;
    };
  }, [data, color]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;
  const D = data.details;
  const missing: React.ReactNode[] = [];
  if (!D.logo) missing.push(<>your <b>logo</b> (your dealership name is shown instead)</>);
  if (!D.street || !D.cityLine) missing.push(<>your <b>address</b></>);
  if (!D.phone) missing.push(<>your <b>phone number</b></>);
  if (!D.site) missing.push(<>your <b>website address</b></>);

  const after = (v: BrandView, msg: string) => {
    setData(v);
    toast.ok(v.pending && v.enabled ? `${msg} · updating your photos…` : msg);
    if (v.pending && v.enabled) void brandRun();
  };

  async function put(body: Record<string, unknown>, msg: string, key: string) {
    setBusy(key);
    try {
      after(await api('/dealer/branding', { method: 'PUT', body }), msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function uploadBand(f: File) {
    if (!/png$/i.test(f.type) && !/\.png$/i.test(f.name)) return toast.error('Upload a PNG image');
    setBusy(`up-${upWhich}`);
    try {
      const form = new FormData();
      form.append('files', f, f.name);
      const r = await api('/dealer/media?folder=site', { form });
      if (!r.files?.[0]) throw new Error(r.errors?.[0]?.error || 'Upload failed');
      after(await api('/dealer/branding/band', { method: 'PUT', body: { which: upWhich, url: r.files[0].url } }), `${upWhich === 'header' ? 'Top' : 'Bottom'} band updated`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const slot = (w: 'header' | 'footer', label: string, what: string) => {
    const x = data[w];
    return (
      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <b className="text-slate-900">{label}</b> {x.custom ? <Badge color="blue">Your own image</Badge> : <Badge color="green">Automatic</Badge>}
            <div className="text-xs text-slate-500">{x.custom ? 'You uploaded this band yourself.' : what}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {x.custom && (
              <Button size="sm" variant="secondary" loading={busy === `def-${w}`} onClick={async () => {
                setBusy(`def-${w}`);
                try {
                  after(await api('/dealer/branding/band', { method: 'PUT', body: { which: w, url: '' } }), 'Automatic band restored');
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy('');
                }
              }}>
                Use the automatic band
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={busy === `up-${w}`}
              onClick={() => {
                setUpWhich(w);
                fileRef.current?.click();
              }}
            >
              <Upload className="h-3.5 w-3.5" /> Upload my own (PNG)
            </Button>
          </div>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
          {bands[w] ? <img src={bands[w]} alt={label} className="block w-full" /> : <div className="h-14 animate-pulse bg-slate-100" />}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <input ref={fileRef} type="file" accept="image/png" hidden onChange={(e) => e.target.files?.[0] && uploadBand(e.target.files[0])} />
      <div>
        <Link href="/dealer/content" className="mb-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-3 w-3" /> Website content
        </Link>
        <h1 className="font-heading text-2xl font-extrabold text-slate-900">Photo branding</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your logo and address on top, your phone number and website at the bottom of the main photo of every vehicle: ready for your website, CarGurus and Facebook.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Toggle checked={data.enabled} onChange={(on) => put({ enabled: on }, on ? 'Main photos will be branded' : 'Branding turned off', 'toggle')} label="Add my branding bands to the main photo of each vehicle" />
        <p className="mt-2 text-xs text-slate-500">
          Only the <b>main photo</b> (the first photo, shown in your inventory list) gets the bands. All other photos stay clean. Change the main photo and the bands move with it.
        </p>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="font-heading text-lg font-bold text-slate-900">Your bands</h2>
          <p className="text-sm text-slate-500">
            Made automatically from your{' '}
            <Link href="/dealer/business" className="text-blue-700 underline">
              Business details
            </Link>
            : logo, address, phone and website. Update them there and your bands follow.
          </p>
        </div>
        {missing.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Add{' '}
            {missing.map((m, i) => (
              <span key={i}>
                {i > 0 && ', '}
                {m}
              </span>
            ))}{' '}
            in{' '}
            <Link href="/dealer/business" className="underline">
              Business details
            </Link>{' '}
            to complete your bands.
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4 rounded-xl bg-slate-50 p-4">
          <div className="min-w-[200px] flex-1">
            <b className="block text-sm text-slate-800">Band colour</b>
            <span className="text-xs text-slate-500">Light colours get dark text, dark colours get white text automatically.</span>
            <div className="mt-2 flex items-center gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#EAF0F8'} onChange={(e) => setColor(e.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded border border-slate-300" />
              <Input value={color} maxLength={7} onChange={(e) => setColor(e.target.value)} className="w-28 font-mono uppercase" />
            </div>
          </div>
          <div className="flex gap-1.5">
            {SWATCHES.map((c) => (
              <button key={c} type="button" title={c} onClick={() => setColor(c)} className={cx('h-8 w-8 rounded-full border-2', color.toUpperCase() === c ? 'border-blue-600' : 'border-slate-200')} style={{ background: c }} />
            ))}
          </div>
          <Button size="sm" loading={busy === 'color'} disabled={color.toUpperCase() === D.color.toUpperCase()} onClick={() => put({ color }, 'Band colour saved', 'color')}>
            Save colour
          </Button>
        </div>
        {slot('header', 'Top band', 'Your logo on the left, your address on the right.')}
        {slot('footer', 'Bottom band', 'Your phone number and website.')}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-heading text-lg font-bold text-slate-900">Photos already in your inventory</h2>
        {data.pending ? (
          <>
            <p className="mt-1 text-sm text-slate-500">
              <b>
                {data.pending} photo{data.pending === 1 ? '' : 's'}
              </b>{' '}
              still need updating: main photos without your current bands, or older photos that are no longer the main photo. Each one is saved as a copy on your website.
            </p>
            <Button
              className="mt-3"
              disabled={!data.enabled}
              loading={busy === 'apply'}
              onClick={() => {
                setBusy('apply');
                void brandRun(() => setBusy(''));
              }}
            >
              <ImageIcon className="h-4 w-4" /> Update {data.pending} photo{data.pending === 1 ? '' : 's'} now
            </Button>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-500">✓ Every main photo in your inventory has your current bands.</p>
        )}
        {data.failed > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {data.failed} photo link{data.failed === 1 ? '' : 's'} could not be branded.{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={async () => {
                setData(await api('/dealer/branding/retry-failed', { method: 'POST' }));
              }}
            >
              Try them again
            </button>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
              {data.failedList.map((x) => (
                <li key={x.url}>
                  <span className="font-mono">{x.url.length > 70 ? `${x.url.slice(0, 67)}…` : x.url}</span>: {x.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-heading text-lg font-bold text-slate-900">How the main photo will look</h2>
        <div className="mx-auto max-w-xl overflow-hidden rounded-lg border border-slate-200">
          {bands.header && <img src={bands.header} alt="" className="block w-full" />}
          <div className="flex aspect-[1448/807] flex-col items-center justify-center gap-2 bg-slate-200 text-slate-500">
            <Car className="h-10 w-10" />
            <span className="text-sm font-semibold">Your vehicle photo</span>
          </div>
          {bands.footer && <img src={bands.footer} alt="" className="block w-full" />}
        </div>
      </section>
    </div>
  );
}
