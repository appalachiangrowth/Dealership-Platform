'use client';

/**
 * Drag-and-drop ordering for photo lists (vehicle photos: the first photo is the cover).
 *
 * Built on Pointer Events, so the same code works with a mouse, a touch screen and a pen:
 *   · mouse: drag the whole photo (a click without moving still clicks its buttons)
 *   · touch / pen: drag by the grip handle (the rest of the photo keeps scrolling the page)
 * While dragging, a copy of the photo follows the pointer, the photo it will land on is outlined, the page scrolls
 * near the top / bottom edge, and Esc cancels. Dropping moves the photo to that position (the others shift).
 *
 * Usage: spread tileProps(i) on each photo tile (they must share one parent), handleProps(i) on its grip,
 * and render <div style={ghostStyle}><img src={drag.src}/></div> while `drag` is set.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react';

/** Moves one item to a new position (the items in between shift by one). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export type PhotoDrag = {
  /** index of the photo being dragged */
  from: number;
  /** index it lands on when dropped now */
  to: number;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  h: number;
  /** picture shown under the pointer */
  src: string;
};

type Session = PhotoDrag & { pointer: number; sx: number; sy: number; active: boolean };

const NO_DRAG = 'button, a, input, select, textarea, label, [data-no-drag]';

export function usePhotoSort<T>(items: T[], onChange: (next: T[]) => void) {
  const [drag, setDrag] = useState<PhotoDrag | null>(null);
  const session = useRef<Session | null>(null);
  // the list as last rendered (read when a drag ends)
  const latest = useRef({ items, onChange });
  useEffect(() => {
    latest.current = { items, onChange };
  }, [items, onChange]);
  const stop = useRef<((commit: boolean) => void) | null>(null);
  useEffect(() => () => stop.current?.(false), []);

  const begin = useCallback((e: ReactPointerEvent<HTMLElement>, index: number, viaHandle: boolean) => {
    if (e.button !== 0 || session.current || latest.current.items.length < 2) return;
    if (!viaHandle) {
      // touch / pen start from the handle only, so swiping over the photos still scrolls the page
      if (e.pointerType !== 'mouse') return;
      if ((e.target as Element).closest(NO_DRAG)) return;
    }
    const tile = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-sort-idx]');
    const list = tile?.parentElement;
    if (!tile || !list) return;
    const r = tile.getBoundingClientRect();
    const img = tile.querySelector('img');
    const s: Session = {
      from: index, to: index, x: e.clientX, y: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, w: r.width, h: r.height,
      src: img?.currentSrc || img?.src || '', pointer: e.pointerId, sx: e.clientX, sy: e.clientY, active: false,
    };
    session.current = s;
    if (viaHandle) e.preventDefault();

    /** the photo under the pointer (in this list), or null over a gap */
    const indexAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-sort-idx]');
      if (!el || el.parentElement !== list) return null;
      const n = Number(el.dataset.sortIdx);
      return Number.isInteger(n) ? n : null;
    };
    const show = () => {
      const k = indexAt(s.x, s.y);
      if (k !== null) s.to = k;
      setDrag({ from: s.from, to: s.to, x: s.x, y: s.y, offX: s.offX, offY: s.offY, w: s.w, h: s.h, src: s.src });
    };
    let raf = 0;
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
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      raf = requestAnimationFrame(autoScroll);
      show();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== s.pointer) return;
      s.x = ev.clientX;
      s.y = ev.clientY;
      if (!s.active) {
        if (Math.hypot(s.x - s.sx, s.y - s.sy) < 6) return; // a plain click
        activate();
      }
      ev.preventDefault();
      show();
    };
    const swallowClick = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    const finish = (commit: boolean) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      session.current = null;
      stop.current = null;
      setDrag(null);
      if (s.active) {
        // the click that follows a drag must not press a button on the photo it was dropped on
        window.addEventListener('click', swallowClick, true);
        setTimeout(() => window.removeEventListener('click', swallowClick, true), 80);
      }
      if (commit && s.active && s.to !== s.from) latest.current.onChange(moveItem(latest.current.items, s.from, s.to));
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
    stop.current = finish;
    if (viaHandle) activate(); // the grip drags at once (touch included)
  }, []);

  /** props for each photo tile */
  const tileProps = (index: number) => ({
    'data-sort-idx': index,
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => begin(e, index, false),
    // no native image drag: it would look like a file being dropped on the upload area
    onDragStart: (e: ReactDragEvent<HTMLElement>) => e.preventDefault(),
  });

  /** props for the grip handle of a photo */
  const handleProps = (index: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.stopPropagation();
      begin(e, index, true);
    },
    style: { touchAction: 'none', cursor: 'grab' } as CSSProperties,
  });

  /** position of the photo copy that follows the pointer */
  const ghostStyle: CSSProperties | undefined = drag
    ? {
        position: 'fixed', left: drag.x - drag.offX, top: drag.y - drag.offY, width: drag.w, height: drag.h, zIndex: 1000, pointerEvents: 'none',
        transform: 'rotate(-2deg) scale(1.05)', boxShadow: '0 18px 40px rgba(15,23,42,.35)', borderRadius: 10, overflow: 'hidden', opacity: 0.92, background: '#fff',
      }
    : undefined;

  return { drag, tileProps, handleProps, ghostStyle };
}
