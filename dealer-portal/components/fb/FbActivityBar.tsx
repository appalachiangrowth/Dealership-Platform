'use client';

/**
 * Facebook progress at the top of EVERY Dealer Portal page: shown while Page posts or Marketplace listings run on the
 * server (also after the "Post to Facebook" popup was closed), then a short summary.
 *
 * Marketplace runs one vehicle at a time. Vehicles queued back to back (4, 5, 6 …) form one batch: the bar shows the
 * vehicle being posted ("Posting 2021 Honda Civic (2 of 5) · Uploading photos"), the counts (2 posted · 1 posting now
 * · 2 queued · 0 failed), announces each finished vehicle and the next one starting, and opens a list of every vehicle
 * of the batch with a Retry button for the ones that failed.
 *
 * It asks the server every 2 s while something runs and every 20 s otherwise ("peek": it never keeps an idle Facebook
 * browser awake). The popup announces a new post with the "fb-activity" event so the bar shows at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Loader2, RotateCcw, Store, X, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { FacebookIcon, fb, type FbJob, type MpBatch, type MpBatchItem } from '@/lib/facebook';
import { cx } from '@/components/ui';

type Live = {
  job: FbJob | null;
  postQueue?: { runId?: string; label: string; total: number }[];
  mp: { active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[]; running: boolean; batch?: MpBatch | null };
};

/** call after starting a post / Marketplace listing: the bar at the top shows it straight away */
export function announceFbActivity() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fb-activity'));
}

const ENDED = ['done', 'failed', 'skipped', 'cancelled', 'not posted'];
const ITEM_ENDED = ['done', 'attention', 'failed', 'cancelled'];

/** "2 posted · 1 posting now · 3 queued · 1 failed" (posted / posting / queued always, the others when they happen) */
function counts(b: MpBatch) {
  const parts: { n: number; text: string; tone: string }[] = [
    { n: b.done, text: 'posted', tone: 'text-emerald-700' },
    { n: b.running, text: 'posting now', tone: 'text-[#0B5CD5]' },
    { n: b.queued, text: 'queued', tone: 'text-slate-600' },
    { n: b.attention, text: 'need attention', tone: 'text-amber-700' },
    { n: b.failed, text: 'failed', tone: 'text-red-600' },
    { n: b.cancelled, text: 'cancelled', tone: 'text-slate-500' },
  ];
  return parts.filter((p, i) => p.n > 0 || i < 3);
}

const nameOf = (it: MpBatchItem) => it.name || 'Vehicle';

export function FbActivityBar({ enabled }: { enabled: boolean }) {
  const [live, setLive] = useState<Live | null>(null);
  const [doneJob, setDoneJob] = useState<FbJob | null>(null); // finished Page post shown for a few seconds
  const [mpShowDone, setMpShowDone] = useState(false); // finished batch summary
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false); // the list of every vehicle of the batch
  const [stopping, setStopping] = useState('');
  const [retrying, setRetrying] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad'; at: number } | null>(null); // "✓ Honda Civic is live"
  const [, tick] = useState(0); // countdown "starts in 34s"
  const seenRunning = useRef<{ job: string | null; mp: number | null }>({ job: null, mp: null });
  const lastStatus = useRef<Record<string, string>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const off = useRef(false); // feature switched off / no permission: stop asking

  const poll = useCallback(async () => {
    if (off.current) return null;
    try {
      const s = await api<Live>('/dealer/facebook/state?log=999999999&peek=1');
      if (!alive.current) return null;
      setLive({ job: s.job, mp: s.mp, postQueue: s.postQueue || [] });

      // a Page post that was running and is now finished → its summary for a moment
      const runKey = s.job ? `${s.job.runId || ''}:${s.job.startedAt}` : null;
      if (s.job?.status === 'running') {
        seenRunning.current.job = runKey;
        setDoneJob(null);
      } else if (s.job && seenRunning.current.job === runKey) {
        seenRunning.current.job = null;
        setDoneJob(s.job);
        setHidden(false);
        setTimeout(() => alive.current && setDoneJob((d) => (d === s.job ? null : d)), 12000);
      }

      // Marketplace batch: announce every vehicle that just finished; keep the summary of a finished batch
      const b = s.mp.batch;
      if (b) {
        for (const it of b.items) {
          const key = `${b.id}:${it.id}:${it.action}`;
          const before = lastStatus.current[key];
          if (before && before !== it.status && ITEM_ENDED.includes(it.status)) {
            const next = b.items.find((x) => x.status === 'running' || x.status === 'queued');
            const nextText = next && !b.finishedAt ? ` Next: ${nameOf(next)}${next.status === 'running' ? ' is starting' : ''}.` : '';
            if (it.status === 'done') setFlash({ text: `✓ ${nameOf(it)} ${it.action === 'publish' ? 'is live on Marketplace' : 'done'}.${nextText}`, tone: 'ok', at: Date.now() });
            else if (it.status === 'attention') setFlash({ text: `${nameOf(it)} was created but needs attention on Facebook.${nextText}`, tone: 'warn', at: Date.now() });
            else if (it.status === 'failed') setFlash({ text: `${nameOf(it)} was not posted: ${(it.error || 'see the list').replace(/[.\s]+$/, '')}.${nextText}`, tone: 'bad', at: Date.now() });
          }
          lastStatus.current[key] = it.status;
        }
        if (!b.finishedAt) {
          seenRunning.current.mp = b.id;
          setMpShowDone(false);
        } else if (seenRunning.current.mp === b.id) {
          seenRunning.current.mp = null;
          setMpShowDone(true);
          setHidden(false);
          // all fine: the summary goes away by itself; problems stay until closed
          if (!b.failed && !b.attention) setTimeout(() => alive.current && setMpShowDone(false), 15000);
        }
      }
      return s;
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 401 || st === 403 || st === 404) off.current = true;
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    let fastUntil = 0;
    const loop = async () => {
      const s = await poll();
      if (!alive.current || off.current) return;
      const busy =
        !!s && (s.job?.status === 'running' || !!(s.postQueue || []).length || !!s.mp.active || s.mp.queue.length > 0 || s.mp.running || !!(s.mp.batch && !s.mp.batch.finishedAt));
      const ms = busy || Date.now() < fastUntil ? 2000 : document.hidden ? 30000 : 20000;
      timer.current = setTimeout(loop, ms);
    };
    const kick = () => {
      fastUntil = Date.now() + 15000; // the server may need a moment to start the run
      setHidden(false);
      if (timer.current) clearTimeout(timer.current);
      void loop();
    };
    window.addEventListener('fb-activity', kick);
    void loop();
    return () => {
      alive.current = false;
      window.removeEventListener('fb-activity', kick);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, poll]);

  // the "next vehicle starts in 34s" countdown, and the finished-vehicle note fades after a few seconds
  const batch = live?.mp.batch || null;
  const counting = !!batch?.nextAt || !!flash;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => {
      tick((n) => n + 1);
      setFlash((f) => (f && Date.now() - f.at > 9000 ? null : f));
    }, 1000);
    return () => clearInterval(t);
  }, [counting]);

  if (!enabled || !live) return null;
  const job = live.job;
  const running = job?.status === 'running';
  const postWaiting = live.postQueue || [];
  const batchLive = !!batch && !batch.finishedAt;
  const mpBusy = !!live.mp.active || live.mp.queue.length > 0 || live.mp.running || batchLive;
  const showMp = (!!batch && (batchLive || mpShowDone)) || mpBusy;
  if (!running && !postWaiting.length && !showMp && !doneJob) return null;
  if (hidden && !running && !mpBusy) return null;

  const shown = running ? job : doneJob;
  const total = shown?.total || 0;
  const okN = shown ? shown.results.filter((r) => r.status === 'done').length : 0;
  const endN = shown ? shown.results.filter((r) => ENDED.includes(r.status)).length : 0;
  const failN = shown ? shown.results.filter((r) => r.status === 'failed' || r.status === 'skipped').length : 0;
  const current = running ? job!.results.find((r) => r.status === 'running' || r.status === 'retry') : null;
  const nextIn = running && job!.nextAt ? Math.max(0, Math.round((job!.nextAt - Date.now()) / 1000)) : 0;
  const waitingForMp = running && job!.results.every((r) => r.status === 'waiting') && !!live.mp.active;

  // Marketplace batch
  const items = batch?.items || [];
  const now = items.find((it) => it.status === 'running') || null;
  const nextUp = items.find((it) => it.status === 'queued') || null;
  const endedN = items.filter((it) => ITEM_ENDED.includes(it.status)).length;
  const mpNextIn = batch?.nextAt ? Math.max(0, Math.round((batch.nextAt - Date.now()) / 1000)) : 0;
  const failed = items.filter((it) => (it.status === 'failed' || it.status === 'cancelled') && it.action === 'publish');
  // the vehicle being posted counts as half done, so the bar moves while it is posted
  const pct = batch && batch.total ? Math.round(((endedN + (now ? 0.5 : 0)) / batch.total) * 100) : 0;

  const stopPosts = async () => {
    setStopping('post');
    try {
      await fb.post('stop');
      void poll();
    } catch {
      /* the popup / FB Poster shows errors */
    } finally {
      setStopping('');
    }
  };
  const stopMp = async () => {
    if (!window.confirm('Stop Marketplace posting? The vehicle being posted stops and the vehicles waiting in line are taken out of the queue.')) return;
    setStopping('mp');
    try {
      await fb.post('mp/stop');
      void poll();
    } catch {
      /* shown on the Marketplace page */
    } finally {
      setStopping('');
    }
  };
  const retry = async (ids: string[]) => {
    if (!ids.length) return;
    setRetrying(ids);
    try {
      const r = await fb.post<{ queued: number; rejected: { id: string; error: string }[] }>('mp/publish', { ids });
      if (r.rejected?.length) setFlash({ text: r.rejected.map((x) => x.error).join(' · '), tone: 'bad', at: Date.now() });
      else setFlash({ text: `${r.queued} vehicle${r.queued === 1 ? '' : 's'} queued again.`, tone: 'ok', at: Date.now() });
      announceFbActivity();
    } catch (e) {
      setFlash({ text: (e as Error).message, tone: 'bad', at: Date.now() });
    } finally {
      setRetrying([]);
    }
  };

  let headline: string;
  if (batch && now) {
    headline = `${now.action === 'publish' ? 'Posting' : now.verb} ${nameOf(now)}${batch.total > 1 ? ` (${now.position} of ${batch.total})` : ''}`;
  } else if (batch && batchLive && nextUp) {
    headline = mpNextIn > 0 ? `Next: ${nameOf(nextUp)} (${nextUp.position} of ${batch.total}) starts in ${mpNextIn}s` : `Starting ${nameOf(nextUp)} (${nextUp.position} of ${batch.total})…`;
  } else if (batch && !batchLive) {
    headline =
      batch.total === 1
        ? batch.done
          ? `${nameOf(items[0])} posted on Marketplace`
          : `${nameOf(items[0])}: ${items[0].status === 'attention' ? 'needs attention on Facebook' : items[0].status === 'cancelled' ? 'stopped' : 'not posted'}`
        : `Marketplace batch finished · ${batch.done} of ${batch.total} posted`;
  } else headline = live.mp.active ? `Marketplace: ${live.mp.active.action === 'publish' ? 'listing a vehicle' : 'updating a listing'}…` : 'Marketplace: starting…';

  return (
    <div className="sticky top-0 z-20 border-b border-blue-200 bg-white/95 shadow-sm backdrop-blur">
      {/* ───── Page posts ───── */}
      {(shown || postWaiting.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-8">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#1877F2] text-white">
            <FacebookIcon className="h-3.5 w-3.5" />
          </span>
          {running || (!shown && postWaiting.length) ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#1877F2]" />
          ) : failN ? (
            <XCircle className="h-4 w-4 shrink-0 text-amber-600" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          )}
          <b className="text-slate-900">
            {!shown
              ? 'Facebook post starting…'
              : waitingForMp
                ? `Waiting for the Marketplace listing, then posting ${job!.label || 'to Facebook'}…`
                : running
                  ? `Posting ${job!.label || 'on Facebook'}${total > 1 ? ` · ${okN} of ${total} Pages done` : '…'}`
                  : shown.cancelled
                    ? 'Facebook posting stopped'
                    : total > 1
                      ? `Facebook post${shown.label ? ` for ${shown.label}` : ''} done · ${okN} of ${total} posted${failN ? ` · ${failN} not posted` : ''}`
                      : okN
                        ? `Posted${shown.label ? ` ${shown.label}` : ''} on Facebook`
                        : 'Facebook post was not posted — see FB Poster for details'}
          </b>
          {running && current && total > 1 && <span className="min-w-0 truncate text-xs text-slate-500">now: {current.name || current.url}</span>}
          {running && !current && nextIn > 0 && <span className="text-xs text-slate-500">next Page in {nextIn}s</span>}
          {postWaiting.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600" title={postWaiting.map((p) => p.label || 'Facebook post').join(', ')}>
              {postWaiting.length} more post{postWaiting.length === 1 ? '' : 's'} waiting{postWaiting[0]?.label ? `: ${postWaiting[0].label}${postWaiting.length > 1 ? '…' : ''}` : ''}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Link href="/dealer/facebook" className="text-xs font-semibold text-blue-700 hover:underline">
              Details
            </Link>
            {running || postWaiting.length ? (
              <button onClick={stopPosts} disabled={stopping === 'post'} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {stopping === 'post' ? 'Stopping…' : postWaiting.length ? 'Stop all' : 'Stop'}
              </button>
            ) : (
              <button onClick={() => setHidden(true)} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Hide">
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
          {total > 0 && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full transition-all', running ? 'bg-[#1877F2]' : failN ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.round((endN / total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {/* ───── Marketplace batch ───── */}
      {showMp && (
        <div className={cx('text-sm', (shown || postWaiting.length > 0) && 'border-t border-slate-100')}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-8">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0B5CD5] text-white">
              <Store className="h-3.5 w-3.5" />
            </span>
            {batchLive || (!batch && mpBusy) ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0B5CD5]" />
            ) : batch && (batch.failed || batch.attention) ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            )}
            <button type="button" onClick={() => batch && setOpen(!open)} className="flex min-w-0 items-center gap-2 text-left" aria-expanded={open} disabled={!batch} title={batch ? 'Show every vehicle of this batch' : undefined}>
              <b className="truncate text-slate-900">{headline}</b>
              {now?.step && <span className="hidden min-w-0 truncate text-xs text-slate-500 sm:inline">· {now.step}…</span>}
              {batch && <ChevronDown className={cx('h-4 w-4 shrink-0 text-slate-400 transition', open && 'rotate-180')} />}
            </button>
            {batch && (
              <span className="flex flex-wrap items-center gap-x-2 text-xs font-semibold" aria-live="polite">
                {counts(batch).map((c, i) => (
                  <span key={c.text} className={cx(c.n ? c.tone : 'text-slate-400')}>
                    {i > 0 && <span className="mr-2 text-slate-300">•</span>}
                    {c.n} {c.text}
                  </span>
                ))}
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {!batchLive && failed.length > 0 && (
                <button
                  onClick={() => void retry(failed.map((f) => f.id))}
                  disabled={!!retrying.length}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" /> Retry {failed.length === 1 ? 'failed' : `${failed.length} failed`}
                </button>
              )}
              <Link href="/dealer/facebook/marketplace" className="text-xs font-semibold text-blue-700 hover:underline">
                {mpBusy ? 'Details' : 'See the result'}
              </Link>
              {mpBusy ? (
                <button onClick={stopMp} disabled={stopping === 'mp'} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {stopping === 'mp' ? 'Stopping…' : 'Stop'}
                </button>
              ) : (
                <button
                  onClick={() => {
                    setHidden(true);
                    setMpShowDone(false);
                    setOpen(false);
                  }}
                  className="rounded p-0.5 text-slate-400 hover:text-slate-700"
                  aria-label="Hide"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </span>
            {now?.step && <span className="w-full truncate text-xs text-slate-500 sm:hidden">{now.step}…</span>}
            {batch ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={endedN} aria-label="Marketplace batch progress">
                <div
                  className={cx('h-full rounded-full transition-all duration-700', batchLive ? 'bg-[#0B5CD5]' : batch.failed || batch.attention ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${pct}%` }}
                />
              </div>
            ) : (
              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-[#0B5CD5]" />
              </div>
            )}
          </div>

          {/* a vehicle just finished: say so, and which one starts next */}
          {flash && (
            <div
              className={cx(
                'mx-4 mb-2 rounded-lg px-3 py-1.5 text-xs font-semibold sm:mx-8',
                flash.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : flash.tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700',
              )}
              role="status"
            >
              {flash.text}
            </div>
          )}

          {/* every vehicle of the batch */}
          {open && batch && (
            <ol className="mx-4 mb-3 max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white sm:mx-8">
              {items.map((it) => (
                <li key={`${it.id}:${it.action}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-slate-400">{it.position}</span>
                  <StatusIcon s={it.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {it.action !== 'publish' && <span className="font-normal text-slate-500">{it.verb} </span>}
                      {nameOf(it)}
                      {it.tries > 1 && <span className="ml-1 text-xs font-normal text-slate-400">(try {it.tries})</span>}
                    </span>
                    <span className={cx('block truncate text-xs', it.status === 'failed' ? 'text-red-600' : it.status === 'attention' ? 'text-amber-700' : 'text-slate-500')} title={it.error || it.step}>
                      {itemText(it, it === nextUp ? mpNextIn : 0)}
                    </span>
                  </span>
                  {(it.status === 'failed' || it.status === 'cancelled') && it.action === 'publish' && (
                    <button
                      onClick={() => void retry([it.id])}
                      disabled={retrying.includes(it.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {retrying.includes(it.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Retry
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** the line under a vehicle in the batch list */
function itemText(it: MpBatchItem, startsIn: number): string {
  switch (it.status) {
    case 'running':
      return `${it.step || 'Working'}…`;
    case 'queued':
      return startsIn > 0 ? `Next — starts in ${startsIn}s` : 'Waiting in line';
    case 'done':
      return it.action === 'publish' ? 'Live on Marketplace' : 'Done';
    case 'attention':
      return it.error || 'Created, but Facebook needs your attention';
    case 'cancelled':
      return it.error || 'Stopped';
    default:
      return it.error || 'Not posted';
  }
}

function StatusIcon({ s }: { s: MpBatchItem['status'] }) {
  if (s === 'running') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0B5CD5]" aria-label="Posting now" />;
  if (s === 'queued') return <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-label="Queued" />;
  if (s === 'done') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Posted" />;
  if (s === 'attention') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-label="Needs attention" />;
  if (s === 'cancelled') return <XCircle className="h-4 w-4 shrink-0 text-slate-400" aria-label="Stopped" />;
  return <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-label="Failed" />;
}
