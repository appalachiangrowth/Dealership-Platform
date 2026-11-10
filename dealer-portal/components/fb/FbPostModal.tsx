'use client';

/**
 * "Post to Facebook" popup for one vehicle — used by the Inventory table (FB button) and the vehicle editor
 * (right after "Publish vehicle").
 *  · two ticks: "Post on my Facebook profile" and "List on Facebook Marketplace" (when every Marketplace field is filled in)
 *  · ONE button posts to whatever is ticked (both = both)
 *  · after "Post", the popup stays open and shows the live progress at the top (also shown in the bar on every page)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, ImageIcon, Loader2, Store, User, XCircle } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Modal, cx } from '@/components/ui';
import { money, vehicleName } from '@/lib/format';
import { FacebookIcon, fb, type FbJob } from '@/lib/facebook';
import { mpMissing, MP_FIX } from '@/lib/marketplace';
import { announceFbActivity } from './FbActivityBar';

type LiveState = {
  job: FbJob | null;
  mp: { active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[]; running: boolean };
};
type MpListing = { status: string; url: string; error: string };
/** saved Facebook login on the server (Chrome may be asleep; it starts by itself with this login) */
type Connection = { connected: boolean; loginLost: boolean; fbName: string };
const NEEDS_LOGIN = /not connected|log ?in|logged out|checkpoint/i;

/** the last choice of the two ticks, remembered on this browser */
const CHOICE_KEY = 'fb_post_choice';
type Choice = { profile: boolean; mp: boolean; hashtags?: string };
function loadChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICE_KEY) || 'null');
    if (c && typeof c === 'object') return { profile: c.profile !== false, mp: c.mp !== false, hashtags: c.hashtags };
  } catch {}
  return { profile: true, mp: true };
}
function saveChoice(c: Choice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {}
}

const MP_STATUS: Record<string, string> = {
  queued: 'Waiting in the Marketplace queue…',
  publishing: 'Filling in the Marketplace form…',
  awaiting_publish: 'Needs you: open FB Poster and click Publish',
  published: 'Listed on Marketplace',
  unconfirmed: 'Publish clicked — listing link not found yet',
  needs_attention: 'Created, but Facebook put it under "Needs attention" (not live)',
  failed: 'Marketplace listing failed',
};

export function FbPostModal({ vehicle, onClose, intro }: { vehicle: any | null; onClose: () => void; intro?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const v = vehicle;

  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [toProfile, setToProfile] = useState(true);
  const [toMp, setToMp] = useState(true);
  const [posting, setPosting] = useState(false);

  // live progress (popup stays open while it runs)
  const [runId, setRunId] = useState<string | null>(null); // '' = started, id not known yet
  const [mpStarted, setMpStarted] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [mpListing, setMpListing] = useState<MpListing | null>(null);
  const [stopping, setStopping] = useState(false);
  const [conn, setConn] = useState<Connection | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ───── open: start Facebook on the server right away, load the post text ───── */
  useEffect(() => {
    if (!v) return;
    // speed: Chrome + Facebook start in the background while the dealer looks at the popup
    void fb.post('warm').catch(() => {});
    const saved = loadChoice();
    setToProfile(saved.profile);
    setToMp(saved.mp);
    setRunId(null);
    setMpStarted(false);
    setLive(null);
    setMpListing(null);
    setNeedLogin(false);
    setConn(null);

    const name = vehicleName(v);
    const priceStr = v.price ? money(v.price) : '';
    const feeNum = Number(v.processingFee || (v.extra && typeof v.extra === 'object' && (v.extra.processingFee || v.extra.processing_fee)) || 0);
    const feeStr = feeNum > 0 ? money(feeNum) : '';
    const milesStr = v.mileage ? `${(Number(v.mileage) || 0).toLocaleString()} miles` : '';
    setCaption(`${name}\n${priceStr ? `Price: ${priceStr}\n` : ''}${feeStr ? `Processing fee: ${feeStr}\n` : ''}${milesStr ? `Mileage: ${milesStr}\n` : ''}${v.stockNumber ? `Stock number: ${v.stockNumber}\n` : ''}\nCall or visit us today.`);
    setHashtags(saved.hashtags || '#carsforsale #usedcars');
    setLoadingText(true);
    fb.post<{ copy: { hashtags: string }; text: string }>(`mp/vehicles/${v.id}/generate`, { ai: false, save: false })
      .then((r) => {
        if (r?.text) {
          setCaption(r.text.replace(r.copy?.hashtags || '', '').replace(/\n{3,}/g, '\n\n').trim());
          if (r.copy?.hashtags) setHashtags(r.copy.hashtags);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingText(false));

    fb.get<{ connection?: Connection }>('quick-config')
      .then((q) => q?.connection && setConn(q.connection))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id]);

  /* ───── live progress: poll the FB state while a post / Marketplace listing runs ───── */
  const tracking = runId !== null || mpStarted;
  const poll = useCallback(async () => {
    try {
      const s = await api<LiveState>(`/dealer/facebook/state?log=999999999`);
      setLive({ job: s.job, mp: s.mp });
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!tracking || !v) return;
    let alive = true;
    let mpEnded = false;
    const loop = async () => {
      const s = await poll();
      if (!alive) return;
      const mpBusy = !!s && (s.mp.active?.vehicleId === v.id || s.mp.queue.some((q) => q.id === v.id));
      // the Marketplace listing left the queue: read how it ended
      if (mpStarted && s && !mpBusy && !mpEnded) {
        const r = await fb.get<{ vehicles: { id: string; listing: MpListing }[] }>('mp/vehicles').catch(() => null);
        const l = r?.vehicles.find((x) => x.id === v.id)?.listing;
        if (alive && l && l.status !== 'queued') {
          mpEnded = true;
          setMpListing(l);
          if (l.status === 'failed' && NEEDS_LOGIN.test(l.error || '')) setNeedLogin(true);
        }
      }
      const sameJob = !!s?.job && (!runId || s.job.runId === runId);
      const jobBusy = runId !== null && (!sameJob || s!.job!.status === 'running');
      if (alive && (jobBusy || mpBusy || (mpStarted && !mpEnded))) timer.current = setTimeout(loop, 1500);
    };
    void loop();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, runId, mpStarted, v?.id]);

  const disconnected = needLogin || (!!conn && !conn.connected);
  const missing = mpMissing(v);
  const mpReady = !!v && !missing.length;
  const wantMp = toMp && mpReady;
  const count = (toProfile ? 1 : 0) + (wantMp ? 1 : 0);

  /* ───── the one button: profile and/or Marketplace ───── */
  async function postNow() {
    if (!v || !count) return;
    if (!(v.images || []).length) {
      toast.error('Add at least one photo to this vehicle first.');
      return;
    }
    saveChoice({ profile: toProfile, mp: toMp, hashtags });
    setPosting(true);
    const errors: string[] = [];
    try {
      // profile first: it is quick; the Marketplace form is filled in right after it (one Facebook browser, one task at a time)
      if (toProfile) {
        try {
          const form = new FormData();
          form.append('order', JSON.stringify((v.images || []).map((u: string) => `v:${u}`)));
          form.append('caption', caption || vehicleName(v));
          form.append('hashtags', hashtags || '');
          const r = await api<{ runId?: string; job?: FbJob }>('/dealer/facebook/post', { method: 'POST', form });
          setRunId(r?.runId || r?.job?.runId || '');
          setLive((l) => ({ job: r?.job || l?.job || null, mp: l?.mp || { active: null, queue: [], running: false } }));
        } catch (e) {
          errors.push(`Profile: ${(e as Error).message}`);
        }
      }
      if (wantMp) {
        try {
          const r = await fb.post<{ queued: number; rejected: { id: string; error: string }[] }>('mp/publish', { ids: [v.id] });
          if (r.queued) {
            setMpListing(null);
            setMpStarted(true);
          } else errors.push(`Marketplace: ${r.rejected?.[0]?.error || 'could not be queued'}`);
        } catch (e) {
          errors.push(`Marketplace: ${(e as Error).message}`);
        }
      }
      if (errors.some((m) => NEEDS_LOGIN.test(m))) setNeedLogin(true);
      for (const m of errors) toast.error(m);
      announceFbActivity(); // the bar at the top of every page shows it too
      void poll();
    } finally {
      setPosting(false);
    }
  }

  async function stop() {
    setStopping(true);
    try {
      await Promise.all([fb.post('stop').catch(() => {}), mpStarted ? fb.post('mp/stop').catch(() => {}) : null]);
      void poll();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStopping(false);
    }
  }

  /* ───── progress panel ───── */
  const job = runId !== null && live?.job && (!runId || live.job.runId === runId) ? live.job : null;
  const jobRunning = runId !== null && (!job || job.status === 'running');
  const result = job?.results?.[0];
  const mpQueuePos = live?.mp.queue.findIndex((q) => q.id === v?.id) ?? -1;
  const mpActive = live?.mp.active?.vehicleId === v?.id;
  const mpBusy = mpStarted && !mpListing;
  const mpText = mpListing ? MP_STATUS[mpListing.status] || `Marketplace: ${mpListing.status}` : mpActive ? 'Filling in the Marketplace form…' : mpQueuePos >= 0 ? 'Starts right after your profile post…' : 'Starting…';
  const busy = jobRunning || mpBusy;
  const started = runId !== null || mpStarted;

  const profileText = !job
    ? 'Starting Facebook…'
    : jobRunning
      ? result?.status === 'waiting' && live?.mp.active
        ? 'Waiting for the Marketplace listing, then posting…'
        : result?.status === 'retry'
          ? 'Trying again…'
          : 'Posting on your profile…'
      : job.cancelled
        ? 'Stopped'
        : result?.status === 'done'
          ? result.note && result.note !== 'posted'
            ? `Posted (${result.note})`
            : 'Posted on your profile'
          : `Not posted${result?.error ? `: ${result.error}` : ''}`;

  const progress = started && (
    <div className="space-y-2">
      {runId !== null && (
        <div className={cx('flex items-start gap-2 rounded-xl border p-3 text-sm', jobRunning ? 'border-blue-200 bg-blue-50/70' : result?.status === 'done' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          {jobRunning ? (
            <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-[#1877F2]" />
          ) : result?.status === 'done' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 text-amber-600" />
          )}
          <b className="min-w-0 flex-1 text-slate-900">Profile: {profileText}</b>
        </div>
      )}
      {mpStarted && (
        <div className={cx('flex items-start gap-2 rounded-xl border p-3 text-sm', mpBusy ? 'border-blue-200 bg-blue-50/70' : mpListing?.status === 'published' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          {mpBusy ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-[#1877F2]" /> : mpListing?.status === 'published' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Store className="mt-0.5 h-4 w-4 text-amber-600" />}
          <span className="min-w-0 flex-1">
            <b className="block text-slate-900">Marketplace: {mpText}</b>
            {mpListing?.error && <small className="block text-xs text-red-700">{mpListing.error}</small>}
            {mpListing?.url && (
              <a href={mpListing.url} target="_blank" rel="noopener" className="text-xs font-semibold text-blue-700 hover:underline">
                Open the listing
              </a>
            )}
          </span>
        </div>
      )}
      {busy && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" loading={stopping} onClick={stop}>
            Stop
          </Button>
        </div>
      )}
    </div>
  );

  const goEdit = (field: string) => {
    if (!v) return;
    const id = v.id;
    onClose();
    router.push(`/dealer/inventory/${id}?focus=${encodeURIComponent(field)}`);
  };

  return (
    <Modal
      open={!!v}
      size="lg"
      onClose={() => !posting && onClose()}
      title={
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1877F2] text-white">
            <FacebookIcon className="h-4 w-4" />
          </span>
          <span className="font-heading font-bold text-slate-900">Post to Facebook</span>
        </div>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              router.push('/dealer/facebook');
            }}
            disabled={posting}
          >
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            FB Poster
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={posting}>
              {busy ? 'Close (keeps posting)' : started ? 'Close' : 'Cancel'}
            </Button>
            {!started && (
              <Button
                className="border-transparent bg-[#1877F2] font-bold text-white hover:bg-[#166fe5]"
                loading={posting}
                disabled={!count || disconnected}
                onClick={postNow}
              >
                <FacebookIcon className="mr-1.5 h-3.5 w-3.5" />
                {toProfile && wantMp ? 'Post to profile + Marketplace' : wantMp ? 'Post to Marketplace' : 'Post to profile'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {v && (
        <div className="space-y-4">
          {disconnected && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <b className="block">{conn?.loginLost || needLogin ? 'Facebook asks to log in again' : 'Facebook is not connected yet'}</b>
              <p className="mt-0.5 text-xs text-amber-800">
                Open FB Poster and click <b>Connect Facebook</b> to log in once. The login is saved on the server, so after that every post from Inventory
                works with one click.
              </p>
              <Button
                size="sm"
                className="mt-2 border-transparent bg-[#1877F2] font-semibold text-white hover:bg-[#166fe5]"
                onClick={() => {
                  onClose();
                  router.push('/dealer/facebook');
                }}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Connect in FB Poster
              </Button>
            </div>
          )}
          {!disconnected && conn?.connected && !started && (
            <p className="text-[11px] text-slate-500">
              Posting as <b className="text-slate-700">{conn.fbName || 'your saved Facebook login'}</b>.
            </p>
          )}
          {/* live progress stays on top while posting */}
          {progress}
          {intro}

          {/* vehicle */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
            <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
              {v.images?.[0] ? <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-slate-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm text-slate-900">{vehicleName(v)}</b>
              <div className="mt-0.5 truncate text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{money(v.price)}</span> · {(Number(v.mileage) || 0).toLocaleString()} mi · #{v.stockNumber || '—'} · {v.images?.length || 0} photo{v.images?.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {/* where to post: the two ticks */}
          {!started && (
            <div className="space-y-2">
              <label className={cx('flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs transition', toProfile ? 'border-[#1877F2] bg-blue-50/50' : 'border-slate-200')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1877F2]" checked={toProfile} onChange={(e) => setToProfile(e.target.checked)} />
                <User className="mt-0.5 h-4 w-4 shrink-0 text-[#1877F2]" />
                <span className="min-w-0 flex-1">
                  <b className="block text-sm text-slate-900">Post on my Facebook profile</b>
                  <span className="text-slate-500">A normal post with the photos and the text below.</span>
                </span>
              </label>

              {mpReady ? (
                <label className={cx('flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs transition', toMp ? 'border-emerald-500 bg-emerald-50/60' : 'border-slate-200')}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={toMp} onChange={(e) => setToMp(e.target.checked)} />
                  <Store className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm text-slate-900">List on Facebook Marketplace</b>
                    <span className="text-slate-500">Every Marketplace field is filled in — it is listed automatically.</span>
                  </span>
                </label>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" disabled checked={false} readOnly />
                  <Store className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <b className="block text-sm text-slate-700">Facebook Marketplace — not ready</b>
                    <span className="text-slate-500">Missing: </span>
                    {missing.map((m, i) => (
                      <span key={m}>
                        {i > 0 && ', '}
                        <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => goEdit(MP_FIX[m])}>
                          {m}
                        </button>
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* the post text (profile post) */}
          {!started && toProfile && (
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-600">Post text</span>
                {loadingText && <span className="text-slate-400">Loading…</span>}
              </div>
              <div className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700">
                {caption}
                {hashtags ? `\n\n${hashtags}` : ''}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
