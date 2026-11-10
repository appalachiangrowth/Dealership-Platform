'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Store, Monitor, Power, LogOut, Shield, Trash2, ImageIcon, Loader2, Info, RefreshCw, ExternalLink } from 'lucide-react';
import { FacebookIcon, fb, fbFetch, screenshotIn, useFb } from '@/lib/facebook';
import { Button, Card, Field, Input, Modal, cx } from '../ui';
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
    ? { tone: 'mute', text: 'Checking…', line: 'Checking your Facebook connection…' }
    : loggedIn
      ? { tone: 'ok', text: 'Connected', line: 'Facebook is open on our server and ready to post.' }
      : known && !state.browserOpen
        ? { tone: 'ok', text: 'Connected', line: 'Facebook is resting to save resources. It wakes up by itself when you post, so the first post may take a few extra seconds.' }
        : state.browserOpen
          ? { tone: 'warn', text: 'Waiting for you to log in', line: 'Log in to Facebook in the browser below. You only need to do this once.' }
          : { tone: 'mute', text: 'Not connected', line: 'Click Connect Facebook and log in once with your Facebook account. The login is saved on our server for your user only.' };

  const tabs = [
    { href: '/dealer/facebook', label: 'Create a post' },
    { href: '/dealer/facebook/history', label: 'Posting history' },
    { href: '/dealer/facebook/marketplace', label: 'Marketplace', icon: Store },
  ];
  const BTN_S =
    'inline-flex min-h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#CBD5E1] bg-white px-4 text-sm font-semibold text-[#0F172A] transition hover:bg-[#F8FAFC] disabled:opacity-60';
  const ICON_B = 'inline-flex h-10 w-10 items-center justify-center rounded-lg text-[#526077] transition hover:bg-[#F1F5F9] hover:text-[#0F172A]';

  return (
    <div className="mb-6 space-y-5">
      {/* page header with the tabs */}
      <header className="-mx-4 -mt-6 border-b border-[#E5E9F0] bg-white px-4 pt-5 sm:-mx-7 sm:-mt-7 sm:px-7">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em] text-[#0F172A]">FB Poster</h1>
          <p className="m-0 text-sm text-[#526077]">Share your vehicles on your Facebook Pages and on Marketplace, without copying and pasting.</p>
        </div>
        <nav aria-label="FB Poster sections" className="mt-3.5 flex gap-6 overflow-x-auto">
          {tabs.map((t) => {
            const on = path === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-0.5 text-sm font-semibold transition',
                  on ? 'border-[#2563EB] text-[#1D4ED8]' : 'border-transparent text-[#526077] hover:text-[#0F172A]',
                )}
              >
                {t.icon && <t.icon className="h-4 w-4" />}
                {t.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* connection */}
      <div className="rounded-[14px] border border-[#E5E9F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1877F2] text-white">
            <FacebookIcon className="h-[22px] w-[22px]" />
          </span>
          <div className="flex min-w-[260px] flex-1 flex-col gap-[3px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-bold text-[#0F172A]">{known || loggedIn ? `Connected as ${a?.fbName || 'your Facebook account'}` : 'Facebook'}</span>
              <span
                className={cx(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold',
                  status.tone === 'ok' ? 'bg-[#E8F7EE] text-[#15803D]' : status.tone === 'warn' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#F1F5F9] text-[#475569]',
                )}
              >
                <span className={cx('h-1.5 w-1.5 rounded-full', status.tone === 'ok' ? 'bg-[#16A34A]' : status.tone === 'warn' ? 'bg-[#D97706]' : 'bg-[#94A3B8]')} />
                {status.text}
              </span>
              {a?.proxy && <span className="rounded-full bg-[#F1F5F9] px-2.5 py-[3px] text-xs font-semibold text-[#475569]">Proxy {a.proxy}</span>}
              <span className="group relative inline-flex">
                <button type="button" aria-label="About the Facebook connection" className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-[#64748B] hover:bg-[#EAF1FF] hover:text-[#1D4ED8]">
                  <Info className="h-[15px] w-[15px]" />
                </button>
                <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] left-[-10px] z-40 hidden w-[260px] rounded-lg bg-[#0F172A] px-3 py-2.5 text-[12.5px] font-normal leading-normal text-[#F1F5F9] shadow-[0_8px_24px_rgba(15,23,42,0.25)] group-focus-within:block group-hover:block">
                  Your Facebook login is stored securely on our server for your user only. Each team member connects their own Facebook account. You only need to log in once.
                </span>
              </span>
            </div>
            <span className="text-[13px] text-[#526077]">
              {status.line}
              {error && <span className="ml-2 text-[#B91C1C]">{error}</span>}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!loggedIn && !known ? (
              <Button onClick={connect} loading={busy === 'connect'}>
                Connect Facebook
              </Button>
            ) : (
              <button type="button" className={BTN_S} disabled={busy === 'connect'} onClick={() => (viewOpen ? setViewOpen(false) : connect())}>
                {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : viewOpen ? <Monitor className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                {viewOpen ? 'Hide Facebook' : 'Open Facebook'}
              </button>
            )}
            {(loggedIn || known) && (
              <button
                type="button"
                className={BTN_S}
                disabled={busy === 'switch'}
                onClick={() =>
                  act(
                    'switch',
                    async () => {
                      setViewOpen(true);
                      await fb.post('switch-account');
                    },
                    'Logged out. Log in with the other account in the browser.',
                  )
                }
              >
                {busy === 'switch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Switch account
              </button>
            )}
            {state?.browserOpen && (
              <button
                type="button"
                className={ICON_B}
                title="Close the Facebook browser (your login is kept)"
                aria-label="Close the Facebook browser"
                onClick={() =>
                  act(
                    'close',
                    async () => {
                      setViewOpen(false);
                      await fb.post('disconnect');
                    },
                    'Browser closed. Your login is kept.',
                  )
                }
              >
                {busy === 'close' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              </button>
            )}
            <button type="button" className={ICON_B} onClick={() => setProxyOpen(true)} title="Proxy" aria-label="Proxy settings">
              <Shield className="h-4 w-4" />
            </button>
            {(loggedIn || known) && (
              <button type="button" className={ICON_B} onClick={() => setConfirmForget(true)} title="Remove this Facebook login from the server" aria-label="Remove this Facebook login">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {state?.browserOpen && loggedIn === false && !viewOpen && (
          <div className="flex items-center gap-2 border-t border-[#FDE68A] bg-[#FFFBEB] px-5 py-2.5 text-[13px] text-[#78350F]">
            <LogOut className="h-4 w-4" /> Facebook is waiting for you to log in.
            <button className="font-semibold text-[#1D4ED8] hover:underline" onClick={() => setViewOpen(true)}>
              Show Facebook
            </button>
          </div>
        )}
      </div>

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
    <Card title="Activity log" className={className} pad={false}>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const b = e.currentTarget;
          stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
        }}
        className="max-h-[420px] overflow-y-auto px-5 py-3 font-mono text-[12px] leading-5 text-slate-700"
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
