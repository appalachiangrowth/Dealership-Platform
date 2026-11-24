'use client';

/**
 * Phones (< 768 px): while a field of the form is being typed in (the on-screen keyboard is open), `typing` is true —
 * the page lets its sticky header scroll away then — and the focused field is scrolled to the middle of what is
 * still visible above the keyboard (again when the keyboard finishes opening and the visible area shrinks).
 */
import { useEffect, useState } from 'react';

const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]), select, textarea, [contenteditable="true"]';
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export function useMobileFormFocus(root: React.RefObject<HTMLElement | null>): boolean {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const center = (t: Element) => {
      if (!isPhone() || !t.isConnected) return;
      t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const onIn = (e: FocusEvent) => {
      const t = e.target as Element | null;
      if (!t || !t.matches?.(FIELD) || !isPhone()) return;
      setTyping(true);
      clearTimeout(timer);
      timer = setTimeout(() => center(t), 320); // after the keyboard has started opening
    };
    const onOut = () => {
      // moving from one field to the next keeps the keyboard open: only drop the state when nothing is focused
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || !el.contains(a) || !a.matches(FIELD)) setTyping(false);
      }, 0);
    };
    // the keyboard finished opening (the visible area got smaller): centre the field again
    const vv = window.visualViewport;
    const onResize = () => {
      const a = document.activeElement;
      if (a && el.contains(a) && a.matches(FIELD)) center(a);
    };
    el.addEventListener('focusin', onIn);
    el.addEventListener('focusout', onOut);
    vv?.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      el.removeEventListener('focusin', onIn);
      el.removeEventListener('focusout', onOut);
      vv?.removeEventListener('resize', onResize);
    };
  }, [root]);

  return typing;
}
