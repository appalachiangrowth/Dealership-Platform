'use client';

/**
 * Facebook progress at the top of EVERY Dealer Portal page: shown while a group / Page post or a Marketplace listing
 * runs on the server (also after the "Post to Facebook" popup was closed), then a short "Done" summary.
 * It asks the server every 2 s while something runs and every 20 s otherwise ("peek": it never keeps an idle
 * Facebook browser awake). The popup announces a new post with the "fb-activity" event so the bar shows at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Store, X, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { FacebookIcon, fb, type FbJob } from '@/lib/facebook';
import { cx } from '@/components/ui';

type Live = {
  job: FbJob | null;
  mp: { active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[]; running: boolean };
};

/** call after starting a post / Marketplace listing: the bar at the top shows it straight away */
export function announceFbActivity() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fb-activity'));
}

const ENDED = ['done', 'failed', 'skipped', 'cancelled', 'not posted'];

export function FbActivityBar({ enabled }: { enabled: boolean }) {
  const [live, setLive] = useState<Live | null>(null);
  const [doneJob, setDoneJob] = useState<FbJob | null>(null); // finished run shown for a few seconds
  const [mpDone, setMpDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [stopping, setStopping] = useState(false);
  const seenRunning = useRef<{ job: string | null; mp: boolean }>({ job: null, mp: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const off = useRef(false); // feature switched off / no permission: stop asking

  const poll = useCallback(async () => {
    if (off.current) return null;
    try {
      const s = await api<Live>('/dealer/facebook/state?log=999999999&peek=1');
      if (!alive.current) return null;
      setLive({ job: s.job, mp: s.mp });
      // a run that was running and is now finished → show its summary for a moment
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
      const mpBusy = !!s.mp.active || s.mp.queue.length > 0 || s.mp.running;
      if (mpBusy) {
        seenRunning.current.mp = true;
        setMpDone(false);
      } else if (seenRunning.current.mp) {
        seenRunning.current.mp = false;
        setMpDone(true);
        setHidden(false);
        setTimeout(() => alive.current && setMpDone(false), 12000);
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
      const busy = !!s && (s.job?.status === 'running' || !!s.mp.active || s.mp.queue.length > 0 || s.mp.running);
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

  if (!enabled || !live) return null;
  const job = live.job;
  const running = job?.status === 'running';
  const mpBusy = !!live.mp.active || live.mp.queue.length > 0 || live.mp.running;
  if (!running && !mpBusy && !doneJob && !mpDone) return null;
  if (hidden && !running && !mpBusy) return null;

  const shown = running ? job : doneJob;
  const total = shown?.total || 0;
  const okN = shown ? shown.results.filter((r) => r.status === 'done').length : 0;
  const endN = shown ? shown.results.filter((r) => ENDED.includes(r.status)).length : 0;
  const failN = shown ? shown.results.filter((r) => r.status === 'failed' || r.status === 'skipped').length : 0;
  const current = running ? job!.results.find((r) => r.status === 'running' || r.status === 'retry') : null;
  const nextIn = running && job!.nextAt ? Math.max(0, Math.round((job!.nextAt - Date.now()) / 1000)) : 0;
  const waitingForMp = running && job!.results.every((r) => r.status === 'waiting') && !!live.mp.active;
  const mpWaiting = live.mp.queue.length;

  const stop = async () => {
    setStopping(true);
    try {
      await fb.post('stop');
      void poll();
    } catch {
      /* the popup / FB Poster shows errors */
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="sticky top-0 z-20 border-b border-blue-200 bg-white/95 shadow-sm backdrop-blur">
      {shown && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-8">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#1877F2] text-white">
            <FacebookIcon className="h-3.5 w-3.5" />
          </span>
          {running ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#1877F2]" /> : failN ? <XCircle className="h-4 w-4 shrink-0 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
          <b className="text-slate-900">
            {waitingForMp
              ? 'Waiting for the Marketplace listing, then posting to the groups…'
              : running
                ? `Posting to Facebook… ${okN} of ${total} posted`
                : shown.cancelled
                  ? `Posting stopped · ${okN} of ${total} posted`
                  : `Facebook posting done · ${okN} of ${total} posted${failN ? ` · ${failN} not posted` : ''}`}
          </b>
          {running && current && <span className="min-w-0 truncate text-xs text-slate-500">now: {current.name || current.url}</span>}
          {running && !current && nextIn > 0 && <span className="text-xs text-slate-500">next in {nextIn}s</span>}
          <span className="ml-auto flex items-center gap-2">
            <Link href="/dealer/facebook" className="text-xs font-semibold text-blue-700 hover:underline">
              Details
            </Link>
            {running ? (
              <button onClick={stop} disabled={stopping} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {stopping ? 'Stopping…' : 'Stop'}
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
      {(mpBusy || mpDone) && (
        <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-8', shown && 'border-t border-slate-100')}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#0B5CD5] text-white">
            <Store className="h-3.5 w-3.5" />
          </span>
          {mpBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#0B5CD5]" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
          <b className="text-slate-900">
            {mpBusy
              ? live.mp.active
                ? `Marketplace: ${live.mp.active.action === 'publish' ? 'listing a vehicle' : 'updating a listing'}…`
                : 'Marketplace: starting…'
              : 'Marketplace: finished'}
          </b>
          {mpBusy && mpWaiting > 0 && <span className="text-xs text-slate-500">{mpWaiting} more waiting</span>}
          <span className="ml-auto flex items-center gap-2">
            <Link href="/dealer/facebook/marketplace" className="text-xs font-semibold text-blue-700 hover:underline">
              {mpBusy ? 'Details' : 'See the result'}
            </Link>
            {!mpBusy && (
              <button onClick={() => setHidden(true)} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Hide">
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
          {mpBusy && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-[#0B5CD5]" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
