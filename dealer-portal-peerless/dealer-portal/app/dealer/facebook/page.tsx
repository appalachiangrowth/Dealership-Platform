'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Car, CheckCircle2, Film, Hash, Info, Layers, Loader2, Pencil, Play, RefreshCw, Square, Star, Store, Trash2, Upload, XCircle } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { FacebookIcon, fb, useFb, type FbItem } from '@/lib/facebook';
import { cx } from '@/components/ui';
import { useToast } from '@/components/toast';
import { announceFbActivity } from '@/components/fb/FbActivityBar';

type MpVehicle = { id: string; title: string; status: string; stock: string; price?: number | null; photos: number; missing: string[]; listing: { status: string } };
type Media = { key: string; kind: 'file' | 'vehicle'; file?: File; url: string; preview: string; video: boolean };

const EMOJI = ['🚗', '🔥', '✅', '💯', '📞', '📍', '💰', '⭐', '👉', '🎉', '⚡', '🛞'];
const CHOICE_KEY = 'fb_post_choice';
const FB_LINK = /^https:\/\/(www\.|m\.|web\.)?facebook\.com\/.+/i;

/* look of the new design */
const CARD = 'rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
const HD = 'flex flex-wrap items-center gap-3 border-b border-[#E5E9F0] px-5 py-4';
const ICO = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#EAF1FF] text-[#1D4ED8]';
const FLD = 'flex min-h-[42px] items-stretch overflow-hidden rounded-lg border border-[#CBD5E1] bg-white focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]';
const CTRL = 'min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-[#0F172A] outline-none placeholder:text-[#7A8599]';
const LBL = 'text-[13px] font-semibold text-[#1E293B]';
const BTN_S =
  'inline-flex min-h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#CBD5E1] bg-white px-3.5 text-sm font-semibold text-[#0F172A] transition hover:bg-[#F8FAFC] disabled:opacity-60';

function Tip({ text, label }: { text: string; label: string }) {
  return (
    <span className="group relative inline-flex align-middle" onClick={(e) => e.preventDefault()}>
      <button type="button" aria-label={`What is ${label}?`} className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[#64748B] outline-none hover:bg-[#EAF1FF] hover:text-[#1D4ED8] focus-visible:bg-[#EAF1FF]">
        <Info className="h-[15px] w-[15px]" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] left-[-10px] z-40 hidden w-[260px] rounded-lg bg-[#0F172A] px-3 py-2.5 text-[12.5px] font-normal normal-case leading-normal tracking-normal text-[#F1F5F9] shadow-[0_8px_24px_rgba(15,23,42,0.25)] group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}

/** FB Poster › Create a post: your Facebook Pages and/or Marketplace — one button. */
export default function FbPostPage() {
  const { state, refresh } = useFb();
  const toast = useToast();
  const account = state?.account;
  const vehicles = useApi<{ vehicles: MpVehicle[] }>('/dealer/facebook/mp/vehicles');

  const [loading, setLoading] = useState('');
  const [toMp, setToMp] = useState(true);
  const [media, setMedia] = useState<Media[]>([]);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('carsforsale usedcars cardealer');
  const [vehicleId, setVehicleId] = useState('');
  const [selPages, setSelPages] = useState<Set<string>>(new Set());
  const [pageLink, setPageLink] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [mpCopy, setMpCopy] = useState('');
  const [showMpCopy, setShowMpCopy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const job = state?.job;
  const running = job?.status === 'running';
  const mpBusy = !!state?.mp && (!!state.mp.active || state.mp.queue.length > 0);
  const vehicle = (vehicles.data?.vehicles || []).find((v) => v.id === vehicleId) || null;
  const mpReady = !!vehicle && !vehicle.missing?.length;
  const pages: FbItem[] = account?.pages || [];
  const pageList = pages.filter((p) => selPages.has(p.url));
  const count = pageList.length + (toMp ? 1 : 0);
  const connected = !!(state?.loggedIn || account?.fbUserId);

  // the last choice (same as the popup in Inventory)
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(CHOICE_KEY) || 'null');
      if (c) {
        setToMp(c.mp !== false);
        if (Array.isArray(c.pages)) setSelPages(new Set(c.pages));
        if (c.hashtags) setHashtags(c.hashtags);
      }
    } catch {}
  }, []);

  const run = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setLoading(what);
    try {
      await fn();
      if (ok) toast.ok(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading('');
    }
  };

  const togglePage = (url: string) =>
    setSelPages((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  // ---- media ----
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: Media[] = [];
    for (const f of Array.from(list)) {
      if (!/^(image|video)\//.test(f.type)) continue;
      next.push({ key: `f${Date.now()}${Math.random()}`, kind: 'file', file: f, url: '', preview: URL.createObjectURL(f), video: f.type.startsWith('video/') });
    }
    setMedia((m) => [...m, ...next].slice(0, 20));
  };
  const move = (i: number, d: number) =>
    setMedia((m) => {
      const n = [...m];
      const j = i + d;
      if (j < 0 || j >= n.length) return m;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const feature = (i: number) => setMedia((m) => [m[i], ...m.filter((_, k) => k !== i)]);
  const removeMedia = (i: number) =>
    setMedia((m) => {
      const x = m[i];
      if (x.kind === 'file') URL.revokeObjectURL(x.preview);
      return m.filter((_, k) => k !== i);
    });

  const fromVehicle = (id: string) =>
    run('vehicle', async () => {
      setVehicleId(id);
      setMpCopy('');
      if (!id) {
        setMedia((m) => m.filter((x) => x.kind === 'file'));
        return;
      }
      void fb
        .get<{ text: string }>(`mp/vehicles/${id}/preview`)
        .then((p) => p?.text && setMpCopy(p.text.trim()))
        .catch(() => {});
      const r = await fb.post<{ copy: { hashtags: string }; text: string; photos: string[] }>(`mp/vehicles/${id}/generate`, { ai: false, save: false });
      setCaption(r.text.replace(r.copy.hashtags, '').replace(/\n{3,}/g, '\n\n').trim());
      if (r.copy.hashtags) setHashtags(r.copy.hashtags);
      setMpCopy((cur) => cur || r.text.trim());
      setMedia((m) => [
        ...r.photos.slice(0, 10).map((u, i) => ({ key: `v${i}${u}`, kind: 'vehicle' as const, url: u, preview: mediaUrl(u), video: false })),
        ...m.filter((x) => x.kind === 'file'),
      ].slice(0, 20));
    });

  const addEmoji = (e: string) => {
    const el = captionRef.current;
    if (!el) return setCaption((c) => c + e);
    const a = el.selectionStart ?? caption.length;
    const b = el.selectionEnd ?? caption.length;
    setCaption(caption.slice(0, a) + e + caption.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = a + e.length;
    });
  };

  /** the one button: your Pages and/or Marketplace */
  const postNow = () =>
    run('post', async () => {
      if (!count) throw new Error('Tick a Page and/or "Facebook Marketplace".');
      if (toMp && !vehicle) throw new Error('Choose the vehicle to list on Marketplace (step 1).');
      if (toMp && vehicle && !mpReady) throw new Error(`Marketplace needs: ${vehicle.missing.join(', ')}. Fill these in on the vehicle first.`);
      if (pageList.length && !caption.trim() && !hashtags.trim() && !media.length) throw new Error('Add a photo/video or write the post text.');
      try {
        localStorage.setItem(CHOICE_KEY, JSON.stringify({ profile: false, mp: toMp, pages: [...selPages], hashtags }));
      } catch {}
      const done: string[] = [];
      const errors: string[] = [];
      if (pageList.length) {
        try {
          const form = new FormData();
          const order: string[] = [];
          let n = 0;
          for (const m of media) {
            if (m.kind === 'file' && m.file) {
              form.append('media', m.file);
              order.push(`f:${n++}`);
            } else order.push(`v:${m.url}`);
          }
          form.append('profile', '0');
          form.append('pages', JSON.stringify(pageList));
          form.append('order', JSON.stringify(order));
          form.append('caption', caption);
          form.append('hashtags', hashtags);
          await api('/dealer/facebook/post', { method: 'POST', form });
          done.push(`${pageList.length} Page${pageList.length === 1 ? '' : 's'}`);
        } catch (e) {
          errors.push(`Page post: ${(e as Error).message}`);
        }
      }
      if (toMp && vehicle && mpReady) {
        try {
          const r = await fb.post<{ queued: number; rejected: { id: string; error: string }[] }>('mp/publish', { ids: [vehicle.id] });
          if (r.queued) done.push('Marketplace');
          else errors.push(`Marketplace: ${r.rejected?.[0]?.error || 'could not be queued'}`);
        } catch (e) {
          errors.push(`Marketplace: ${(e as Error).message}`);
        }
      }
      if (done.length) {
        announceFbActivity();
        toast.ok(`Posting to ${done.join(' and ')} started. Follow it on the Posting history tab — you can leave this page.`);
      }
      if (errors.length) throw new Error(errors.join(' · '));
    });

  const stop = () =>
    run(
      'stop',
      async () => {
        await Promise.all([fb.post('stop').catch(() => {}), fb.post('mp/stop').catch(() => {})]);
      },
      'Stopped.',
    );

  const where = [pageList.length === 1 ? pageList[0].name || 'your Page' : pageList.length > 1 && `${pageList.length} Pages`, toMp && 'Marketplace'].filter(Boolean) as string[];
  const cantPost = !count || !connected || (pageList.length > 0 && !toMp && !caption.trim() && !hashtags.trim() && !media.length);

  return (
    <div className="flex flex-col gap-5">
      {!connected && state && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-[#DBE7FE] bg-[#EFF6FF] px-3.5 py-3 text-[13px] text-[#1E3A8A]">
          <Info className="mt-px h-[18px] w-[18px] shrink-0" />
          <span>
            <b>Step 1:</b> click <b>Connect Facebook</b> above and log in once. <b>Step 2:</b> choose a vehicle, tick your Pages and/or Marketplace, then press <b>Start posting</b>.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-5">
        {/* ============ left: the post ============ */}
        <section aria-labelledby="cp-h" className={cx(CARD, 'min-w-0 flex-[1.3_1_460px]')}>
          <div className={HD}>
            <span className={ICO}>
              <Pencil className="h-[18px] w-[18px]" />
            </span>
            <div className="flex flex-1 flex-col">
              <h2 id="cp-h" className="m-0 text-base font-bold text-[#0F172A]">
                Create a post
              </h2>
              <span className="text-[13px] text-[#526077]">Pick a vehicle to fill everything in for you, or write your own.</span>
            </div>
          </div>
          <div className="flex flex-col gap-5 p-5">
            {/* 1. vehicle */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-0.5">
                <label htmlFor="fb-veh" className={LBL}>
                  1. Vehicle
                </label>
                <Tip
                  label="Vehicle"
                  text="Choose a vehicle from your inventory and we fill in its photos, price and description. You can still change anything before posting. Marketplace always needs a vehicle."
                />
                <span className="ml-1.5 text-xs text-[#526077]">{toMp ? 'Needed for Marketplace' : 'Optional'}</span>
                {loading === 'vehicle' && <Loader2 className="ml-auto h-4 w-4 animate-spin text-[#526077]" />}
              </div>
              <div className={FLD}>
                <span className="flex items-center pl-3 text-[#64748B]">
                  <Car className="h-4 w-4" />
                </span>
                <select id="fb-veh" value={vehicleId} onChange={(e) => fromVehicle(e.target.value)} className={cx(CTRL, 'cursor-pointer')}>
                  <option value="">Choose a vehicle…</option>
                  {(vehicles.data?.vehicles || [])
                    .filter((v) => v.status !== 'DRAFT')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                        {v.stock ? ` · #${v.stock}` : ''}
                        {v.status === 'SOLD' ? ' (sold)' : ''}
                        {!v.missing?.length ? ' · Marketplace ready' : ''}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* 2. photos */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-0.5">
                <span className={LBL}>2. Photos &amp; videos</span>
                <Tip label="Photos and videos" text="Up to 20 files: JPG, PNG or MP4. The first one is shown largest on Facebook, so start with your best outside shot. Used for the Page posts; Marketplace uses the vehicle’s own photos." />
                <span className="ml-auto text-xs font-semibold text-[#526077]">{media.length} of 20</span>
              </div>
              {!!media.length && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {media.map((m, i) => (
                    <div key={m.key} className={cx('group relative overflow-hidden rounded-lg border bg-[#E2E8F0]', i === 0 ? 'border-[#2563EB] ring-2 ring-[#2563EB]/30' : 'border-[#E5E9F0]')}>
                      {m.video ? (
                        <div className="flex aspect-[4/3] items-center justify-center text-[#64748B]">
                          <Film className="h-6 w-6" />
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.preview} alt="" className="aspect-[4/3] w-full object-cover" />
                      )}
                      {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-[#0F172A] px-2 py-0.5 text-[10px] font-bold text-white">Cover</span>}
                      <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
                        <button title="Move left" onClick={() => move(i, -1)} className="text-white">
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </button>
                        <button title="Show first" onClick={() => feature(i)} className={i === 0 ? 'text-amber-300' : 'text-white'}>
                          <Star className="h-3.5 w-3.5" />
                        </button>
                        <button title="Remove" onClick={() => removeMedia(i)} className="text-white">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button title="Move right" onClick={() => move(i, 1)} className="text-white">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(e.dataTransfer.files);
                }}
                className="flex flex-wrap items-center justify-center gap-3 rounded-xl border-[1.5px] border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-[18px] text-center"
              >
                <Upload className="h-[22px] w-[22px] text-[#1D4ED8]" />
                <span className="text-sm font-semibold">Drag files here, or</span>
                <button type="button" className={BTN_S} onClick={() => fileInput.current?.click()}>
                  Choose files
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            {/* 3. text */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-0.5">
                <label htmlFor="fb-txt" className={LBL}>
                  3. Post text
                </label>
                <Tip label="Post text" text="What people read with your photos on your Page. Mention the price, mileage and how to contact you. Short, friendly posts get the most replies." />
                <span className="ml-auto text-xs text-[#526077]">{caption.length} characters</span>
              </div>
              <div className={FLD}>
                <textarea
                  id="fb-txt"
                  ref={captionRef}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={7}
                  placeholder="e.g. 2021 Toyota Corolla LE, one owner, 42,000 miles. $17,900. Message us to book a test drive."
                  className={cx(CTRL, 'min-h-[150px] resize-y py-2.5 leading-normal')}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {EMOJI.map((e) => (
                  <button key={e} type="button" onClick={() => addEmoji(e)} className="rounded-md px-1.5 py-0.5 text-lg hover:bg-[#F1F5F9]">
                    {e}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-0.5">
                <label htmlFor="fb-tags" className={LBL}>
                  Hashtags
                </label>
                <Tip label="Hashtags" text="Words starting with # that help people find your post. Separate them with spaces or commas; we add the # for you." />
              </div>
              <div className={FLD}>
                <span className="flex items-center pl-3 text-[#64748B]">
                  <Hash className="h-4 w-4" />
                </span>
                <input id="fb-tags" type="text" value={hashtags} onChange={(e) => setHashtags(e.target.value)} className={CTRL} />
              </div>
            </div>
          </div>
        </section>

        {/* ============ right: where ============ */}
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-5">
          <section aria-labelledby="wh-h" className={CARD}>
            <div className={HD}>
              <span className={ICO}>
                <Layers className="h-[18px] w-[18px]" />
              </span>
              <div className="flex flex-1 flex-col">
                <h2 id="wh-h" className="m-0 text-base font-bold text-[#0F172A]">
                  Where to post
                </h2>
                <span className="text-[13px] text-[#526077]">Choose your Pages and Marketplace.</span>
              </div>
            </div>
            <div className="flex flex-col gap-4 px-5 py-[18px]">
              {/* Pages */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className={cx(LBL, 'flex-1')}>
                    Your Pages <span className="font-medium text-[#526077]">({pageList.length} of {pages.length} selected)</span>
                  </span>
                  <button
                    type="button"
                    disabled={!connected || loading === 'pages'}
                    onClick={() => run('pages', () => fb.post('pages/load'))}
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#1D4ED8] hover:underline disabled:opacity-50"
                  >
                    {loading === 'pages' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh list
                  </button>
                  <Tip label="Refresh list" text="Reloads your Pages from Facebook. Use this after you create or get access to a new Page." />
                </div>
                {pages.length ? (
                  pages.map((p) => (
                    <label key={p.url} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-[#F8FAFC]" title={p.url}>
                      <input type="checkbox" className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#2563EB]" checked={selPages.has(p.url)} onChange={() => togglePage(p.url)} />
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#EAF1FF] text-[#1877F2]">
                        <FacebookIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{p.name || p.url}</span>
                    </label>
                  ))
                ) : (
                  <p className="m-0 rounded-lg bg-[#F8FAFC] px-3 py-2.5 text-[13px] text-[#526077]">
                    {loading === 'pages' ? 'Reading your Pages from Facebook…' : 'No Pages loaded yet. Press “Refresh list” (takes a few seconds), or add a Page link.'}
                  </p>
                )}
                {addOpen ? (
                  <div className="mt-1 flex gap-2">
                    <div className={cx(FLD, 'min-h-[38px] flex-1')}>
                      <input value={pageLink} onChange={(e) => setPageLink(e.target.value)} placeholder="https://www.facebook.com/YourPage" className={cx(CTRL, 'text-[13px]')} />
                    </div>
                    <button
                      type="button"
                      className={BTN_S}
                      disabled={!FB_LINK.test(pageLink.trim())}
                      onClick={() =>
                        run('pages', async () => {
                          const url = pageLink.trim();
                          if (!pages.some((p) => p.url === url)) await fb.put('targets', { pages: [...pages, { name: url.replace(/^https:\/\/(www\.)?facebook\.com\//, '').replace(/\/$/, ''), url }] });
                          setSelPages((s) => new Set(s).add(url));
                          setPageLink('');
                          setAddOpen(false);
                        })
                      }
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddOpen(true)} className="self-start py-1.5 text-[13px] font-semibold text-[#1D4ED8] hover:underline">
                    + Add a Page by its link
                  </button>
                )}
              </div>

              {/* Marketplace */}
              <label
                className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition',
                  toMp ? (vehicle && !mpReady ? 'border-[#FCD34D] bg-[#FFFBEB]' : 'border-[#93B4F5] bg-[#F5F8FF]') : 'border-[#E5E9F0] bg-white hover:bg-[#F8FAFC]',
                )}
              >
                <input type="checkbox" className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#2563EB]" checked={toMp} onChange={(e) => setToMp(e.target.checked)} />
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#E8F7EE] text-[#15803D]">
                  <Store className="h-[18px] w-[18px]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">Facebook Marketplace</span>
                    {vehicle &&
                      (mpReady ? (
                        <span className="rounded-full bg-[#E8F7EE] px-2.5 py-[3px] text-xs font-semibold text-[#15803D]">✓ Ready</span>
                      ) : (
                        <span className="rounded-full bg-[#FEF3C7] px-2.5 py-[3px] text-xs font-semibold text-[#92400E]">Not ready</span>
                      ))}
                  </span>
                  <span className="text-[13px] text-[#526077]">
                    {!vehicle
                      ? 'Choose the vehicle in step 1: it is listed with its own photos and details.'
                      : mpReady
                        ? 'Every detail Marketplace needs is filled in. It is listed automatically.'
                        : `Still needed: ${vehicle.missing.join(', ')}.`}
                  </span>
                  {vehicle && !mpReady && (
                    <Link href={`/dealer/inventory/${vehicle.id}`} className="text-[13px] font-semibold text-[#1D4ED8] hover:underline" onClick={(e) => e.stopPropagation()}>
                      Fill them in on the vehicle →
                    </Link>
                  )}
                </span>
                <Tip label="Facebook Marketplace" text="Marketplace is Facebook’s buy-and-sell area. Your listing shows to local buyers searching for vehicles, with price, mileage and photos taken from your inventory." />
              </label>

              {toMp && vehicle && (
                <div className="rounded-[10px] border border-[#BBE5CB] bg-[#F3FBF6] px-3.5 py-2.5 text-[13px]">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 shrink-0 text-[#15803D]" />
                    <span className="flex-1 text-[#14532D]">Marketplace listing text (description and hashtags)</span>
                    <button type="button" className="font-semibold text-[#1D4ED8] hover:underline" onClick={() => setShowMpCopy(!showMpCopy)}>
                      {showMpCopy ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showMpCopy && (
                    <>
                      <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-2.5 font-mono text-[11px] leading-relaxed text-[#334155]">{mpCopy || 'Loading…'}</div>
                      <p className="mb-0 mt-1 text-[11px] text-[#526077]">Change it on the Marketplace tab.</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2.5 rounded-b-[14px] border-t border-[#E5E9F0] bg-[#F8FAFC] px-5 py-4">
              <span className="text-[13px] text-[#334155]">
                {running || mpBusy
                  ? 'Posting now — follow every step on the Posting history tab. You can leave this page while it runs.'
                  : count
                    ? `Posts to ${where.join(', then ')}${pageList.length > 1 ? ', with a short pause between Pages' : ''}. You can leave this page while it runs.`
                    : 'Choose your Pages and/or Marketplace.'}
              </span>
              {running || mpBusy ? (
                <div className="flex gap-2">
                  <Link href="/dealer/facebook/history" className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-[18px] text-[15px] font-semibold text-white hover:bg-[#1D4ED8]">
                    <Loader2 className="h-4 w-4 animate-spin" /> Posting… see progress
                  </Link>
                  <button type="button" onClick={stop} disabled={loading === 'stop'} className="inline-flex min-h-[46px] items-center gap-2 rounded-lg border border-[#FECACA] bg-white px-4 text-sm font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]">
                    <Square className="h-4 w-4" /> Stop
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={cantPost || loading === 'post'}
                  onClick={postNow}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#2563EB] px-[18px] text-[15px] font-semibold text-white transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#C7D2E3] disabled:text-[#334155]"
                >
                  {loading === 'post' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start posting
                </button>
              )}
              {cantPost && !running && !mpBusy && (
                <span className="text-center text-xs text-[#526077]">
                  {!connected ? 'Connect Facebook above first.' : !count ? 'Tick a Page or Marketplace to start.' : 'Add some text or choose a vehicle to start.'}
                </span>
              )}
            </div>
          </section>

          {/* the last run, short */}
          {job && (
            <div className={cx(CARD, 'flex items-center gap-3 px-5 py-4')}>
              {running ? (
                <Loader2 className="h-5 w-5 animate-spin text-[#1877F2]" />
              ) : job.failed ? (
                <XCircle className="h-5 w-5 text-[#B91C1C]" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-[#15803D]" />
              )}
              <span className="flex-1 text-sm">
                <b>{running ? 'Posting now' : 'Last post'}</b> · {job.results.filter((r) => r.status === 'done').length} of {job.total} posted
                {job.failed ? ` · ${job.failed} failed` : ''}
              </span>
              <Link href="/dealer/facebook/history" className="text-[13px] font-semibold text-[#1D4ED8] hover:underline">
                Details →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
