'use client';

/**
 * "Post to Facebook" popup for one vehicle — used by the Inventory table (FB button / Publish) and the
 * vehicle editor (right after "Publish vehicle").
 *  · groups & Page: a saved collection (tick it → its groups) and/or groups ticked by hand
 *  · Facebook Marketplace: a separate button when the vehicle has every Marketplace field (lib/marketplace)
 *  · after "Post", the popup stays open and shows the live progress at the top ("2 of 5 posted …")
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, ImageIcon, Loader2, Store, XCircle } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useToast } from '@/components/toast';
import { Button, Input, Modal, cx } from '@/components/ui';
import { money, vehicleName } from '@/lib/format';
import { FacebookIcon, fb, getSavedFbPostingConfig, saveFbPostingConfig, type FbItem, type FbJob, type FbPostingConfig } from '@/lib/facebook';
import { mpMissing, MP_FIX } from '@/lib/marketplace';

type FbCollection = { id: string; name: string; page: { url?: string; name?: string } | null; includePage: boolean; items: FbItem[] };
type FbAccountView = { actingAs?: { url?: string; name?: string }; pages?: FbItem[]; groups?: FbItem[] };
type LiveState = {
  job: FbJob | null;
  mp: { active: { vehicleId: string; action: string } | null; queue: { id: string; action: string }[]; running: boolean };
};
type MpListing = { status: string; url: string; error: string };

const MP_STATUS: Record<string, string> = {
  queued: 'Waiting in the Marketplace queue…',
  publishing: 'Filling in the Marketplace form…',
  awaiting_publish: 'Needs you: open FB Poster and click Publish',
  published: 'Listed on Marketplace',
  unconfirmed: 'Publish clicked — listing link not found yet',
  failed: 'Marketplace listing failed',
};

export function FbPostModal({ vehicle, onClose, intro }: { vehicle: any | null; onClose: () => void; intro?: React.ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const v = vehicle;

  const [cfg, setCfg] = useState<FbPostingConfig | null>(null);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [loadingText, setLoadingText] = useState(false);
  const [cols, setCols] = useState<FbCollection[]>([]);
  const [account, setAccount] = useState<FbAccountView | null>(null);
  const [colIds, setColIds] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [includePage, setIncludePage] = useState(true);
  const [pageTarget, setPageTarget] = useState<FbItem | null>(null);
  const [find, setFind] = useState('');
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [mpPosting, setMpPosting] = useState(false);

  // live progress (popup stays open while it runs)
  const [runId, setRunId] = useState<string | null>(null); // '' = started, id not known yet
  const [mpStarted, setMpStarted] = useState(false);
  const [live, setLive] = useState<LiveState | null>(null);
  const [mpListing, setMpListing] = useState<MpListing | null>(null);
  const [stopping, setStopping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ───── open: texts, saved choice, collections & groups ───── */
  useEffect(() => {
    if (!v) return;
    const saved = getSavedFbPostingConfig();
    setCfg(saved);
    setRunId(null);
    setMpStarted(false);
    setLive(null);
    setMpListing(null);
    setFind('');
    setColIds(new Set(saved?.collection?.id ? [saved.collection.id] : []));
    setSel(new Set((saved?.groups || []).map((g) => g.url)));
    setIncludePage(saved ? saved.includePage !== false : true);
    setPageTarget(saved?.page || null);

    const name = vehicleName(v);
    const priceStr = v.price ? money(v.price) : '';
    const milesStr = v.mileage ? `${(Number(v.mileage) || 0).toLocaleString()} miles` : '';
    setCaption(`🚗 ${name}\n${priceStr ? `💰 Price: ${priceStr}\n` : ''}${milesStr ? `📍 Mileage: ${milesStr}\n` : ''}Stock #: ${v.stockNumber || '—'}\n\nCall or visit us today!`);
    setHashtags(saved?.hashtags || '#carsforsale #usedcars');
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

    setTargetsLoading(true);
    Promise.all([
      fb.get<{ quickPost: FbPostingConfig; account: FbAccountView }>('quick-config').catch(() => null),
      fb.get<{ collections: FbCollection[] }>('collections').catch(() => null),
    ])
      .then(([q, c]) => {
        const acc = q?.account || null;
        setAccount(acc);
        setCols(c?.collections || []);
        if (!saved && q?.quickPost?.configured) {
          // first time on this browser: the choice saved in FB Poster
          const qp = q.quickPost;
          setCfg(qp);
          setColIds(new Set(qp.collection?.id ? [qp.collection.id] : []));
          setSel(new Set((qp.groups || []).map((g) => g.url)));
          setIncludePage(qp.includePage !== false);
          if (qp.page) setPageTarget(qp.page);
        }
        if (!saved?.page && !q?.quickPost?.page && acc?.actingAs?.url) setPageTarget({ url: acc.actingAs.url, name: acc.actingAs.name || acc.actingAs.url });
      })
      .finally(() => setTargetsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id]);

  /* ───── live progress: poll the FB Poster state while a post / Marketplace listing runs ───── */
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

  /* ───── targets ───── */
  const allGroups: FbItem[] = (() => {
    const seen = new Map<string, FbItem>();
    for (const g of [...(account?.groups || []), ...(cfg?.groups || []), ...cols.flatMap((c) => c.items || [])]) if (g?.url && !seen.has(g.url)) seen.set(g.url, g);
    return [...seen.values()];
  })();
  const inCollections = new Set(cols.filter((c) => colIds.has(c.id)).flatMap((c) => (c.items || []).map((g) => g.url)));
  const other = allGroups.filter((g) => !inCollections.has(g.url));
  const shown = find.trim() ? other.filter((g) => (g.name + ' ' + g.url).toLowerCase().includes(find.trim().toLowerCase())) : other;

  const toggleCollection = (id: string) => {
    const c = cols.find((x) => x.id === id);
    if (!c) return;
    const on = !colIds.has(id);
    const next = new Set(colIds);
    if (on) next.add(id);
    else next.delete(id);
    setColIds(next);
    const still = new Set(cols.filter((x) => next.has(x.id)).flatMap((x) => (x.items || []).map((g) => g.url)));
    setSel((s) => {
      const n = new Set(s);
      for (const g of c.items || []) {
        if (on) n.add(g.url);
        else if (!still.has(g.url)) n.delete(g.url);
      }
      return n;
    });
    if (on && c.page?.url) {
      setPageTarget({ url: c.page.url, name: c.page.name || c.page.url });
      setIncludePage(c.includePage !== false);
    }
  };
  const toggleGroup = (url: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const missing = mpMissing(v);
  const mpReady = !!v && !missing.length;
  const targetCount = sel.size + (includePage && pageTarget ? 1 : 0);

  /* ───── actions ───── */
  async function postToGroups() {
    if (!v) return;
    const targets: string[] = [];
    const names: Record<string, string> = {};
    if (includePage && pageTarget?.url) {
      targets.push(pageTarget.url);
      names[pageTarget.url] = pageTarget.name || pageTarget.url;
    }
    const chosen = allGroups.filter((g) => sel.has(g.url));
    for (const g of chosen)
      if (g.url && !targets.includes(g.url)) {
        targets.push(g.url);
        names[g.url] = g.name || g.url;
      }
    if (!targets.length) {
      toast.error('Choose a collection or tick at least one group.');
      return;
    }
    if (!(v.images || []).length) {
      toast.error('Add at least one photo to this vehicle first.');
      return;
    }

    // remember the choice for the next vehicle (same settings as FB Poster)
    const col = cols.find((c) => colIds.has(c.id)) || null;
    const next = {
      ...(cfg || { delayMin: 45, delayMax: 90 }),
      configured: true,
      page: includePage && pageTarget ? pageTarget : cfg?.page || null,
      includePage,
      groups: chosen,
      collection: col ? { id: col.id, name: col.name } : null,
      hashtags,
      updatedAt: new Date().toISOString(),
    } as FbPostingConfig;
    setCfg(next);
    saveFbPostingConfig(next);
    void fb.put('quick-config', next).catch(() => {});

    setPosting(true);
    try {
      const form = new FormData();
      form.append('targets', JSON.stringify(targets));
      form.append('names', JSON.stringify(names));
      form.append('order', JSON.stringify((v.images || []).map((u: string) => `v:${u}`)));
      form.append('caption', caption || vehicleName(v));
      form.append('hashtags', hashtags || '');
      form.append('delayMin', String(next.delayMin || 45));
      form.append('delayMax', String(next.delayMax || 90));
      const r = await api<{ runId?: string; job?: FbJob }>('/dealer/facebook/post', { method: 'POST', form });
      setRunId(r?.runId || r?.job?.runId || '');
      setLive((l) => ({ job: r?.job || l?.job || null, mp: l?.mp || { active: null, queue: [], running: false } }));
      void poll();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to start the Facebook post.');
    } finally {
      setPosting(false);
    }
  }

  async function postToMarketplace() {
    if (!v || !mpReady) return;
    setMpPosting(true);
    try {
      const r = await fb.post<{ queued: number; rejected: { id: string; error: string }[] }>('mp/publish', { ids: [v.id] });
      if (r.queued) {
        setMpListing(null);
        setMpStarted(true);
        void poll();
      } else toast.error(`Marketplace: ${r.rejected?.[0]?.error || 'could not be queued'}`);
    } catch (e) {
      toast.error(`Marketplace: ${(e as Error).message}`);
    } finally {
      setMpPosting(false);
    }
  }

  async function stop() {
    setStopping(true);
    try {
      await fb.post('stop');
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
  const ENDED = ['done', 'failed', 'skipped', 'cancelled', 'not posted'];
  const doneN = job ? job.results.filter((x) => ENDED.includes(x.status)).length : 0;
  const okN = job ? job.results.filter((x) => x.status === 'done').length : 0;
  const total = job?.total || 0;
  const mpQueuePos = live?.mp.queue.findIndex((q) => q.id === v?.id) ?? -1;
  const mpActive = live?.mp.active?.vehicleId === v?.id;
  const mpBusy = mpStarted && !mpListing;
  const mpText = mpListing ? MP_STATUS[mpListing.status] || `Marketplace: ${mpListing.status}` : mpActive ? 'Filling in the Marketplace form…' : mpQueuePos >= 0 ? `Waiting in the Marketplace queue (#${mpQueuePos + 1})…` : 'Starting…';
  const nextIn = job?.nextAt ? Math.max(0, Math.round((job.nextAt - Date.now()) / 1000)) : 0;
  const busy = jobRunning || mpBusy;

  const progress = (runId !== null || mpStarted) && (
    <div className="space-y-2">
      {runId !== null && (
        <div className={cx('rounded-xl border p-3', jobRunning ? 'border-blue-200 bg-blue-50/70' : job && job.failed ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
          <div className="flex items-center gap-2 text-sm">
            {jobRunning ? <Loader2 className="h-4 w-4 animate-spin text-[#1877F2]" /> : <CheckCircle2 className={cx('h-4 w-4', job && job.failed ? 'text-amber-600' : 'text-emerald-600')} />}
            <b className="flex-1 text-slate-900">
              {jobRunning ? `Posting to Facebook… ${okN} of ${total || '…'} posted` : job?.cancelled ? `Stopped · ${okN} of ${total} posted` : `Done · ${okN} of ${total} posted${job?.failed ? ` · ${job.failed} failed` : ''}`}
            </b>
            {jobRunning && (
              <Button size="sm" variant="ghost" loading={stopping} onClick={stop}>
                Stop
              </Button>
            )}
          </div>
          {total > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-[#1877F2] transition-all" style={{ width: `${Math.round((doneN / total) * 100)}%` }} />
            </div>
          )}
          {jobRunning && nextIn > 0 && <p className="mt-1.5 text-[11px] text-slate-500">Next post in {nextIn}s (a pause between groups keeps the account safe).</p>}
          {job && job.results.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
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
      onClose={() => !posting && !mpPosting && onClose()}
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
            <Button variant="ghost" onClick={onClose} disabled={posting || mpPosting}>
              {busy ? 'Close (keeps posting)' : runId !== null || mpStarted ? 'Close' : 'Cancel'}
            </Button>
            {runId === null && (
              <Button
                className="border-transparent bg-[#1877F2] font-bold text-white hover:bg-[#166fe5]"
                loading={posting}
                disabled={!targetCount || mpPosting}
                onClick={postToGroups}
                title="Post to the ticked groups and Page"
              >
                <FacebookIcon className="mr-1.5 h-3.5 w-3.5" />
                Post to Facebook{targetCount ? ` (${targetCount})` : ''}
              </Button>
            )}
            {mpReady && !mpStarted && (
              <Button
                className="border-transparent bg-[#0B5CD5] font-bold text-white hover:bg-[#0a4fb8]"
                loading={mpPosting}
                disabled={posting}
                onClick={postToMarketplace}
                title="List this vehicle on Facebook Marketplace (posted automatically)"
              >
                <Store className="mr-1.5 h-3.5 w-3.5" />
                Post to Facebook Marketplace
              </Button>
            )}
          </div>
        </div>
      }
    >
      {v && (
        <div className="space-y-4">
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

          {/* Marketplace */}
          {!mpStarted &&
            (mpReady ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-xs">
                <Store className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <span className="min-w-0 flex-1">
                  <b className="block text-sm text-slate-900">Marketplace ready</b>
                  <span className="text-slate-600">
                    Every Marketplace field is filled in. Press <b>Post to Facebook Marketplace</b> below and it is listed automatically.
                  </span>
                </span>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
                <b className="block text-slate-800">Not ready for Marketplace</b>
                <span className="text-slate-500">Missing: </span>
                {missing.map((m, i) => (
                  <span key={m}>
                    {i > 0 && ', '}
                    <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => goEdit(MP_FIX[m])}>
                      {m}
                    </button>
                  </span>
                ))}
                <span className="text-slate-500">. You can still post it to your groups.</span>
              </div>
            ))}

          {/* groups — hidden once the post has started (the progress above shows them) */}
          {runId === null &&
            (targetsLoading && !allGroups.length ? (
              <p className="py-6 text-center text-xs text-slate-400">Loading your collections and groups…</p>
            ) : !allGroups.length && !pageTarget ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <b>No groups loaded yet</b>
                <p className="mt-1 text-xs text-amber-800">Open FB Poster, choose the Page you post as and click “Load groups”. They will show up here.</p>
              </div>
            ) : (
              <>
                {cols.length > 0 && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Collections</label>
                    <div className="space-y-1.5">
                      {cols.map((c) => {
                        const on = colIds.has(c.id);
                        const n = c.items?.length || 0;
                        const picked = (c.items || []).filter((g) => sel.has(g.url)).length;
                        return (
                          <div key={c.id} className={cx('overflow-hidden rounded-lg border transition', on ? 'border-[#1877F2] bg-blue-50/40' : 'border-slate-200')}>
                            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs hover:bg-slate-50">
                              <input type="checkbox" className="h-4 w-4 accent-[#1877F2]" checked={on} onChange={() => toggleCollection(c.id)} />
                              <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">{c.name}</span>
                              <span className="shrink-0 text-[11px] text-slate-500">
                                {on ? `${picked} of ${n}` : n} group{n === 1 ? '' : 's'}
                                {c.includePage && c.page?.name ? ` + ${c.page.name}` : ''}
                              </span>
                            </label>
                            {on && (
                              <div className="max-h-36 overflow-y-auto border-t border-blue-100 bg-white py-1 pl-8 pr-3">
                                {(c.items || []).map((g) => (
                                  <label key={g.url} className="flex cursor-pointer items-center gap-2.5 py-1 text-xs" title={g.url}>
                                    <input type="checkbox" className="h-3.5 w-3.5 accent-[#1877F2]" checked={sel.has(g.url)} onChange={() => toggleGroup(g.url)} />
                                    <span className="min-w-0 flex-1 truncate text-slate-700">{g.name || g.url}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {pageTarget && (
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                    <input type="checkbox" className="h-4 w-4 accent-[#1877F2]" checked={includePage} onChange={(e) => setIncludePage(e.target.checked)} />
                    <span className="min-w-0 flex-1 truncate">
                      Also post on the Page <b className="text-slate-800">{pageTarget.name || pageTarget.url}</b>
                    </span>
                  </label>
                )}

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-600">
                      {colIds.size ? 'Other groups' : 'Groups'}
                      {account?.actingAs?.name ? <span className="font-normal text-slate-400"> of {account.actingAs.name}</span> : null}
                    </label>
                    <span className="flex items-center gap-2 text-[11px]">
                      <b className="text-slate-700">{sel.size} selected in total</b>
                      <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => setSel(new Set(shown.map((g) => g.url).concat([...sel])))}>
                        All
                      </button>
                      <button
                        type="button"
                        className="font-semibold text-slate-500 hover:underline"
                        onClick={() => {
                          setColIds(new Set());
                          setSel(new Set());
                        }}
                      >
                        None
                      </button>
                    </span>
                  </div>
                  {allGroups.length > 6 && <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Search ${allGroups.length} groups…`} className="mb-1.5 h-8 text-xs" />}
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200">
                    {shown.length ? (
                      shown.map((g) => (
                        <label key={g.url} className="flex cursor-pointer items-center gap-2.5 border-b border-slate-100 px-3 py-1.5 text-xs last:border-0 hover:bg-slate-50" title={g.url}>
                          <input type="checkbox" className="h-3.5 w-3.5 accent-[#1877F2]" checked={sel.has(g.url)} onChange={() => toggleGroup(g.url)} />
                          <span className="min-w-0 flex-1 truncate text-slate-700">{g.name || g.url}</span>
                        </label>
                      ))
                    ) : (
                      <p className="px-3 py-3 text-center text-xs text-slate-400">{find.trim() ? `No group matches “${find}”.` : 'All your groups are in the ticked collections.'}</p>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">Post text</span>
                    {loadingText && <span className="text-slate-400">Loading…</span>}
                  </div>
                  <div className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700">
                    {caption}
                    {hashtags ? `\n\n${hashtags}` : ''}
                  </div>
                </div>
              </>
            ))}
        </div>
      )}
    </Modal>
  );
}
