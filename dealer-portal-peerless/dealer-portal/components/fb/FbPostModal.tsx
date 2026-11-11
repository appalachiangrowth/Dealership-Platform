'use client';

/**
 * "Post to Facebook" popup for one vehicle — used by the Inventory table (FB button) and the vehicle editor
 * (right after "Publish vehicle").
 *  · ticks: each of your Pages and "List on Facebook Marketplace" (it needs every Marketplace field filled in)
 *  · ONE button posts to whatever is ticked (both = both)
 *  · after "Post", the popup stays open and shows the live progress at the top (also shown in the bar on every page)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, CheckCircle2, Gauge, Hash, ImageIcon, Info, Loader2, RefreshCw, Send, Store, Tag, X, XCircle } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, cx } from '@/components/ui';
import { money, vehicleName } from '@/lib/format';
import { FacebookIcon, fb, type FbItem, type FbJob } from '@/lib/facebook';
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
type Choice = { profile: boolean; mp: boolean; pages?: string[]; hashtags?: string };
function loadChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICE_KEY) || 'null');
    if (c && typeof c === 'object') return { profile: c.profile !== false, mp: c.mp !== false, pages: Array.isArray(c.pages) ? c.pages : [], hashtags: c.hashtags };
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
  // posting goes to the Pages you tick and to Marketplace (no personal-profile posts)
  const toProfile = false;
  const [toMp, setToMp] = useState(true);
  const [posting, setPosting] = useState(false);
  // your Facebook Pages (loaded once in FB Poster or here) and the ticked ones
  const [pages, setPages] = useState<FbItem[]>([]);
  const [selPages, setSelPages] = useState<Set<string>>(new Set());
  const [loadingPages, setLoadingPages] = useState(false);
  // the text that goes into the Marketplace listing's Description box
  const [mpCopy, setMpCopy] = useState('');
  const [showMpCopy, setShowMpCopy] = useState(false);
  // the Page post text: written from the vehicle until the dealer edits it
  const [editText, setEditText] = useState('');
  const [textEdited, setTextEdited] = useState(false);

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
    setToMp(saved.mp);
    setSelPages(new Set(saved.pages || []));
    setMpCopy('');
    setShowMpCopy(false);
    setEditText('');
    setTextEdited(false);
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

    fb.get<{ connection?: Connection; account?: { pages?: FbItem[] } }>('quick-config')
      .then((q) => {
        if (q?.connection) setConn(q.connection);
        const list = (q?.account?.pages || []).filter((p) => p?.url);
        setPages(list);
        // ticked Pages that are no longer in the list are dropped
        setSelPages((cur) => new Set([...cur].filter((u) => list.some((p) => p.url === u))));
        // no Pages saved yet: read them from Facebook straight away
        if (!list.length && q?.connection?.connected) void loadPages(true);
      })
      .catch(() => {});
    // what Marketplace will show: the saved listing text, else the text written from the vehicle
    Promise.all([
      fb.get<{ text: string }>(`mp/vehicles/${v.id}/preview`).catch(() => null),
      fb.post<{ text: string }>(`mp/vehicles/${v.id}/generate`, { ai: false, save: false }).catch(() => null),
    ]).then(([p, g]) => setMpCopy((p?.text || '').trim() || (g?.text || '').trim()));
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
  const wantMp = toMp;
  const pageList = pages.filter((p) => selPages.has(p.url));
  const count = (toProfile ? 1 : 0) + pageList.length + (wantMp ? 1 : 0);
  const postsAnywhere = toProfile || pageList.length > 0;
  const autoText = [caption.trim(), hashtags.trim()].filter(Boolean).join('\n\n');
  const text = textEdited ? editText : autoText;

  // Esc closes the popup (not while the Post request is being sent)
  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !posting && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [v, posting, onClose]);

  async function loadPages(silent = false) {
    setLoadingPages(true);
    try {
      const r = await fb.post<{ pages: FbItem[] }>('pages/load');
      setPages(r.pages || []);
      if (!silent || !r.pages?.length) toast.ok(r.pages?.length ? `${r.pages.length} Page${r.pages.length === 1 ? '' : 's'} found.` : 'No Pages found for this Facebook account.');
    } catch (e) {
      if (NEEDS_LOGIN.test((e as Error).message)) setNeedLogin(true);
      if (!silent) toast.error((e as Error).message);
    } finally {
      setLoadingPages(false);
    }
  }
  const togglePage = (url: string) =>
    setSelPages((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  /* ───── the one button: profile and/or Marketplace ───── */
  async function postNow() {
    if (!v || !count) return;
    if (toMp && !mpReady) {
      toast.error(`Marketplace needs: ${missing.join(', ')}. Click a missing item to fill it in, or untick Marketplace.`);
      return;
    }
    if (!(v.images || []).length) {
      toast.error('Add at least one photo to this vehicle first.');
      return;
    }
    saveChoice({ profile: toProfile, mp: toMp, pages: [...selPages], hashtags });
    setPosting(true);
    const errors: string[] = [];
    try {
      // profile / Pages first: they are quick; the Marketplace form is filled in right after (one Facebook browser, one task at a time)
      if (postsAnywhere) {
        try {
          const form = new FormData();
          form.append('profile', '0');
          form.append('pages', JSON.stringify(pageList));
          form.append('order', JSON.stringify((v.images || []).map((u: string) => `v:${u}`)));
          form.append('caption', text || vehicleName(v));
          form.append('hashtags', '');
          const r = await api<{ runId?: string; job?: FbJob }>('/dealer/facebook/post', { method: 'POST', form });
          setRunId(r?.runId || r?.job?.runId || '');
          setLive((l) => ({ job: r?.job || l?.job || null, mp: l?.mp || { active: null, queue: [], running: false } }));
        } catch (e) {
          errors.push(`Facebook post: ${(e as Error).message}`);
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
  const mpText = mpListing ? MP_STATUS[mpListing.status] || `Marketplace: ${mpListing.status}` : mpActive ? 'Filling in the Marketplace form…' : mpQueuePos >= 0 ? 'Starts right after your Facebook post…' : 'Starting…';
  const busy = jobRunning || mpBusy;
  const started = runId !== null || mpStarted;

  const okN = job ? job.results.filter((x) => x.status === 'done').length : 0;
  const total = job?.total || 0;
  const one = total <= 1;
  const postText = !job
    ? 'Starting Facebook…'
    : jobRunning
      ? result?.status === 'waiting' && live?.mp.active
        ? 'Waiting for the Marketplace listing, then posting…'
        : one
          ? result?.status === 'retry'
            ? 'Trying again…'
            : 'Posting…'
          : `Posting… ${okN} of ${total} done`
      : job.cancelled
        ? 'Stopped'
        : one
          ? result?.status === 'done'
            ? result.note && result.note !== 'posted'
              ? `Posted (${result.note})`
              : 'Posted'
            : `Not posted${result?.error ? `: ${result.error}` : ''}`
          : `Done · ${okN} of ${total} posted${job.failed ? ` · ${job.failed} failed` : ''}`;
  const allOk = !!job && !jobRunning && okN === total && total > 0;

  const progress = started && (
    <div className="space-y-2">
      {runId !== null && (
        <div className={cx('rounded-xl border p-3 text-sm', jobRunning ? 'border-blue-200 bg-blue-50/70' : allOk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex items-start gap-2">
            {jobRunning ? (
              <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-[#1877F2]" />
            ) : allOk ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 text-amber-600" />
            )}
            <b className="min-w-0 flex-1 text-slate-900">
              {one ? `${result?.name?.includes('· Page') ? 'Page' : 'Profile'}: ` : 'Facebook: '}
              {postText}
            </b>
          </div>
          {!one && job && (
            <ul className="mt-2 space-y-1 pl-6">
              {job.results.map((x) => (
                <li key={x.url} className="flex items-center gap-2 text-xs">
                  {x.status === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : x.status === 'failed' || x.status === 'skipped' ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                  ) : x.status === 'running' || x.status === 'retry' ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#1877F2]" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-slate-300" />
                  )}
                  <span className={cx('min-w-0 flex-1 truncate', x.status === 'waiting' ? 'text-slate-400' : 'text-slate-700')}>{x.name || x.url}</span>
                  <span className={cx('max-w-[45%] shrink-0 truncate text-[11px]', x.status === 'failed' ? 'text-red-600' : 'text-slate-500')} title={x.error || ''}>
                    {x.status === 'done' ? 'posted' : x.status === 'running' ? 'posting…' : x.status === 'retry' ? 'retrying…' : x.status === 'waiting' ? 'waiting' : x.error || x.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
  const openFbPoster = () => {
    onClose();
    router.push('/dealer/facebook');
  };

  if (!v) return null;

  const where = [wantMp && 'Marketplace', pageList.length === 1 ? (pageList[0].name || 'your Page') : pageList.length > 1 && `${pageList.length} Pages`].filter(Boolean) as string[];
  const optCls = (on: boolean, warn = false) =>
    cx(
      'flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition',
      on ? (warn ? 'border-[#FCD34D] bg-[#FFFBEB]' : 'border-[#93B4F5] bg-[#F5F8FF]') : 'border-[#E5E9F0] bg-white hover:bg-[#F8FAFC]',
    );
  const stepNum = (n: number) => <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-[13px] font-bold text-white">{n}</span>;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(15,23,42,0.55)] px-4 py-6 sm:py-10" onMouseDown={(e) => e.target === e.currentTarget && !posting && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="fbm-h" className="mx-auto flex w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white text-sm text-[#0F172A] shadow-[0_24px_60px_rgba(15,23,42,0.35)]">
        {/* header */}
        <div className="flex items-start gap-3.5 border-b border-[#E5E9F0] px-6 py-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1877F2] text-white">
            <FacebookIcon className="h-[22px] w-[22px]" />
          </span>
          <div className="flex flex-1 flex-col gap-0.5">
            <h2 id="fbm-h" className="m-0 text-xl font-bold">
              Post to Facebook
            </h2>
            <span className="text-sm text-[#526077]">{started ? 'Posting runs on our server. You can close this window; it carries on.' : 'Choose where to share this vehicle, check the text, then post.'}</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={posting}
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#E5E9F0] bg-white text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] disabled:opacity-50"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="flex flex-col gap-[22px] px-6 py-5">
          {/* live progress stays on top while posting */}
          {progress}
          {intro}

          {/* vehicle */}
          <div className="flex items-center gap-3.5 rounded-xl border border-[#E5E9F0] bg-[#F8FAFC] p-3">
            <span className="flex h-[62px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#E2E8F0] text-[#64748B]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {v.images?.[0] ? <img src={mediaUrl(v.images[0])} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-[22px] w-[22px]" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-base font-bold">{vehicleName(v)}</span>
              <span className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] text-[#526077]">
                <span className="inline-flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  {money(v.price)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5" />
                  {(Number(v.mileage) || 0).toLocaleString()} mi
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  Stock {v.stockNumber || '—'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5" />
                  {v.images?.length || 0} photo{v.images?.length === 1 ? '' : 's'}
                </span>
              </span>
            </div>
          </div>

          {/* connection */}
          {disconnected ? (
            <div className="flex items-start gap-2.5 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-3 text-[13px] text-[#78350F]">
              <Info className="mt-px h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">
                <b className="block">{conn?.loginLost || needLogin ? 'Facebook asks to log in again' : 'Facebook is not connected yet'}</b>
                Open FB Poster and click <b>Connect Facebook</b> to log in once. After that every post from Inventory works with one click.
              </span>
              <button type="button" onClick={openFbPoster} className="whitespace-nowrap font-semibold text-[#1D4ED8] hover:underline">
                Connect
              </button>
            </div>
          ) : (
            !started && (
              <div className="flex items-start gap-2.5 rounded-[10px] border border-[#DBE7FE] bg-[#EFF6FF] px-3.5 py-3 text-[13px] text-[#1E3A8A]">
                <Info className="mt-px h-[18px] w-[18px] shrink-0" />
                <span className="flex-1">
                  Posting as <b>{conn?.fbName || 'your saved Facebook login'}</b>. If you haven’t posted for a while, the first post takes a few extra seconds while Facebook starts up.
                </span>
                <button type="button" onClick={openFbPoster} className="whitespace-nowrap font-semibold text-[#1D4ED8] hover:underline">
                  Change account
                </button>
              </div>
            )
          )}

          {!started && (
            <>
              {/* step 1 */}
              <section aria-labelledby="s1-h" className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5">
                  {stepNum(1)}
                  <h3 id="s1-h" className="m-0 flex-1 text-base font-bold">
                    Where do you want to post?
                  </h3>
                  <span className="whitespace-nowrap rounded-full bg-[#EAF1FF] px-2.5 py-[3px] text-xs font-semibold text-[#1D4ED8]">
                    {count} place{count === 1 ? '' : 's'} selected
                  </span>
                </div>

                {/* Marketplace */}
                <label className={optCls(toMp, toMp && !mpReady)}>
                  <input type="checkbox" className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#2563EB]" checked={toMp} onChange={(e) => setToMp(e.target.checked)} />
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#E8F7EE] text-[#15803D]">
                    <Store className="h-[18px] w-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold">Facebook Marketplace</span>
                      {mpReady ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F7EE] px-2.5 py-[3px] text-xs font-semibold text-[#15803D]">
                          <Check className="h-3 w-3" strokeWidth={2.6} /> Ready
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#FEF3C7] px-2.5 py-[3px] text-xs font-semibold text-[#92400E]">Not ready</span>
                      )}
                    </span>
                    {mpReady ? (
                      <span className="text-[13px] text-[#526077]">Every detail Marketplace needs is filled in. It is listed automatically.</span>
                    ) : (
                      <span className="text-[13px] text-[#78350F]">
                        Still needed:{' '}
                        {missing.map((m, i) => (
                          <span key={m}>
                            {i > 0 && ', '}
                            <button
                              type="button"
                              className="font-semibold text-[#1D4ED8] hover:underline"
                              onClick={(e) => {
                                e.preventDefault();
                                goEdit(MP_FIX[m]);
                              }}
                            >
                              {m}
                            </button>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <Tip text="Marketplace is Facebook’s buy-and-sell area. Your listing shows to local buyers searching for vehicles, with price, mileage and photos taken from your inventory." />
                </label>

                {/* Pages */}
                {pages.map((p) => (
                  <label key={p.url} className={optCls(selPages.has(p.url))} title={p.url}>
                    <input type="checkbox" className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[#2563EB]" checked={selPages.has(p.url)} onChange={() => togglePage(p.url)} />
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#EAF1FF] text-[#1D4ED8]">
                      <FacebookIcon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">Your Facebook Page</span>
                      <span className="truncate text-[13px] text-[#526077]">{p.name || p.url}</span>
                    </span>
                    <Tip text="Your business Page on Facebook. The post goes out as the Page itself, with the photos and the text below. Your Facebook account must be an admin of the Page." />
                  </label>
                ))}
                <div className="flex flex-wrap items-center gap-2 px-1 text-[13px] text-[#526077]">
                  {loadingPages ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your Pages from Facebook…
                    </span>
                  ) : (
                    <>
                      <span>{pages.length ? 'Missing a Page?' : 'No Facebook Pages loaded yet.'}</span>
                      <button type="button" disabled={disconnected} onClick={() => loadPages()} className="inline-flex items-center gap-1 font-semibold text-[#1D4ED8] hover:underline disabled:opacity-50">
                        <RefreshCw className="h-3.5 w-3.5" /> {pages.length ? 'Refresh my Pages' : 'Load my Pages'}
                      </button>
                    </>
                  )}
                </div>
              </section>

              {/* step 2 */}
              <section aria-labelledby="s2-h" className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2.5">
                  {stepNum(2)}
                  <h3 id="s2-h" className="m-0 flex-1 text-base font-bold">
                    Check the post text
                  </h3>
                  {textEdited && (
                    <button type="button" className="text-[13px] font-semibold text-[#1D4ED8] hover:underline" onClick={() => setTextEdited(false)}>
                      Use automatic text
                    </button>
                  )}
                </div>
                <span className="text-[13px] text-[#526077]">
                  {loadingText ? 'Writing the text from the vehicle’s details…' : 'Written for you from the vehicle’s details. Edit anything you like before posting.'}
                  {!postsAnywhere && ' (Used for Page posts.)'}
                </span>
                <div className="flex overflow-hidden rounded-lg border border-[#CBD5E1] bg-white focus-within:border-[#2563EB] focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.18)]">
                  <label htmlFor="fb-text" className="sr-only">
                    Post text
                  </label>
                  <textarea
                    id="fb-text"
                    value={text}
                    onChange={(e) => {
                      setTextEdited(true);
                      setEditText(e.target.value);
                    }}
                    className="min-h-[150px] min-w-0 flex-1 resize-y border-0 bg-transparent px-3 py-2.5 text-sm leading-normal text-[#0F172A] outline-none"
                  />
                </div>
                {toMp && (
                  <div className="rounded-[10px] border border-[#BBE5CB] bg-[#F3FBF6] px-3.5 py-2.5 text-[13px]">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 shrink-0 text-[#15803D]" />
                      <span className="flex-1 text-[#14532D]">Marketplace uses its own listing text (description and hashtags).</span>
                      <button type="button" className="font-semibold text-[#1D4ED8] hover:underline" onClick={() => setShowMpCopy(!showMpCopy)}>
                        {showMpCopy ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    {showMpCopy && (
                      <>
                        <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-white p-2.5 font-mono text-[11px] leading-relaxed text-[#334155]">{mpCopy || 'Loading…'}</div>
                        <p className="mt-1 text-[11px] text-[#526077]">Change it in FB Poster › Marketplace.</p>
                      </>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center gap-3 border-t border-[#E5E9F0] bg-[#F8FAFC] px-6 py-4">
          <span className="min-w-[220px] flex-1 text-[13px] text-[#334155]">
            {started
              ? busy
                ? 'Posting… you can close this window, progress also shows at the top of every page.'
                : 'Finished.'
              : !count
                ? 'Select at least one place to post.'
                : `Posts to ${where.length > 1 ? where.slice(0, -1).join(', ') + ' and ' + where[where.length - 1] : where[0]}. This takes about a minute. You can close this window; progress shows in FB Poster.`}
          </span>
          <button type="button" onClick={onClose} disabled={posting} className="inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#0F172A] hover:bg-[#F8FAFC] disabled:opacity-60">
            {busy ? 'Close (keeps posting)' : started ? 'Close' : 'Cancel'}
          </button>
          {!started && (
            <button
              type="button"
              disabled={!count || disconnected || posting}
              onClick={postNow}
              className={cx(
                'inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg px-[18px] text-sm font-semibold transition disabled:cursor-not-allowed',
                count && !disconnected ? 'bg-[#1877F2] text-white hover:bg-[#166fe5]' : 'bg-[#C7D2E3] text-[#334155]',
              )}
            >
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {!count ? 'Choose where to post' : `Post to ${count} place${count === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** ⓘ with an explanation on hover */
function Tip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex shrink-0 self-start" onClick={(e) => e.preventDefault()}>
      <button type="button" aria-label="More information" className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[#64748B] outline-none hover:bg-[#EAF1FF] hover:text-[#1D4ED8] focus-visible:bg-[#EAF1FF]">
        <Info className="h-[15px] w-[15px]" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] right-[-10px] z-40 hidden w-[260px] rounded-lg bg-[#0F172A] px-3 py-2.5 text-[12.5px] font-normal leading-normal text-[#F1F5F9] shadow-[0_8px_24px_rgba(15,23,42,0.25)] group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}
