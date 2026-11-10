'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Clock, History, Loader2, Pause, Store, X } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { useFb, type FbResult } from '@/lib/facebook';
import { cx } from '@/components/ui';
import { FbActivity } from '@/components/fb/FbChrome';

type Run = { id: string; caption: string; media: number; ok: number; failed: number; cancelled: boolean; startedAt: string; finishedAt: string | null; results: FbResult[] };

const CARD = 'rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]';
const HD = 'flex flex-wrap items-center gap-3 border-b border-[#E5E9F0] px-5 py-4';
const TH = 'whitespace-nowrap px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.04em] text-[#526077]';
const TD = 'border-t border-[#EEF1F6] p-3.5 align-middle';
const SLOW = /timeout|timed out|did not open|navigation|took more than/i;

const when = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
/** first line of the post text = the vehicle (the text is written from it) */
const titleOf = (r: Run) => r.caption.split('\n').find((x) => x.trim())?.trim() || `${r.media} photo${r.media === 1 ? '' : 's'}`;

function friendly(r: FbResult): string {
  if (r.status === 'done') return r.note && r.note !== 'posted' ? `Posted (${r.note})` : 'Posted';
  if (r.status === 'running') return 'Posting now…';
  if (r.status === 'retry') return 'Trying again…';
  if (r.status === 'waiting') return 'Waiting for its turn';
  if (r.status === 'cancelled') return 'Stopped before it was posted';
  if (r.status === 'not posted') return 'Not posted (the run stopped earlier)';
  if (r.error && SLOW.test(r.error)) return `Facebook was slow to open this Page, so we stopped waiting. Trying again normally works. (${r.error})`;
  return r.error || 'Not posted';
}

/** FB Poster › Posting history: every run, what happened on each Page, and the activity log. */
export default function FbHistoryPage() {
  const { state } = useFb();
  const history = useApi<{ runs: Run[] }>('/dealer/facebook/history');
  const [sel, setSel] = useState<string | null>(null);

  // a run that just finished shows its final result
  const job = state?.job;
  const lastStatus = useRef(job?.status);
  useEffect(() => {
    if (lastStatus.current === 'running' && job?.status === 'finished') void history.reload();
    lastStatus.current = job?.status;
  }, [job?.status, history]);

  // the running run shows its live progress
  const runs: (Run & { running?: boolean })[] = useMemo(() => {
    const list = history.data?.runs || [];
    return list.map((r) =>
      job && job.runId === r.id && job.status === 'running'
        ? { ...r, results: job.results, ok: job.results.filter((x) => x.status === 'done').length, failed: job.results.filter((x) => x.status === 'failed').length, running: true }
        : r,
    );
  }, [history.data, job]);
  const run = runs.find((r) => r.id === sel) || runs[0] || null;
  const mpBusy = !!state?.mp && (!!state.mp.active || state.mp.queue.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {mpBusy && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-[#DBE7FE] bg-[#EFF6FF] px-3.5 py-3 text-[13px] text-[#1E3A8A]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="flex-1">
            <b>Marketplace:</b> {state?.mp.active ? 'filling in a listing now' : 'waiting to start'}
            {state?.mp.queue.length ? ` · ${state.mp.queue.length} more in the queue` : ''}. Every step shows in the activity log below.
          </span>
          <Link href="/dealer/facebook/marketplace" className="inline-flex items-center gap-1 font-semibold text-[#1D4ED8] hover:underline">
            <Store className="h-4 w-4" /> Marketplace
          </Link>
        </div>
      )}

      <section aria-labelledby="act-h" className={CARD}>
        <div className={HD}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#EAF1FF] text-[#1D4ED8]">
            <History className="h-[18px] w-[18px]" />
          </span>
          <div className="flex flex-1 flex-col">
            <h2 id="act-h" className="m-0 text-base font-bold text-[#0F172A]">
              Recent posting
            </h2>
            <span className="text-[13px] text-[#526077]">Select a run to see what happened on each Page.</span>
          </div>
        </div>

        {history.loading && !history.data ? (
          <p className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-[#526077]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : !runs.length ? (
          <p className="px-5 py-10 text-center text-sm text-[#526077]">
            No posts yet.{' '}
            <Link href="/dealer/facebook" className="font-semibold text-[#1D4ED8] hover:underline">
              Create your first post →
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap">
            <div className="min-w-0 flex-[1.2_1_420px] overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#F8FAFC]">
                    <th className={TH}>When</th>
                    <th className={TH}>Vehicle</th>
                    <th className={TH}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const on = run?.id === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSel(r.id)}
                        className={cx('cursor-pointer hover:bg-[#F8FAFC]', on && 'bg-[#F5F8FF] shadow-[inset_3px_0_0_#2563EB]')}
                      >
                        <td className={cx(TD, 'whitespace-nowrap text-[13px] text-[#334155]')}>{when(r.startedAt)}</td>
                        <td className={TD}>
                          <button type="button" onClick={() => setSel(r.id)} className="max-w-[320px] truncate text-left text-sm font-semibold text-[#0F172A] hover:underline">
                            {titleOf(r)}
                          </button>
                        </td>
                        <td className={TD}>
                          <span className="flex flex-wrap gap-1.5">
                            {(r.running || (!r.finishedAt && !r.cancelled)) && (
                              <span className="whitespace-nowrap rounded-full bg-[#EAF1FF] px-2.5 py-[3px] text-xs font-semibold text-[#1D4ED8]">Posting now…</span>
                            )}
                            {r.ok > 0 && <span className="whitespace-nowrap rounded-full bg-[#E8F7EE] px-2.5 py-[3px] text-xs font-semibold text-[#15803D]">{r.ok} posted</span>}
                            {r.failed > 0 && <span className="whitespace-nowrap rounded-full bg-[#FEE2E2] px-2.5 py-[3px] text-xs font-semibold text-[#B91C1C]">{r.failed} failed</span>}
                            {r.cancelled && <span className="whitespace-nowrap rounded-full bg-[#F1F5F9] px-2.5 py-[3px] text-xs font-semibold text-[#475569]">Stopped</span>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {run && (
              <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 border-t border-[#E5E9F0] px-5 py-[18px] lg:border-l lg:border-t-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-bold text-[#0F172A]">{titleOf(run)}</span>
                  <span className="text-[13px] text-[#526077]">
                    {when(run.startedAt)} · {run.running ? 'Posting now' : `${run.ok} posted, ${run.failed} failed${run.cancelled ? ' (stopped)' : ''}`}
                    {run.media ? ` · ${run.media} photo${run.media === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
                {run.failed > 0 && (
                  <div className="flex items-start gap-2.5 rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-3 text-[13px] text-[#78350F]">
                    <span>
                      Some Pages were not posted. This usually means Facebook was slow or asked for a check. Post the vehicle again from{' '}
                      <Link href="/dealer/facebook" className="font-semibold text-[#1D4ED8] hover:underline">
                        Create a post
                      </Link>
                      ; the activity log below shows each step.
                    </span>
                  </div>
                )}
                <div className="flex flex-col">
                  {run.results.map((it, i) => {
                    const ok = it.status === 'done';
                    const bad = it.status === 'failed' || it.status === 'skipped';
                    const busy = it.status === 'running' || it.status === 'retry';
                    return (
                      <div key={it.url + i} className="flex items-start gap-2.5 border-b border-[#EEF1F6] py-2.5 last:border-0">
                        <span
                          className={cx(
                            'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full',
                            ok ? 'bg-[#E8F7EE] text-[#15803D]' : bad ? 'bg-[#FEE2E2] text-[#B91C1C]' : busy ? 'bg-[#EAF1FF] text-[#1D4ED8]' : 'bg-[#F1F5F9] text-[#475569]',
                          )}
                        >
                          {ok ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : bad ? <X className="h-3.5 w-3.5" strokeWidth={2.6} /> : busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : it.status === 'waiting' ? <Clock className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold text-[#0F172A]">{it.name || it.url}</span>
                          <span className={cx('text-[12.5px]', bad ? 'text-[#B91C1C]' : 'text-[#526077]')}>{friendly(it)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* the activity log: every step of the Page posts and the Marketplace listings */}
      <FbActivity />
    </div>
  );
}
