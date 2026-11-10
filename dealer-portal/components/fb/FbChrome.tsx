'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Megaphone, Store, Monitor, Power, LogOut, Shield, Trash2, ImageIcon, Loader2 } from 'lucide-react';
import { fb, fbFetch, screenshotIn, useFb } from '@/lib/facebook';
import { Badge, Button, Card, Field, Input, Modal, cx } from '../ui';
import { useToast } from '../toast';
import { LiveBrowser } from './LiveBrowser';

/** Header of every FB Poster screen: connection, live browser, tabs. */
export function FbHeader() {
  const { state, error, refresh, viewOpen, setViewOpen } = useFb();
  const toast = useToast();
  const path = usePathname();
  const [busy, setBusy] = useState('');
  const [confirmForget, setConfirmForget] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [proxy, setProxy] = useState('');

  const act = async (what: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(what);
    try {
      await fn();
      if (okText) toast.ok(okText);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  // speed: start Facebook on the server (saved login) as soon as FB Poster opens, not when Post is pressed
  useEffect(() => {
    void fb.post('warm').catch(() => {});
  }, []);

  const connect = () =>
    act('connect', async () => {
      setViewOpen(true);
      const r = await fb.post<{ loggedIn: boolean }>('connect');
      if (r.loggedIn) toast.ok('Facebook is connected.');
    });

  const a = state?.account;
  const loggedIn = state?.loggedIn;
  const known = !!a?.fbUserId;
  const status = !state
    ? { color: 'slate', text: 'Checking…' }
    : loggedIn
      ? { color: 'green', text: 'Connected' }
      : known && !state.browserOpen
        ? { color: 'blue', text: 'Connected (browser asleep)' }
        : state.browserOpen
          ? { color: 'amber', text: 'Waiting for you to log in' }
          : { color: 'slate', text: 'Not connected' };

  const tabs = [
    { href: '/dealer/facebook', label: 'Post', icon: Megaphone },
    { href: '/dealer/facebook/marketplace', label: 'Marketplace', icon: Store },
  ];

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight text-slate-900">FB Poster</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Post your cars on your Facebook Pages and on Marketplace. Your Facebook login runs safely on our server, so nothing needs to be installed on this
            computer, and posting carries on even when you close this page.
          </p>
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition',
                path === t.href ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </Link>
          ))}
        </div>
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1877F2] text-lg font-black text-white">f</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-900">{a?.fbName || (known ? 'Facebook account' : 'Facebook')}</span>
              <Badge color={status.color}>{status.text}</Badge>
              {a?.actingAs?.name && <Badge color="violet">Posting as Page: {a.actingAs.name}</Badge>}
              {a?.proxy && <Badge color="slate">Proxy {a.proxy}</Badge>}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {loggedIn || known
                ? 'Your login is saved on the server for your user only. Each team member connects their own Facebook.'
                : 'Click Connect Facebook and log in with your personal Facebook profile (Pages cannot list cars on Marketplace).'}
              {error && <span className="ml-2 text-red-600">{error}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!loggedIn && (
              <Button onClick={connect} loading={busy === 'connect'}>
                {known ? 'Open Facebook' : 'Connect Facebook'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => (viewOpen ? setViewOpen(false) : connect())}>
              <Monitor className="h-4 w-4" /> {viewOpen ? 'Hide browser' : 'Show browser'}
            </Button>
            {(loggedIn || known) && (
              <Button
                variant="ghost"
                size="sm"
                loading={busy === 'switch'}
                onClick={() => act('switch', async () => {
                  setViewOpen(true);
                  await fb.post('switch-account');
                }, 'Logged out. Log in with the other account in the browser.')}
              >
                <LogOut className="h-4 w-4" /> Switch account
              </Button>
            )}
            {state?.browserOpen && (
              <Button variant="ghost" size="sm" loading={busy === 'close'} onClick={() => act('close', async () => {
                setViewOpen(false);
                await fb.post('disconnect');
              }, 'Browser closed. Your login is kept.')}>
                <Power className="h-4 w-4" /> Close browser
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setProxyOpen(true)} title="Proxy">
              <Shield className="h-4 w-4" />
            </Button>
            {(loggedIn || known) && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmForget(true)} title="Remove this Facebook login from the server">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {state?.browserOpen && loggedIn === false && !viewOpen && (
          <div className="border-t border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-900">
            Facebook is waiting for you to log in. <button className="font-semibold underline" onClick={() => setViewOpen(true)}>Show browser</button>
          </div>
        )}
      </Card>

      {viewOpen && (
        <div className="space-y-2">
          <LiveBrowser />
          <p className="text-xs text-slate-500">
            This is your Facebook, running on our server. Log in, answer Facebook&apos;s security checks (codes, &quot;Was this you?&quot;) and watch the posting here. Click on the
            picture to use it; your keyboard types into it while it has the green border.
          </p>
        </div>
      )}

      <Modal
        open={confirmForget}
        onClose={() => setConfirmForget(false)}
        title="Remove this Facebook login?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmForget(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'forget'}
              onClick={() => act('forget', async () => {
                setViewOpen(false);
                await fb.post('forget');
                setConfirmForget(false);
              }, 'Facebook login removed from the server.')}
            >
              Remove login
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          The saved Facebook login is deleted from the server and the browser is closed. Your post history and Marketplace links stay. You will need to log in again
          to post.
        </p>
      </Modal>

      <Modal
        open={proxyOpen}
        onClose={() => setProxyOpen(false)}
        title="Proxy for this Facebook login (optional)"
        footer={
          <>
            <Button variant="secondary" onClick={() => setProxyOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'proxy'}
              onClick={() => act('proxy', async () => {
                await fb.put('proxy', { proxy });
                setProxyOpen(false);
              }, proxy ? 'Proxy saved. The browser starts with it next time.' : 'Proxy removed.')}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Facebook sees the server&apos;s internet address. If Facebook keeps asking this login for security checks, use a proxy from the dealership&apos;s own area (a
            &quot;residential&quot; proxy). Leave empty for none.
          </p>
          <Field label="Proxy" hint={a?.proxy ? `Now: ${a.proxy}` : 'host:port or http://user:password@host:port'}>
            <Input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="http://user:password@proxy.example.com:8000" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/** The activity log (old "Activity" box), with problem screenshots that open on click. */
export function FbActivity({ className }: { className?: string }) {
  const { logs } = useFb();
  const [shot, setShot] = useState<{ name: string; url: string } | null>(null);
  const [loading, setLoading] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const toast = useToast();

  // new lines: scroll only INSIDE the activity box (never the page), and only while you are at its bottom
  useEffect(() => {
    const b = boxRef.current;
    if (b && stick.current) b.scrollTop = b.scrollHeight;
  }, [logs.length]);

  const open = async (name: string) => {
    setLoading(name);
    try {
      const r = await fbFetch(`/dealer/facebook/debug/${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error('Screenshot not found.');
      setShot({ name, url: URL.createObjectURL(await r.blob()) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading('');
    }
  };

  return (
    <Card title="Activity" className={className} pad={false}>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const b = e.currentTarget;
          stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
        }}
        className="max-h-72 overflow-y-auto px-5 py-3 font-mono text-[12px] leading-5 text-slate-700"
      >
        {!logs.length && <div className="py-6 text-center font-sans text-sm text-slate-400">Nothing yet.</div>}
        {logs.map((l) => {
          const s = screenshotIn(l.msg);
          return (
            <div key={l.seq} className={cx(/fail|could not|error|problem|not found|blocked/i.test(l.msg) && 'text-red-700', /posted\.|published ✓|✓/i.test(l.msg) && 'text-emerald-700')}>
              <span className="mr-2 text-slate-400">{new Date(l.at).toLocaleTimeString()}</span>
              {l.msg}
              {s && (
                <button onClick={() => open(s)} className="ml-2 inline-flex items-center gap-1 font-sans text-[11px] font-semibold text-blue-700 underline">
                  {loading === s ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />} view screenshot
                </button>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <Modal
        open={!!shot}
        onClose={() => {
          if (shot) URL.revokeObjectURL(shot.url);
          setShot(null);
        }}
        title={shot?.name || ''}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shot && <img src={shot.url} alt={shot.name} className="w-full rounded-lg border" />}
      </Modal>
    </Card>
  );
}
