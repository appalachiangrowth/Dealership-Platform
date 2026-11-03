'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Monitor, RotateCw, Smartphone } from 'lucide-react';
import { cx } from './ui';

const DESKTOP_WIDTH = 1280;
const MOBILE_WIDTH = 390;

/**
 * The dealer's real website shown like in the Dealership Portal editors: the page is drawn at full desktop width
 * (1280 px) and scaled down to fit the panel, so it looks exactly like on a computer; or inside a phone frame.
 */
export function PagePreview({ src, openUrl, title, banner, className }: { src: string; openUrl?: string; title: React.ReactNode; banner?: React.ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const base = src.split('#')[0];
  useEffect(() => setLoading(true), [base, nonce]);

  const withNonce = (() => {
    const [u, hash] = src.split('#');
    return u + (nonce ? `${u.includes('?') ? '&' : '?'}_r=${nonce}` : '') + (hash !== undefined ? '#' + hash : '');
  })();

  const mobile = device === 'mobile';
  const vw = mobile ? MOBILE_WIDTH : DESKTOP_WIDTH;
  const scale = size.w ? Math.min(1, (size.w - (mobile ? 32 : 0)) / vw) : 1;
  const vh = size.h ? (size.h - (mobile ? 32 : 0)) / scale : 800;

  return (
    <div className={cx('flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
        <div className="min-w-0 truncate text-sm font-semibold text-slate-600">{title}</div>
        <div className="flex shrink-0 items-center gap-2">
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
          {src && (
            <a href={openUrl || src} target="_blank" rel="noreferrer" title="Open in a new tab" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
      {banner}
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-slate-100">
        {size.w > 0 && src && (
          <div
            className={cx('absolute', mobile ? 'left-1/2 top-4 overflow-hidden rounded-[22px] border-[6px] border-slate-800 bg-white shadow-xl' : 'left-0 top-0')}
            style={{ width: vw * scale + (mobile ? 12 : 0), height: vh * scale + (mobile ? 12 : 0), marginLeft: mobile ? -(vw * scale + 12) / 2 : 0 }}
          >
            <iframe
              key={device}
              src={withNonce}
              title="Page preview"
              onLoad={() => setLoading(false)}
              style={{ width: vw, height: vh, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, background: '#fff' }}
            />
          </div>
        )}
        {(loading || !src) && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the website…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
