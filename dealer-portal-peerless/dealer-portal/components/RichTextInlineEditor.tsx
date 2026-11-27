'use client';

import { useEffect, useRef, useState } from 'react';
import { Bold, Link2, Underline, X } from 'lucide-react';
import { cx } from '@/components/ui';

type Props = {
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  className?: string;
};

const fieldCls =
  'w-full rounded-b-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-100';

/** Validates link URLs: allows /paths, #anchors, http(s):, mailto:, tel:. Blocks javascript:, data:, etc. */
function normalizeHref(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return '';
  if (v.startsWith('//')) return '';
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`;
  return `/${v.replace(/^\/+/, '')}`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Compact inline rich-text formatting editor for Website Content fields.
 * Emits clean HTML strings (<strong>, <u>, <a href="...">) into the existing string state.
 */
export function RichTextInlineEditor({ value, onChange, multiline = true, rows = 3, placeholder, className }: Props) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [linkErr, setLinkErr] = useState('');
  const selRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  useEffect(() => {
    if (!linkOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinkOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkOpen]);

  function getSelection() {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    return { start: Math.min(start, end), end: Math.max(start, end) };
  }

  function applyWrap(tag: 'strong' | 'u') {
    const { start, end } = getSelection();
    const open = `<${tag}>`;
    const close = `</${tag}>`;
    const selected = value.slice(start, end);

    const exactMatch = new RegExp(`^<${tag}>([\\s\\S]*)</${tag}>$`, 'i').exec(selected);
    let next = '';
    let nextStart = start;
    let nextEnd = end;

    if (exactMatch) {
      const inner = exactMatch[1];
      next = value.slice(0, start) + inner + value.slice(end);
      nextStart = start;
      nextEnd = start + inner.length;
    } else if (value.slice(Math.max(0, start - open.length), start).toLowerCase() === open && value.slice(end, end + close.length).toLowerCase() === close) {
      next = value.slice(0, start - open.length) + selected + value.slice(end + close.length);
      nextStart = start - open.length;
      nextEnd = nextStart + selected.length;
    } else {
      const wrapped = `${open}${selected}${close}`;
      next = value.slice(0, start) + wrapped + value.slice(end);
      nextStart = selected ? start : start + open.length;
      nextEnd = selected ? start + wrapped.length : start + open.length;
    }

    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextStart, nextEnd);
    });
  }

  function openLinkPopover() {
    const sel = getSelection();
    selRef.current = sel;
    setLinkText(value.slice(sel.start, sel.end));
    setLinkUrl('');
    setLinkErr('');
    setLinkOpen((o) => !o);
  }

  function insertLink() {
    const href = normalizeHref(linkUrl);
    if (!href) {
      setLinkErr('Enter a valid URL (e.g. /inventory or https://example.com)');
      return;
    }
    const { start, end } = selRef.current;
    const label = (linkText || value.slice(start, end) || href).trim();
    const isExternal = /^https?:\/\//i.test(href);
    const attrs = isExternal ? `href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"` : `href="${escapeAttr(href)}"`;
    const tag = `<a ${attrs}>${label}</a>`;
    const next = value.slice(0, start) + tag + value.slice(end);
    onChange(next);
    setLinkOpen(false);
    setLinkUrl('');
    setLinkText('');
    setLinkErr('');
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = start + tag.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      applyWrap('strong');
    } else if (k === 'u') {
      e.preventDefault();
      applyWrap('u');
    } else if (k === 'k') {
      e.preventDefault();
      openLinkPopover();
    }
  }

  return (
    <div className={cx('relative', className)}>
      <div className="flex items-center gap-1 rounded-t-lg border border-b-0 border-slate-300 bg-slate-50 px-2 py-1">
        <button
          type="button"
          title="Bold (Ctrl+B)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyWrap('strong')}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 transition hover:bg-slate-200/80 hover:text-slate-900"
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Underline (Ctrl+U)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyWrap('u')}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-600 transition hover:bg-slate-200/80 hover:text-slate-900"
        >
          <Underline className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Insert link (Ctrl+K)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLinkPopover}
          className={cx(
            'inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs font-medium transition',
            linkOpen ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-200/80 hover:text-slate-900',
          )}
        >
          <Link2 className="h-3.5 w-3.5" />
          <span>Link</span>
        </button>
      </div>

      {linkOpen && (
        <div className="absolute left-0 right-0 top-9 z-20 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Insert link</span>
            <button type="button" onClick={() => setLinkOpen(false)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Link text (optional)"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
            <input
              type="text"
              autoFocus
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                setLinkErr('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  insertLink();
                }
              }}
              placeholder="/inventory or https://example.com"
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
            />
            {linkErr && <p className="text-[11px] text-red-600">{linkErr}</p>}
            <div className="flex justify-end gap-1.5 pt-0.5">
              <button type="button" onClick={() => setLinkOpen(false)} className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="button" onClick={insertLink} className="rounded-md bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-800">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cx(fieldCls, 'min-h-[68px]')}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={fieldCls}
        />
      )}
    </div>
  );
}
