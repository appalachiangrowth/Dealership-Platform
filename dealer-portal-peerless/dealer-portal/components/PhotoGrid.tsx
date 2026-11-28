'use client';

/**
 * PhotoGrid: the vehicle photo grid shared by Add Vehicle (inventory/ai) and Edit Vehicle (ImageUploader),
 * so both pages look and behave exactly the same.
 *
 *  · photo 1 is the Cover Photo (★ badge); the others show their position (2, 3, 4…)
 *  · the whole photo is draggable: mouse drag, or on a touch screen press and hold briefly, then drag
 *    (a quick swipe still scrolls the page). The other photos slide smoothly out of the way while dragging,
 *    the numbers / cover badge update live, and whichever photo lands in slot 1 becomes the Cover Photo.
 *  · the trash button (top right) removes a photo and never starts a drag
 *  · keyboard: focus a photo, ← / → move it, Home makes it the cover
 *  · Esc cancels a drag; the page scrolls when dragging near the top / bottom edge
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/** Moves one item to a new position (the items in between shift by one). */
export function movePhoto<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export type PhotoGridProps<T> = {
  items: T[];
  onChange: (next: T[]) => void;
  /** stable id of a photo (its url, upload id…) */
  keyOf: (item: T) => string;
  /** picture to show */
  srcOf: (item: T) => string;
  /** remove a photo (default: the list without it) */
  onRemove?: (item: T, index: number) => void;
  /** small label at the bottom left (not clickable), e.g. "Front 3/4" */
  badge?: (item: T, index: number) => ReactNode;
  /** extra buttons at the bottom right (they never start a drag), e.g. Photo Studio */
  actions?: (item: T, index: number) => ReactNode;
  /** short line above the grid (default shown when there are 2+ photos; pass null to hide) */
  hint?: ReactNode | null;
};

type Drag = { key: string; from: number; to: number; x: number; y: number; offX: number; offY: number; w: number; h: number; src: string };

const NO_DRAG = 'button, a, input, select, textarea, label, [data-no-drag]';
const LONG_PRESS_MS = 220;
const MOVE_SLOP = 8;
const FLIP = 'transform 240ms cubic-bezier(.2,.8,.2,1)';

const PG_CSS = `
.pg-hint{margin:0 0 8px;font-size:12px;color:#64748B}
.pg-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:12px;list-style:none;margin:0;padding:0}
.pg-s{display:none}
@media (max-width:480px){.pg-grid{grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}.pg-l{display:none}.pg-s{display:inline}
  .pg-del{width:28px;height:28px;top:4px;right:4px}.pg-cv,.pg-n{top:4px;left:4px}}
.pg-tile{position:relative;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:#F1F5F9;box-shadow:0 0 0 1px #E2E8F0;cursor:grab;
  user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
  transition:box-shadow .18s ease,opacity .18s ease;will-change:transform}
.pg-tile:hover{box-shadow:0 0 0 1px #CBD5E1,0 6px 16px rgba(15,23,42,.12)}
.pg-tile:active{cursor:grabbing}
.pg-tile:focus-visible{outline:none;box-shadow:0 0 0 3px #2563EB}
.pg-tile.pg-cover{box-shadow:0 0 0 2px #2563EB}
.pg-tile.pg-cover:hover{box-shadow:0 0 0 2px #2563EB,0 6px 16px rgba(15,23,42,.14)}
.pg-tile img{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none;-webkit-user-drag:none}
.pg-tile.pg-pressing{transform:scale(.97);transition:transform .2s ease,box-shadow .18s ease}
.pg-tile.pg-hole{opacity:.35;box-shadow:0 0 0 2px #93C5FD;outline:2px dashed #2563EB;outline-offset:-6px}
.pg-tile.pg-hole img{filter:grayscale(.4)}
.pg-cv,.pg-n{position:absolute;top:6px;left:6px;z-index:2;display:inline-flex;align-items:center;gap:3px;font-weight:700;color:#fff;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.pg-cv{padding:3px 7px;border-radius:6px;background:#1D4ED8;font-size:9.5px;letter-spacing:.04em;text-transform:uppercase}
.pg-n{min-width:22px;height:22px;justify-content:center;padding:0 6px;border-radius:999px;background:rgba(15,23,42,.72);font-size:11px}
.pg-del{position:absolute;top:6px;right:6px;z-index:3;display:flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:999px;
  background:rgba(255,255,255,.95);color:#DC2626;cursor:pointer;box-shadow:0 1px 4px rgba(15,23,42,.28);transition:background .15s ease,transform .12s ease,box-shadow .15s ease;touch-action:manipulation}
.pg-del:hover{background:#FEE2E2;box-shadow:0 2px 8px rgba(220,38,38,.3)}
.pg-del:active{background:#FECACA;transform:scale(.92)}
.pg-del:focus-visible{outline:2px solid #DC2626;outline-offset:2px}
.pg-del svg{width:15px;height:15px}
.pg-badge{position:absolute;left:6px;bottom:6px;z-index:2;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border-radius:6px;
  background:rgba(15,23,42,.72);color:#fff;font-size:10.5px;font-weight:600;pointer-events:none}
.pg-act{position:absolute;right:6px;bottom:6px;z-index:3;display:flex;gap:4px}
.pg-ghost{position:fixed;z-index:1000;pointer-events:none;border-radius:10px;overflow:hidden;background:#fff;
  box-shadow:0 22px 44px rgba(15,23,42,.35),0 0 0 2px #2563EB;transform:rotate(-2deg) scale(1.06);transition:transform .15s ease}
.pg-ghost img{display:block;width:100%;height:100%;object-fit:cover}
.pg-ghost .pg-cv{top:6px;left:6px}
.pg-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.pg-tile,.pg-ghost,.pg-del{transition:none}}
`;

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
      <path d="M19 6l-1 13.5A1.5 1.5 0 0 1 16.5 21h-9A1.5 1.5 0 0 1 6 19.5L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** where a photo sits inside the grid (layout position: not moved by the slide / press animations) + its current slide offset */
function layoutBox(el: HTMLElement) {
  const t = getComputedStyle(el).transform;
  const m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null;
  return { left: el.offsetLeft, top: el.offsetTop, tx: m ? m.m41 : 0, ty: m ? m.m42 : 0 };
}

export function PhotoGrid<T>({ items, onChange, keyOf, srcOf, onRemove, badge, actions, hint }: PhotoGridProps<T>) {
  // stable keys, also when the same photo appears twice
  const keys = useMemo(() => {
    const seen: Record<string, number> = {};
    return items.map((it) => {
      const k = keyOf(it);
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? `${k}#${seen[k]}` : k;
    });
  }, [items, keyOf]);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [pressing, setPressing] = useState<string | null>(null);
  const [say, setSay] = useState('');
  const gridRef = useRef<HTMLUListElement>(null);
  const latest = useRef({ items, keys, onChange });
  useEffect(() => {
    latest.current = { items, keys, onChange };
  }, [items, keys, onChange]);
  const stopRef = useRef<((commit: boolean) => void) | null>(null);
  useEffect(() => () => stopRef.current?.(false), []);
  // While a touch drag is on, the finger moves the photo instead of scrolling the page. Browsers only let a
  // touchmove listener block scrolling if it was there before the finger touched down, so it lives on the grid.
  const touchDragging = useRef(false);
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const block = (ev: TouchEvent) => {
      if (touchDragging.current && ev.cancelable) ev.preventDefault();
    };
    grid.addEventListener('touchmove', block, { passive: false });
    return () => grid.removeEventListener('touchmove', block);
  }, []);

  // ---- smooth movement (FLIP): every photo glides from where it was to its new place ----
  const prevBoxes = useRef(new Map<string, { left: number; top: number }>());
  const dropFrom = useRef<{ key: string; left: number; top: number } | null>(null);
  const focusKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { left: number; top: number }>();
    grid.querySelectorAll<HTMLElement>('[data-pg-key]').forEach((el) => {
      const key = el.dataset.pgKey as string;
      const box = layoutBox(el);
      next.set(key, { left: box.left, top: box.top });
      const drop = dropFrom.current && dropFrom.current.key === key ? dropFrom.current : null;
      const prev = prevBoxes.current.get(key);
      let dx = 0;
      let dy = 0;
      if (drop) {
        // the dropped photo flies from the pointer into its slot
        dx = drop.left - box.left;
        dy = drop.top - box.top;
      } else if (prev && (Math.abs(prev.left - box.left) > 0.5 || Math.abs(prev.top - box.top) > 0.5)) {
        dx = prev.left - box.left + box.tx;
        dy = prev.top - box.top + box.ty;
      } else return;
      if (reduce || (!dx && !dy)) {
        el.style.transition = '';
        el.style.transform = '';
        return;
      }
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)${drop ? ' scale(1.04)' : ''}`;
      void el.offsetWidth; // apply the start position before animating
      el.style.transition = FLIP;
      el.style.transform = '';
      const done = () => {
        el.style.transition = '';
        el.removeEventListener('transitionend', done);
      };
      el.addEventListener('transitionend', done);
    });
    dropFrom.current = null;
    prevBoxes.current = next;
    if (focusKey.current) {
      grid.querySelector<HTMLElement>(`[data-pg-key="${CSS.escape(focusKey.current)}"]`)?.focus({ preventScroll: false });
      focusKey.current = null;
    }
  });

  // ---- dragging (mouse, touch, pen) ----
  const begin = useCallback((e: ReactPointerEvent<HTMLElement>, index: number) => {
    if (e.button !== 0 || stopRef.current || latest.current.items.length < 2) return;
    if ((e.target as Element).closest(NO_DRAG)) return;
    const tile = e.currentTarget as HTMLElement;
    const grid = gridRef.current;
    if (!grid) return;
    const touch = e.pointerType !== 'mouse';
    const r = tile.getBoundingClientRect();
    const img = tile.querySelector('img');
    const s = {
      key: latest.current.keys[index], from: index, to: index, x: e.clientX, y: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top,
      w: r.width, h: r.height, src: img?.currentSrc || img?.src || '', pointer: e.pointerId, sx: e.clientX, sy: e.clientY, active: false,
    };
    let timer = 0;
    let raf = 0;

    /** the slot under the pointer (slot = position in the grid, read without the sliding animation) */
    const slotAt = (x: number, y: number) => {
      let hit: number | null = null;
      const g = grid.getBoundingClientRect();
      grid.querySelectorAll<HTMLElement>('[data-pg-slot]').forEach((el) => {
        const left = g.left + el.offsetLeft;
        const top = g.top + el.offsetTop;
        if (x >= left && x <= left + el.offsetWidth && y >= top && y <= top + el.offsetHeight) hit = Number(el.dataset.pgSlot);
      });
      return hit;
    };
    const show = () => {
      const k = slotAt(s.x, s.y);
      if (k !== null) s.to = k;
      setDrag({ key: s.key, from: s.from, to: s.to, x: s.x, y: s.y, offX: s.offX, offY: s.offY, w: s.w, h: s.h, src: s.src });
    };
    const autoScroll = () => {
      if (!s.active) return;
      const edge = 72;
      const dy = s.y < edge ? -Math.ceil((edge - s.y) / 4) : s.y > window.innerHeight - edge ? Math.ceil((s.y - (window.innerHeight - edge)) / 4) : 0;
      if (dy) {
        window.scrollBy(0, dy);
        show();
      }
      raf = requestAnimationFrame(autoScroll);
    };
    const activate = () => {
      s.active = true;
      setPressing(null);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      if (touch) {
        touchDragging.current = true;
        navigator.vibrate?.(8);
      }
      raf = requestAnimationFrame(autoScroll);
      show();
    };
    const blockMenu = (ev: Event) => ev.preventDefault();
    const swallowClick = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointer) return;
      s.x = ev.clientX;
      s.y = ev.clientY;
      if (!s.active) {
        const moved = Math.hypot(s.x - s.sx, s.y - s.sy);
        if (touch) {
          if (moved > MOVE_SLOP) finish(false); // a swipe: let the page scroll
          return;
        }
        if (moved < 6) return; // a plain click
        activate();
      }
      ev.preventDefault();
      show();
    };
    const finish = (commit: boolean) => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      touchDragging.current = false;
      tile.removeEventListener('contextmenu', blockMenu);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      stopRef.current = null;
      setPressing(null);
      if (s.active) {
        window.addEventListener('click', swallowClick, true);
        setTimeout(() => window.removeEventListener('click', swallowClick, true), 80);
        // the photo lands from where the pointer let go of it
        const g = grid.getBoundingClientRect();
        dropFrom.current = { key: s.key, left: s.x - s.offX - g.left, top: s.y - s.offY - g.top };
      }
      setDrag(null);
      const { items: list, keys: ks, onChange: change } = latest.current;
      // only if the list did not change underneath (e.g. an upload finished while dragging)
      if (commit && s.active && s.to !== s.from && ks[s.from] === s.key) {
        change(movePhoto(list, s.from, s.to));
        setSay(s.to === 0 ? `Photo ${s.from + 1} is now the cover photo.` : `Photo moved to position ${s.to + 1}.`);
      }
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === s.pointer && finish(true);
    const onCancel = (ev: PointerEvent) => ev.pointerId === s.pointer && finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    stopRef.current = finish;
    if (touch) {
      // press and hold, then drag (a quick swipe keeps scrolling the page)
      tile.addEventListener('contextmenu', blockMenu);
      setPressing(s.key);
      timer = window.setTimeout(activate, LONG_PRESS_MS);
    }
  }, []);

  const remove = (i: number) => {
    const it = items[i];
    if (onRemove) onRemove(it, i);
    else onChange(items.filter((_, k) => k !== i));
    setSay(`Photo ${i + 1} removed.`);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLElement>, i: number) => {
    if (e.target !== e.currentTarget) return;
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : null;
    if (to === null || to < 0 || to >= items.length || to === i) return;
    e.preventDefault();
    focusKey.current = keys[i];
    onChange(movePhoto(items, i, to));
    setSay(to === 0 ? `Photo ${i + 1} is now the cover photo.` : `Photo moved to position ${to + 1}.`);
  };

  // while dragging, show the new order live (the others slide out of the way)
  const order = items.map((it, i) => ({ it, i, key: keys[i] }));
  const shown = drag ? movePhoto(order, drag.from, drag.to) : order;
  const ghostStyle: CSSProperties | undefined = drag ? { left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w, height: drag.h } : undefined;
  const showHint = hint !== null && items.length > 1;

  return (
    <div className="pg">
      <style dangerouslySetInnerHTML={{ __html: PG_CSS }} />
      {showHint && <p className="pg-hint">{hint ?? 'Drag photos to reorder. The first photo is your Cover Photo.'}</p>}
      <ul ref={gridRef} className="pg-grid" aria-label="Vehicle photos. The first photo is the cover photo. Use the arrow keys to move a photo.">
        {shown.map(({ it, i, key }, slot) => {
          const hole = !!drag && drag.key === key;
          return (
            <li
              key={key}
              data-pg-key={key}
              data-pg-slot={slot}
              tabIndex={0}
              aria-label={`Photo ${slot + 1}${slot === 0 ? ', cover photo' : ''}`}
              className={`pg-tile${slot === 0 ? ' pg-cover' : ''}${hole ? ' pg-hole' : ''}${pressing === key ? ' pg-pressing' : ''}`}
              onPointerDown={(e) => begin(e, i)}
              onDragStart={(e) => e.preventDefault()}
              onKeyDown={(e) => onKey(e, i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={srcOf(it)} alt="" draggable={false} />
              {slot === 0 ? (
                <span className="pg-cv">
                  ★ <span className="pg-l">Cover Photo</span>
                  <span className="pg-s">Cover</span>
                </span>
              ) : (
                <span className="pg-n">{slot + 1}</span>
              )}
              {!drag && badge?.(it, i) ? <span className="pg-badge">{badge(it, i)}</span> : null}
              {!drag && actions && (
                <span className="pg-act" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
                  {actions(it, i)}
                </span>
              )}
              <button
                type="button"
                className="pg-del"
                data-no-drag
                title="Delete photo"
                aria-label={`Delete photo ${slot + 1}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
      {drag && ghostStyle && (
        <div className="pg-ghost" style={ghostStyle} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {drag.src && <img src={drag.src} alt="" />}
          {drag.to === 0 && (
            <span className="pg-cv">
              ★ <span className="pg-l">Cover Photo</span>
              <span className="pg-s">Cover</span>
            </span>
          )}
        </div>
      )}
      <span className="pg-sr" role="status" aria-live="polite">
        {say}
      </span>
    </div>
  );
}
