'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ExternalLink, Loader2, Monitor, RotateCw, Smartphone } from 'lucide-react';
import { cx } from './ui';

/**
 * The dealer's real website in a side panel (the website app, ?pa_live=1).
 * The page inside answers with messages (see frontend/lib/live.ts):
 *   ready {keys}  → which editable texts are on the page        pick {key} → a text was clicked
 *   focus-result {key, found}
 * and we send it: values (texts while typing) · focus (outline a text) · colors (brand colours).
 */
export interface LivePreviewHandle {
  send: (msg: Record<string, unknown>) => void;
  reload: () => void;
}

type Msg = { pa: string; keys?: string[]; key?: string; found?: boolean; path?: string };

interface Props {
  /** page to show, e.g. http://blue-motors.localhost:3002/index.html?pa_live=1#/about */
  src: string;
  /** address opened by the "open in new tab" button */
  openUrl?: string;
  title: React.ReactNode;
  live?: boolean;
  onLiveChange?: (on: boolean) => void;
  onReady?: (keys: string[]) => void;
  onPick?: (key: string) => void;
  onFocusResult?: (key: string, found: boolean) => void;
  banner?: React.ReactNode;
  className?: string;
}

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 390;

export const LivePreview = forwardRef<LivePreviewHandle, Props>(function LivePreview(
  { src, openUrl, title, live, onLiveChange, onReady, onPick, onFocusResult, banner, className },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // keep the latest callbacks without re-subscribing
  const cb = useRef({ onReady, onPick, onFocusResult });
  cb.current = { onReady, onPick, onFocusResult };

  const origin = (() => {
    try {
      return new URL(src).origin;
    } catch {
      return '*';
    }
  })();

  const send = useCallback(
    (msg: Record<string, unknown>) => {
      try {
        frame.current?.contentWindow?.postMessage(msg, '*');
      } catch {
        /* preview not loaded yet */
      }
    },
    [],
  );

  useImperativeHandle(ref, () => ({ send, reload: () => setNonce((n) => n + 1) }), [send]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = (e.data || {}) as Msg;
      if (d.pa === 'ready') {
        setLoading(false);
        cb.current.onReady?.(d.keys || []);
      } else if (d.pa === 'pick' && d.key) cb.current.onPick?.(d.key);
      else if (d.pa === 'focus-result' && d.key) cb.current.onFocusResult?.(d.key, !!d.found);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const rect = box.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ w: rect.width, h: rect.height });
    }
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // a different page (not only a #hash change) reloads the frame
  const base = src.split('#')[0];
  useEffect(() => setLoading(true), [base, nonce]);

  // Ping the preview iframe to establish handshake and retrieve editable keys
  useEffect(() => {
    if (!loading) return;
    const ping = () => {
      try {
        frame.current?.contentWindow?.postMessage({ pa: 'ping' }, '*');
      } catch {}
    };
    ping();
    const t = setInterval(ping, 600);
    return () => clearInterval(t);
  }, [loading, base, nonce]);

  const withNonce = (() => {
    const [u, hash] = src.split('#');
    return u + (nonce ? `${u.includes('?') ? '&' : '?'}_r=${nonce}` : '') + (hash !== undefined ? '#' + hash : '');
  })();

  const vw = device === 'desktop' ? DESKTOP_WIDTH : MOBILE_WIDTH;
  const scale = size.w ? Math.min(1, (size.w - (device === 'mobile' ? 32 : 0)) / vw) : 1;
  const vh = size.h ? (size.h - (device === 'mobile' ? 32 : 0)) / scale : 800;

  return (
    <div className={cx('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div className="min-w-0 truncate text-sm font-semibold text-slate-600">{title}</div>
        <div className="flex shrink-0 items-center gap-2">
          {onLiveChange && (
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-slate-700">
              <button
                type="button"
                role="switch"
                aria-checked={!!live}
                onClick={() => onLiveChange(!live)}
                className={cx('relative h-6 w-11 rounded-full transition', live ? 'bg-blue-600' : 'bg-slate-300')}
              >
                <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', live ? 'left-[22px]' : 'left-0.5')} />
              </button>
              Live preview
            </label>
          )}
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {(['desktop', 'mobile'] as const).map((d) => (
              <button
                key={d}
                type="button"
                title={d === 'desktop' ? 'Computer' : 'Phone'}
                onClick={() => setDevice(d)}
                className={cx('rounded-md p-1.5', device === d ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:text-slate-800')}
              >
                {d === 'desktop' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
              </button>
            ))}
          </div>
          <button type="button" title="Reload" onClick={() => setNonce((n) => n + 1)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <RotateCw className="h-4 w-4" />
          </button>
          <a href={openUrl || src} target="_blank" rel="noreferrer" title="Open in a new tab" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
      {banner}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-slate-100">
        {size.w > 0 && (
          <div
            className={cx('absolute', device === 'mobile' ? 'left-1/2 top-4 overflow-hidden rounded-[22px] border-[6px] border-slate-800 bg-white shadow-xl' : 'left-0 top-0')}
            style={{
              width: vw * scale + (device === 'mobile' ? 12 : 0),
              height: vh * scale + (device === 'mobile' ? 12 : 0),
              marginLeft: device === 'mobile' ? -(vw * scale + 12) / 2 : 0,
            }}
          >
            <iframe
              ref={frame}
              key={base + nonce}
              src={withNonce}
              title="Website preview"
              onLoad={() => {
                try {
                  frame.current?.contentWindow?.postMessage({ pa: 'ping' }, '*');
                } catch {}
                setTimeout(() => setLoading(false), 2000);
              }}
              style={{ width: vw, height: vh, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, background: '#fff' }}
            />
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your website…
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

/** Small, non-interactive live picture of a website page (used when a design has no preview image). */
export function SiteThumbnail({ src, className }: { src: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const scale = w ? w / DESKTOP_WIDTH : 0.25;
  return (
    <div ref={box} className={cx('relative overflow-hidden bg-slate-100', className)}>
      {w > 0 && (
        <iframe
          src={src}
          title="Design preview"
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          style={{ width: DESKTOP_WIDTH, height: DESKTOP_WIDTH * 0.625, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  );
}
