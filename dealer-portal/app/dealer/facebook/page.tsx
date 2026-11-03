'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, RefreshCw, Search, Plus, X, Star, ArrowLeft, ArrowRight, Play, Square, Upload, Film, CheckCircle2, XCircle, Clock, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { api, mediaUrl } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { fb, useFb, type FbItem, type FbResult } from '@/lib/facebook';
import { Badge, Button, Card, Field, Input, Modal, Select, Textarea, Toggle, cx } from '@/components/ui';
import { useToast } from '@/components/toast';
import { FbActivity } from '@/components/fb/FbChrome';

type Collection = { id: string; name: string; page: { url?: string; name?: string }; includePage: boolean; items: FbItem[]; updatedAt: string };
type Run = { id: string; caption: string; media: number; ok: number; failed: number; cancelled: boolean; startedAt: string; finishedAt: string | null; results: FbResult[] };
type MpVehicle = { id: string; title: string; status: string; stock: string; photos: number };
type Media = { key: string; kind: 'file' | 'vehicle'; file?: File; url: string; preview: string; video: boolean };

const EMOJI = ['🚗', '🔥', '✅', '💯', '📞', '📍', '💰', '⭐', '👉', '🎉', '⚡', '🛞'];
const FB_LINK = /^https:\/\/(www\.|m\.|web\.)?facebook\.com\/.+/i;

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

export default function FbGroupsPage() {
  const { state, refresh } = useFb();
  const toast = useToast();
  const account = state?.account;
  const cols = useApi<{ collections: Collection[] }>('/dealer/facebook/collections');
  const history = useApi<{ runs: Run[] }>('/dealer/facebook/history');
  const vehicles = useApi<{ vehicles: MpVehicle[] }>('/dealer/facebook/mp/vehicles');

  const [loading, setLoading] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [link, setLink] = useState('');
  const [pageLink, setPageLink] = useState('');
  const [pageTarget, setPageTarget] = useState<FbItem | null>(null);
  const [includePage, setIncludePage] = useState(true);
  const [activeCol, setActiveCol] = useState<Collection | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [colName, setColName] = useState('');

  const [media, setMedia] = useState<Media[]>([]);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [delayMin, setDelayMin] = useState(45);
  const [delayMax, setDelayMax] = useState(90);
  const [vehicleId, setVehicleId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(Date.now());

  const groups = useMemo(() => account?.groups || [], [account?.groups]);
  const pages = account?.pages || [];
  const job = state?.job;
  const running = job?.status === 'running';

  // the Page this login posts as is the default "post on the Page first" target
  const actingUrl = account?.actingAs?.url || '';
  const actingName = account?.actingAs?.name || '';
  const lastActing = useRef('');
  useEffect(() => {
    if (actingUrl === lastActing.current) return;
    lastActing.current = actingUrl;
    setPageTarget(actingUrl ? { url: actingUrl, name: actingName || actingUrl } : null);
  }, [actingUrl, actingName]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // a finished run shows up in the history
  const lastStatus = useRef(job?.status);
  useEffect(() => {
    if (lastStatus.current === 'running' && job?.status === 'finished') void history.reload();
    lastStatus.current = job?.status;
  }, [job?.status, history]);

  const shown = groups.filter((g) => !search || (g.name + ' ' + g.url).toLowerCase().includes(search.toLowerCase()));
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of [...pages, ...groups]) m[x.url] = x.name;
    if (pageTarget) m[pageTarget.url] = pageTarget.name;
    return m;
  }, [pages, groups, pageTarget]);

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

  const toggle = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  const saveTargets = (next: { pages?: FbItem[]; groups?: FbItem[] }) => fb.put('targets', next);

  const addLink = () =>
    run('add', async () => {
      const url = link.trim();
      if (!FB_LINK.test(url)) throw new Error('Paste a Facebook group or Page link (https://www.facebook.com/…)');
      if (!groups.some((g) => g.url === url)) await saveTargets({ groups: [{ name: url.replace(/^https:\/\/(www\.)?facebook\.com\//, '').replace(/\/$/, ''), url }, ...groups] });
      setSelected((s) => new Set(s).add(url));
      setLink('');
    });

  const removeGroup = (url: string) =>
    run('remove', async () => {
      await saveTargets({ groups: groups.filter((g) => g.url !== url) });
      setSelected((s) => {
        const n = new Set(s);
        n.delete(url);
        return n;
      });
    });

  const switchPage = (p: FbItem) =>
    run(
      'switch:' + p.url,
      async () => {
        const r = await fb.post<{ verified: boolean }>('pages/switch', p);
        setPageTarget(p);
        if (!r.verified) toast.error('Could not confirm the switch. Open "Show browser" and check the profile picture at the top-right.');
      },
      `Now posting as ${p.name}`,
    );

  const applyCollection = (c: Collection) => {
    setActiveCol(c);
    setSelected(new Set(c.items.map((i) => i.url)));
    if (c.page?.url) setPageTarget({ url: c.page.url, name: c.page.name || c.page.url });
    setIncludePage(c.includePage);
    // groups of a collection that are not in the list any more are shown again
    const missing = c.items.filter((i) => !groups.some((g) => g.url === i.url));
    if (missing.length) void saveTargets({ groups: [...groups, ...missing] }).then(refresh);
  };

  const saveCollection = (update: boolean) =>
    run(
      'col',
      async () => {
        const items = groups.filter((g) => selected.has(g.url));
        const body = { name: update && activeCol ? activeCol.name : colName, items, page: pageTarget || {}, includePage };
        const saved = update && activeCol ? await fb.put<Collection>(`collections/${activeCol.id}`, body) : await fb.post<Collection>('collections', body);
        setActiveCol(saved);
        setSaveOpen(false);
        setColName('');
        await cols.reload();
      },
      'Collection saved.',
    );

  const deleteCollection = (c: Collection) =>
    run('col', async () => {
      await fb.del(`collections/${c.id}`);
      if (activeCol?.id === c.id) setActiveCol(null);
      await cols.reload();
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

  const targets = [...(includePage && pageTarget ? [pageTarget.url] : []), ...groups.filter((g) => selected.has(g.url)).map((g) => g.url)];

  const start = () =>
    run(
      'post',
      async () => {
        if (!targets.length) throw new Error('Tick at least one group (or a Page).');
        if (!caption.trim() && !hashtags.trim() && !media.length) throw new Error('Add a photo/video or write a description.');
        const form = new FormData();
        const order: string[] = [];
        let n = 0;
        for (const m of media) {
          if (m.kind === 'file' && m.file) {
            form.append('media', m.file);
            order.push(`f:${n++}`);
          } else order.push(`v:${m.url}`);
        }
        form.append('targets', JSON.stringify(targets));
        form.append('names', JSON.stringify(Object.fromEntries(targets.map((t) => [t, nameOf[t] || t]))));
        form.append('order', JSON.stringify(order));
        form.append('caption', caption);
        form.append('hashtags', hashtags);
        form.append('delayMin', String(delayMin));
        form.append('delayMax', String(delayMax));
        await api('/dealer/facebook/post', { method: 'POST', form });
      },
      `Posting to ${targets.length} place${targets.length === 1 ? '' : 's'} started. You can close this page; it carries on.`,
    );

  const connected = !!(state?.loggedIn || account?.fbUserId);

  return (
    <div className="space-y-6">
      {!connected && state && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
          <b>Step 1:</b> click <b>Connect Facebook</b> above and log in. <b>Step 2:</b> load your groups (and Pages). <b>Step 3:</b> write the post and press Start.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---------------- where to post ---------------- */}
        <div className="space-y-6">
          <Card
            title="Post as one of your Pages (optional)"
            actions={
              <Button size="sm" variant="secondary" loading={loading === 'pages'} onClick={() => run('pages', () => fb.post('pages/load'))}>
                <RefreshCw className="h-3.5 w-3.5" /> Load my Pages
              </Button>
            }
          >
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">Posting as:</span>
                {account?.actingAs?.name ? (
                  <>
                    <Badge color="violet">{account.actingAs.name}</Badge>
                    <button className="text-xs font-semibold text-slate-500 underline" onClick={() => run('personal', async () => {
                      await fb.post('pages/personal');
                      setPageTarget(null);
                    }, 'The Page is no longer used. If the browser still acts as the Page, switch back with the profile picture at the top-right.')}>
                      use my own profile
                    </button>
                  </>
                ) : (
                  <Badge>your personal profile</Badge>
                )}
              </div>
              {!!pages.length && (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {pages.map((p) => (
                    <li key={p.url} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-slate-700">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <Button size="sm" variant={account?.actingAs?.url === p.url ? 'success' : 'secondary'} loading={loading === 'switch:' + p.url} onClick={() => switchPage(p)}>
                        {account?.actingAs?.url === p.url ? 'In use' : 'Use this Page'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input value={pageLink} onChange={(e) => setPageLink(e.target.value)} placeholder="Page not listed? Paste its link: https://www.facebook.com/YourPage" />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!FB_LINK.test(pageLink.trim())}
                  onClick={() => switchPage({ url: pageLink.trim(), name: '' })}
                >
                  Switch
                </Button>
              </div>
              {pageTarget && (
                <Toggle checked={includePage} onChange={setIncludePage} label={`Post on the Page first (${pageTarget.name})`} desc="Then in the ticked groups. The Page can only post in groups it has joined." />
              )}
            </div>
          </Card>

          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <Users className="h-4 w-4" /> Groups <span className="font-normal text-slate-400">({selected.size} of {groups.length} ticked)</span>
              </span>
            }
            actions={
              <Button size="sm" variant="secondary" loading={loading === 'groups'} onClick={() => run('groups', () => fb.post('groups/load'), 'Groups loaded.')}>
                <RefreshCw className="h-3.5 w-3.5" /> Load my groups
              </Button>
            }
          >
            <div className="space-y-3">
              {!!cols.data?.collections.length && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Collections</div>
                  <div className="flex flex-wrap gap-2">
                    {cols.data.collections.map((c) => (
                      <span
                        key={c.id}
                        className={cx(
                          'inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-xs font-semibold',
                          activeCol?.id === c.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-300 bg-white text-slate-700',
                        )}
                      >
                        <button onClick={() => applyCollection(c)}>
                          {c.name} <span className="font-normal text-slate-400">· {c.items.length}</span>
                        </button>
                        <button onClick={() => deleteCollection(c)} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-red-600" title="Delete collection">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search groups…" className="pl-9" />
                </div>
                <Button size="sm" variant="ghost" onClick={() => setSelected((s) => new Set([...s, ...shown.map((g) => g.url)]))}>
                  Select shown
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-xl border border-slate-200">
                {!groups.length && <div className="px-4 py-8 text-center text-sm text-slate-400">No groups yet. Click “Load my groups” or paste a group link below.</div>}
                {shown.map((g) => (
                  <label key={g.url} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
                    <input type="checkbox" checked={selected.has(g.url)} onChange={() => toggle(g.url)} className="h-4 w-4 accent-blue-700" />
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <a href={g.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-slate-300 hover:text-slate-600">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        removeGroup(g.url);
                      }}
                      className="text-slate-300 hover:text-red-600"
                      title="Remove from the list"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLink()} placeholder="Add a group or Page link: https://www.facebook.com/groups/…" />
                <Button size="sm" variant="secondary" onClick={addLink} loading={loading === 'add'}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <Button size="sm" variant="secondary" disabled={!selected.size} onClick={() => setSaveOpen(true)}>
                  Save ticked as a collection
                </Button>
                {activeCol && (
                  <Button size="sm" variant="ghost" disabled={!selected.size} loading={loading === 'col'} onClick={() => saveCollection(true)}>
                    Update “{activeCol.name}”
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* ---------------- the post ---------------- */}
        <div className="space-y-6">
          <Card title="Your post">
            <div className="space-y-4">
              <Field label="Start from a vehicle (optional)" hint="Fills in the text and the photos from your inventory. You can still change everything.">
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
                        </option>
                      ))}
                  </Select>
                  {loading === 'vehicle' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </div>
              </Field>

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
                  <input ref={fileInput} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }} />
                </div>
              </div>

              <Field label="Description">
                <Textarea ref={captionRef as never} value={caption} onChange={(e) => setCaption(e.target.value)} rows={8} placeholder="Write your post text…" />
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
              <div className="grid grid-cols-2 gap-3">
                <Field label="Wait between posts: min (seconds)">
                  <Input type="number" min={20} max={600} value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))} />
                </Field>
                <Field label="max (seconds)">
                  <Input type="number" min={20} max={900} value={delayMax} onChange={(e) => setDelayMax(Number(e.target.value))} />
                </Field>
              </div>
              <p className="text-xs text-slate-500">Keep 45 seconds or more between posts and post to a few places per run, so Facebook does not block the account.</p>

              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                {running ? (
                  <Button variant="danger" loading={loading === 'stop'} onClick={() => run('stop', () => fb.post('stop'), 'Stopping after the current one.')}>
                    <Square className="h-4 w-4" /> Stop after current
                  </Button>
                ) : (
                  <Button variant="success" loading={loading === 'post'} disabled={!targets.length || !!state?.busy} onClick={start}>
                    <Play className="h-4 w-4" /> Start posting
                  </Button>
                )}
                <span className="text-sm text-slate-500">
                  {targets.length
                    ? `${includePage && pageTarget ? 'Page + ' : ''}${targets.length - (includePage && pageTarget ? 1 : 0)} group${targets.length - (includePage && pageTarget ? 1 : 0) === 1 ? '' : 's'}`
                    : 'Nothing ticked yet'}
                  {state?.busy && !running && ` · busy: ${state.busyWhat}`}
                </span>
              </div>
            </div>
          </Card>

          {job && (
            <Card
              title={running ? `Posting… ${job.results.filter((r) => !['waiting', 'running', 'retry'].includes(r.status)).length} of ${job.total}` : `Last run: ${job.ok} posted, ${job.failed} failed${job.cancelled ? ' (stopped)' : ''}`}
              actions={running && job.nextAt && job.nextAt > now ? <Badge color="blue">next in {Math.ceil((job.nextAt - now) / 1000)}s</Badge> : undefined}
              pad={false}
            >
              <ResultList results={job.results} />
            </Card>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FbActivity />
        <Card title="Recent posting runs" pad={false}>
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {!history.data?.runs.length && <div className="px-5 py-8 text-center text-sm text-slate-400">No posting runs yet.</div>}
            {history.data?.runs.map((r) => (
              <details key={r.id} className="px-5 py-2.5 text-sm">
                <summary className="flex cursor-pointer items-center gap-3">
                  <span className="text-xs text-slate-400">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className="min-w-0 flex-1 truncate">{r.caption.split('\n')[0] || `${r.media} photo(s)`}</span>
                  {r.finishedAt ? (
                    <>
                      <Badge color="green">{r.ok} posted</Badge>
                      {!!r.failed && <Badge color="red">{r.failed} failed</Badge>}
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

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save as a collection"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button loading={loading === 'col'} disabled={!colName.trim()} onClick={() => saveCollection(false)}>
              Save
            </Button>
          </>
        }
      >
        <Field label="Name" hint={`${selected.size} groups${pageTarget && includePage ? ` + the Page ${pageTarget.name}` : ''}. Click the collection later to tick them all again.`}>
          <Input autoFocus value={colName} onChange={(e) => setColName(e.target.value)} placeholder="e.g. Salem car groups" />
        </Field>
      </Modal>
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
              <a href={r.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-slate-800 hover:underline">
                {r.name || r.url}
              </a>
              {(r.error || (r.note && r.note !== 'posted')) && <div className={cx('text-xs', r.error ? 'text-red-600' : 'text-slate-500')}>{r.error || r.note}</div>}
            </div>
            <Badge color={s.color}>{s.text}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

