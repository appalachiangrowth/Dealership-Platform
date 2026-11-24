'use client';

/**
 * A price box that shows thousands separators while typing (35000 → 35,000) and hands back the plain number
 * ("35000", decimals kept: "35000.5"), so only the raw value is ever saved or sent to the API.
 * The caret stays where it was when a comma appears or disappears.
 */
import { useLayoutEffect, useRef } from 'react';

/** "35,000.50" / "$35000" / 35000 → "35000.50" (digits and one decimal point, at most 2 decimals) */
export function rawPrice(v: unknown): string {
  const s = String(v ?? '').replace(/[^0-9.]/g, '');
  const i = s.indexOf('.');
  if (i < 0) return s;
  return `${s.slice(0, i)}.${s.slice(i + 1).replace(/\./g, '').slice(0, 2)}`;
}

/** "35000.5" → "35,000.5" (what is typed after the point is kept as it is, so 35000.05 can be typed) */
export function formatPrice(v: unknown): string {
  const raw = rawPrice(v);
  const [int, dec] = raw.split('.');
  const intFmt = (int || '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return dec !== undefined ? `${intFmt || '0'}.${dec}` : intFmt;
}

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: unknown;
  /** the plain number as text, without commas ("" when empty) */
  onChange: (raw: string) => void;
};

export function PriceInput({ value, onChange, ...props }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null); // how many digits / points stand before the caret
  const shown = formatPrice(value);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || caret.current === null || document.activeElement !== el) return;
    let n = caret.current;
    let pos = 0;
    while (pos < shown.length && n > 0) {
      if (/[0-9.]/.test(shown[pos])) n--;
      pos++;
    }
    caret.current = null;
    el.setSelectionRange(pos, pos);
  }, [shown]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...props}
      value={shown}
      onChange={(e) => {
        const el = e.target;
        const at = el.selectionStart ?? el.value.length;
        caret.current = el.value.slice(0, at).replace(/[^0-9.]/g, '').length;
        onChange(rawPrice(el.value));
      }}
    />
  );
}
