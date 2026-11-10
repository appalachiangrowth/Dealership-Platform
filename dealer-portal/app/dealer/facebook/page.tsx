'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, Film, Loader2, Play, Square, Star, Store, Trash2, Upload, User, XCircle } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { fb, useFb, type FbResult } from '@/lib/facebook';
import { Badge, Button, Card, Field, Input, Select, Textarea, cx } from '@/components/ui';
import { useToast } from '@/components/toast';
import { FbActivity } from '@/components/fb/FbChrome';
import { announceFbActivity } from '@/components/fb/FbActivityBar';

type Run = { id: string; caption: string; media: number; ok: number; failed: number; cancelled: boolean; startedAt: string; finishedAt: string | null; results: FbResult[] };
type MpVehicle = { id: string; title: string; status: string; stock: string; photos: number; missing: string[]; listing: { status: string } };
type Media = { key: string; kind: 'file' | 'vehicle'; file?: File; url: string; preview: string; video: boolean };

const EMOJI = ['🚗', '🔥', '✅', '💯', '📞', '📍', '💰', '⭐', '👉', '🎉', '⚡', '🛞'];
const CHOICE_KEY = 'fb_post_choice';

const RESULT: Record<string, { color: string; text: string }> = {
  waiting: { color: 'slate', text: 'Waiting' },
  running: { color: 'blue', text: 'Posting…' },
  retry: { color: 'amber', text: 'Trying again' },
  done: { color: 'green', text: 'Posted' },
  failed: { color: 'red', text: 'Failed' },
  skipped: { color: 'amber', text: 'Skipped' },
  cancelled: { color: 'slate', text: 'Stopped' },
  'not posted': { color: 'slate', text: 'Not posted' },
};

/** FB Poster › Post: your own Facebook profile and/or Marketplace — one button. */
export default function FbPostPage() {
  const { state, refresh } = useFb();
  const toast = useToast();
  const account = state?.account;
  const history = useApi<{ runs: Run[] }>('/dealer/facebook/history');
  const vehicles = useApi<{ vehicles: MpVehicle[] }>('/dealer/facebook/mp/vehicles');

  const [loading, setLoading] = useState('');
  const [toProfile, setToProfile] = useState(true);
  const [toMp, setToMp] = useState(true);
  const [media, setMedia] = useState<Media[]>([]);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [mpSent, setMpSent] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const job = state?.job;
  const running = job?.status === 'running';
  const vehicle = (vehicles.data?.vehicles || []).find((v) => v.id === vehicleId) || null;
  const mpReady = !!vehicle && !vehicle.missing?.length;
  const wantMp = toMp && mpReady;
  const count = (toProfile ? 1 : 0) + (wantMp ? 1 : 0);

  // the last choice of the two ticks (same as the popup in Inventory)
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(CHOICE_KEY) || 'null');
      if (c) {
        setToProfile(c.profile !== false);
        setToMp(c.mp !== false);
        if (c.hashtags) setHashtags(c.hashtags);
      }
    } catch {}
  }, []);

  // a finished run shows up in the history
  const lastStatus = useRef(job?.status);
  useEffect(() => {
    if (lastStatus.current === 'running' && job?.status === 'finished') void history.reload();
    lastStatus.current = job?.status;
  }, [job?.status, history]);

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
      setMpSent('');
      if (!id) return;
      const r = await fb.post<{ copy: { hashtags: string }; text: string; photos: string[] }>(`mp/vehicles/${id}/generate`, { ai: false, save: false });
      setCaption(r.text.replace(r.copy.hashtags, '').replace(/\n{3,}/g, '\n\n').trim());
      setHashtags(r.copy.hashtags);
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

  /** the one button: profile and/or Marketplace */
  const postNow = () =>
    run('post', async () => {
      if (!count) throw new Error('Tick "My Facebook profile" and/or "Facebook Marketplace".');
      if (toProfile && !caption.trim() && !hashtags.trim() && !media.length) throw new Error('Add a photo/video or write a description.');
      try {
        localStorage.setItem(CHOICE_KEY, JSON.stringify({ profile: toProfile, mp: toMp, hashtags }));
      } catch {}
      const done: string[] = [];
      const errors: string[] = [];
      if (toProfile) {
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
          form.append('order', JSON.stringify(order));
          form.append('caption', caption);
          form.append('hashtags', hashtags);
          await api('/dealer/facebook/post', { method: 'POST', form });
          done.push('your profile');
        } catch (e) {
          errors.push(`Profile: ${(e as Error).message}`);
        }
      }
      if (wantMp && vehicle) {
        try {
          const r = await fb.post<{ queued: number; rejected: { id: string; error: string }[] }>('mp/publish', { ids: [vehicle.id] });
          if (r.queued) {
            done.push('Marketplace');
            setMpSent(vehicle.id);
          } else errors.push(`Marketplace: ${r.rejected?.[0]?.error || 'could not be queued'}`);
        } catch (e) {
          errors.push(`Marketplace: ${(e as Error).message}`);
        }
      }
      if (done.length) {
        announceFbActivity();
        toast.ok(`Posting to ${done.join(' and ')} started. You can leave this page; it carries on.`);
      }
      if (errors.length) throw new Error(errors.join(' · '));
    });

  const stop = () =>
    run('stop', async () => {
      await Promise.all([fb.post('stop').catch(() => {}), fb.post('mp/stop').catch(() => {})]);
    }, 'Stopped.');

  const connected = !!(state?.loggedIn || account?.fbUserId);
  const mpBusy = !!state?.mp && (!!state.mp.active || state.mp.queue.length > 0);

  return (
    <div className="space-y-6">
      {!connected && state && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
          <b>Step 1:</b> click <b>Connect Facebook</b> above and log in once. <b>Step 2:</b> choose a vehicle (or add photos), tick where to post and press <b>Post</b>.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        {/* ---------------- where to post ---------------- */}
        <div className="space-y-6">
          <Card title="Where to post">
            <div className="space-y-2.5 text-sm">
              <label className={cx('flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition', toProfile ? 'border-[#1877F2] bg-blue-50/50' : 'border-slate-200')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1877F2]" checked={toProfile} onChange={(e) => setToProfile(e.target.checked)} />
                <User className="mt-0.5 h-4 w-4 shrink-0 text-[#1877F2]" />
                <span className="min-w-0 flex-1">
                  <b className="block text-slate-900">My Facebook profile</b>
                  <span className="text-xs text-slate-500">
                    A normal post on {account?.fbName ? <b className="text-slate-700">{account.fbName}</b> : 'your profile'} with the photos and text on the right.
                  </span>
                </span>
              </label>

              <label
                className={cx(
                  'flex items-start gap-3 rounded-xl border px-3.5 py-3 transition',
                  mpReady ? 'cursor-pointer' : 'cursor-not-allowed bg-slate-50',
                  wantMp ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-200',
                )}
              >
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" disabled={!mpReady} checked={wantMp} onChange={(e) => setToMp(e.target.checked)} />
                <Store className={cx('mt-0.5 h-4 w-4 shrink-0', mpReady ? 'text-emerald-700' : 'text-slate-400')} />
                <span className="min-w-0 flex-1">
                  <b className="block text-slate-900">Facebook Marketplace</b>
                  <span className="text-xs text-slate-500">
                    {!vehicle
                      ? 'Choose a vehicle on the right: it is listed with its own photos and details.'
                      : mpReady
                        ? 'This vehicle is Marketplace ready: it is listed automatically with its own photos and details.'
                        : `Not ready — missing: ${vehicle.missing.join(', ')}. Fill these in on the vehicle first.`}
                  </span>
                </span>
              </label>
            </div>
          </Card>

          {job && (
            <Card
              title={running ? 'Posting on your profile…' : job.ok ? 'Last post: on your profile' : job.cancelled ? 'Last post: stopped' : 'Last post: not posted'}
              pad={false}
            >
              <ResultList results={job.results} />
            </Card>
          )}
          {(mpBusy || mpSent) && (
            <Card title="Marketplace">
              <p className="flex items-center gap-2 text-sm text-slate-600">
                {mpBusy ? <Loader2 className="h-4 w-4 animate-spin text-[#1877F2]" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                {mpBusy ? 'Filling in the Marketplace listing…' : 'Marketplace task finished.'} Follow every listing on the <b>Marketplace</b> tab.
              </p>
            </Card>
          )}
        </div>

        {/* ---------------- the post ---------------- */}
        <Card title="Your post">
          <div className="space-y-4">
            <Field label="Vehicle" hint="Fills in the text and the photos from your inventory. Needed for Marketplace. You can still change the profile post.">
              <div className="flex items-center gap-2">
                <Select value={vehicleId} onChange={(e) => fromVehicle(e.target.value)}>
                  <option value="">— choose a vehicle —</option>
                  {(vehicles.data?.vehicles || [])
                    .filter((v) => v.status !== 'DRAFT')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                        {v.stock ? ` · #${v.stock}` : ''}
                        {v.status === 'SOLD' ? ' (sold)' : ''}
                        {!v.missing?.length ? ' · MP ready' : ''}
                      </option>
                    ))}
                </Select>
                {loading === 'vehicle' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </div>
            </Field>

            {toProfile && (
              <>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Photos & videos ({media.length}/20)</span>
                    <span className="text-xs text-slate-400">★ = shown first</span>
                  </div>
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      addFiles(e.dataTransfer.files);
                    }}
                    className="rounded-xl border-2 border-dashed border-slate-300 p-3"
                  >
                    {!!media.length && (
                      <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {media.map((m, i) => (
                          <div key={m.key} className={cx('group relative overflow-hidden rounded-lg border bg-slate-100', i === 0 ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200')}>
                            {m.video ? (
                              <div className="flex aspect-square items-center justify-center text-slate-500">
                                <Film className="h-6 w-6" />
                              </div>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.preview} alt="" className="aspect-square w-full object-cover" />
                            )}
                            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 px-1 py-0.5 opacity-0 transition group-hover:opacity-100">
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
                    <button onClick={() => fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
                      <Upload className="h-4 w-4" /> Drop photos / videos here or click to choose
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

                <Field label="Description">
                  <Textarea ref={captionRef} value={caption} onChange={(e) => setCaption(e.target.value)} rows={8} placeholder="Write your post text…" />
                </Field>
                <div className="-mt-2 flex flex-wrap gap-1">
                  {EMOJI.map((e) => (
                    <button key={e} onClick={() => addEmoji(e)} className="rounded-md px-1.5 py-0.5 text-lg hover:bg-slate-100">
                      {e}
                    </button>
                  ))}
                </div>
                <Field label="Hashtags" hint="Separate with spaces or commas; # is added for you.">
                  <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#carsforsale #usedcars" />
                </Field>
              </>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              {running || mpBusy ? (
                <Button variant="danger" loading={loading === 'stop'} onClick={stop}>
                  <Square className="h-4 w-4" /> Stop
                </Button>
              ) : (
                <Button
                  className="border-transparent bg-[#1877F2] font-bold text-white hover:bg-[#166fe5]"
                  loading={loading === 'post'}
                  disabled={!count || !connected}
                  onClick={postNow}
                >
                  <Play className="h-4 w-4" />
                  {toProfile && wantMp ? 'Post to profile + Marketplace' : wantMp ? 'Post to Marketplace' : 'Post to profile'}
                </Button>
              )}
              <span className="text-sm text-slate-500">
                {!count ? 'Nothing ticked yet' : toProfile && wantMp ? 'Profile first, then the Marketplace listing' : ''}
                {state?.busy && !running && !mpBusy ? ` · busy: ${state.busyWhat}` : ''}
              </span>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FbActivity />
        <Card title="Recent profile posts" pad={false}>
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {!history.data?.runs.length && <div className="px-5 py-8 text-center text-sm text-slate-400">No posts yet.</div>}
            {history.data?.runs.map((r) => (
              <details key={r.id} className="px-5 py-2.5 text-sm">
                <summary className="flex cursor-pointer items-center gap-3">
                  <span className="text-xs text-slate-400">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className="min-w-0 flex-1 truncate">{r.caption.split('\n')[0] || `${r.media} photo(s)`}</span>
                  {r.finishedAt ? (
                    <>
                      {!!r.ok && <Badge color="green">posted</Badge>}
                      {!!r.failed && <Badge color="red">failed</Badge>}
                      {r.cancelled && <Badge>stopped</Badge>}
                    </>
                  ) : (
                    <Badge color="blue">running</Badge>
                  )}
                </summary>
                <ResultList results={r.results} compact />
              </details>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ResultList({ results, compact }: { results: FbResult[]; compact?: boolean }) {
  return (
    <ul className={cx('divide-y divide-slate-100', compact && 'mt-2 rounded-lg border border-slate-100')}>
      {results.map((r, i) => {
        const s = RESULT[r.status] || { color: 'slate', text: r.status };
        const Icon = r.status === 'done' ? CheckCircle2 : r.status === 'failed' ? XCircle : r.status === 'running' ? Loader2 : Clock;
        return (
          <li key={r.url + i} className="flex items-start gap-3 px-5 py-2 text-sm">
            <Icon className={cx('mt-0.5 h-4 w-4 shrink-0', r.status === 'done' ? 'text-emerald-600' : r.status === 'failed' ? 'text-red-600' : 'text-slate-400', r.status === 'running' && 'animate-spin')} />
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-800">{/facebook\.com\/me\/?$/.test(r.url) ? r.name || 'Your Facebook profile' : r.name || r.url}</span>
              {(r.error || (r.note && r.note !== 'posted')) && <div className={cx('text-xs', r.error ? 'text-red-600' : 'text-slate-500')}>{r.error || r.note}</div>}
            </div>
            <Badge color={s.color}>{s.text}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
