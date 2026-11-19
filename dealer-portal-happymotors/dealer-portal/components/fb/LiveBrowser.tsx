'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Globe, X, Keyboard, Send, Loader2 } from 'lucide-react';
import { fb, fbFetch, useFb } from '@/lib/facebook';
import { useToast } from '../toast';
import { cx } from '../ui';

const SPECIAL = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * The dealer's Facebook browser, running on the server, shown inside the portal.
 * Pictures of the screen are streamed in; clicks, scrolling and typing are sent back.
 */
export function LiveBrowser() {
  const { state, setViewOpen } = useFb();
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const [src, setSrc] = useState('');
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const textBuf = useRef('');
  const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheel = useRef({ dy: 0, dx: 0, x: 0, y: 0, t: null as ReturnType<typeof setTimeout> | null });
  const W = state?.screen.width || 1280;
  const H = state?.screen.height || 860;

  // ---- picture stream (long-poll; a new picture arrives whenever the screen changes) ----
  useEffect(() => {
    let alive = true;
    let seq = 0;
    let url = '';
    (async () => {
      await fb.post('view/start').catch((e) => toastRef.current.error((e as Error).message));
      while (alive) {
        try {
          const r = await fbFetch(`/dealer/facebook/view/frame?after=${seq}`);
          if (!alive) break;
          if (r.status === 200) {
            seq = Number(r.headers.get('X-Frame-Seq')) || seq + 1;
            const next = URL.createObjectURL(await r.blob());
            setSrc(next);
            if (url) URL.revokeObjectURL(url);
            url = next;
          } else if (r.status !== 204) {
            await new Promise((ok) => setTimeout(ok, 1500));
          }
        } catch {
          await new Promise((ok) => setTimeout(ok, 1500));
        }
      }
    })();
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      // nobody is watching: the server stops sending pictures (the browser keeps running)
      void fb.post('view/stop').catch(() => undefined);
    };
  }, []);

  // ---- sending input, strictly in order ----
  const send = useCallback(
    (ev: Record<string, unknown>) => {
      chain.current = chain.current.then(() => fb.post('view/input', ev).catch((e) => toastRef.current.error((e as Error).message)));
    },
    [],
  );

  const flushText = useCallback(() => {
    if (textTimer.current) clearTimeout(textTimer.current);
    textTimer.current = null;
    const t = textBuf.current;
    textBuf.current = '';
    if (t) send({ type: 'text', text: t });
  }, [send]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * W), y: Math.round(((e.clientY - r.top) / r.height) * H) };
  };

  const onClick = (e: React.MouseEvent) => {
    if (!img.current) return;
    box.current?.focus();
    flushText();
    send({ type: 'click', ...point(e) });
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    flushText();
    send({ type: 'click', button: 'right', ...point(e) });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!img.current) return;
    const w = wheel.current;
    const p = point(e);
    w.dy += e.deltaY;
    w.dx += e.deltaX;
    w.x = p.x;
    w.y = p.y;
    if (!w.t) {
      w.t = setTimeout(() => {
        send({ type: 'wheel', x: w.x, y: w.y, dx: Math.round(w.dx), dy: Math.round(w.dy) });
        w.dx = 0;
        w.dy = 0;
        w.t = null;
      }, 120);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'v') return; // the paste event sends the text
    if ((e.ctrlKey || e.metaKey) && /^[a-z]$/i.test(k)) {
      e.preventDefault();
      flushText();
      send({ type: 'key', key: k, ctrl: true, shift: e.shiftKey });
      return;
    }
    if (SPECIAL.has(k)) {
      e.preventDefault();
      flushText();
      send({ type: 'key', key: k, shift: e.shiftKey });
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      textBuf.current += k;
      if (textTimer.current) clearTimeout(textTimer.current);
      textTimer.current = setTimeout(flushText, 90);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData('text');
    if (!t) return;
    e.preventDefault();
    flushText();
    send({ type: 'text', text: t });
  };

  const nav = (action: string) => fb.post('view/nav', { action }).catch((e) => toast.error((e as Error).message));

  const close = async () => {
    await fb.post('view/stop').catch(() => undefined);
    setViewOpen(false);
  };

  const sendTyped = () => {
    if (!typed) return;
    send({ type: 'text', text: typed });
    setTyped('');
  };

  const automation = state?.busy;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-300 bg-slate-800 shadow-lg">
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 px-3 py-2 text-slate-200">
        <button className="rounded p-1.5 hover:bg-white/10" title="Back" onClick={() => nav('back')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 hover:bg-white/10" title="Forward" onClick={() => nav('forward')}>
          <ArrowRight className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 hover:bg-white/10" title="Reload" onClick={() => nav('reload')}>
          <RotateCw className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 hover:bg-white/10" title="Facebook home" onClick={() => nav('home')}>
          <Globe className="h-4 w-4" />
        </button>
        <div className="mx-1 min-w-0 flex-1 truncate rounded-md bg-white/10 px-3 py-1 text-xs text-slate-300">{state?.url || 'about:blank'}</div>
        <span className={cx('hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex', focused ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-slate-400')}>
          <Keyboard className="h-3 w-3" /> {focused ? 'Keyboard on' : 'Click the screen to type'}
        </span>
        <button className="rounded p-1.5 hover:bg-white/10" title="Close the view (the browser keeps running)" onClick={close}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {automation && (
        <div className="bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950">
          Working: {state?.busyWhat || 'Facebook'}… you can watch here. Only click when the yellow box on the page asks you to.
        </div>
      )}
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          flushText();
        }}
        className="relative outline-none focus:ring-2 focus:ring-emerald-400"
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={img}
            src={src}
            alt="Facebook browser"
            draggable={false}
            onClick={onClick}
            onContextMenu={onContext}
            onWheel={onWheel}
            className="absolute inset-0 h-full w-full cursor-pointer select-none bg-white"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-300">
            <Loader2 className="h-5 w-5 animate-spin" /> Starting the browser…
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 bg-slate-900 px-3 py-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendTyped()}
          placeholder="Phone / tablet: click a box in the picture, type here and press Send"
          className="min-w-0 flex-1 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white placeholder:text-slate-400 outline-none"
        />
        <button onClick={sendTyped} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
          <Send className="h-3.5 w-3.5" /> Send
        </button>
        <button onClick={() => send({ type: 'key', key: 'Enter' })} className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-slate-200">
          Enter ↵
        </button>
      </div>
    </div>
  );
}
