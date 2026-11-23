'use client';

/**
 * Pages & SEO › Text / Picture & Text: the formatted-text box with its toolbar — bold, italic, underline, highlight,
 * bullet / numbered lists, add / edit / remove link (a page of the website or any address, same or new window) and
 * clear formatting. It keeps simple HTML; the backend and the website clean it again (frontend/lib/rich-html.ts), so
 * only safe formatting is ever shown to visitors. Pasted text arrives as plain text (no hidden Word / web styles).
 *
 * Links to a standard page are stored as "#pa:inventory", "#pa:category:suvs" … and follow each dealership's design
 * on the website (inventory.html, ./#/inventory …); links to a Pages & SEO page as "/its-address".
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Bold, Eraser, Highlighter, Italic, Link2, List, ListOrdered, Underline, Unlink } from 'lucide-react';
import { LINKS, quickHref } from '@/lib/page-sections';
import { Button, Field, Input, Modal, Select, cx } from './ui';

/** the Pages & SEO pages the link picker offers (set by the page editor) */
export const PageLinksContext = createContext<{ slug: string; title: string }[]>([]);

const HIGHLIGHTS: [string, string][] = [
  ['#fff3a0', 'Yellow'],
  ['#c9f2cf', 'Green'],
  ['#cfe6ff', 'Blue'],
  ['#ffd9e8', 'Pink'],
  ['#ffe2c2', 'Orange'],
];

type LinkDraft = { text: string; target: string; custom: string; newTab: boolean; editing: boolean };

function exec(cmd: string, value?: string) {
  try {
    document.execCommand('styleWithCSS', false, cmd === 'hiliteColor' ? 'true' : 'false');
  } catch {
    /* older browsers */
  }
  document.execCommand(cmd, false, value);
}

export function RichText({ value, onChange, placeholder = 'Write your text here…', minHeight = 140 }: { value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const editingLink = useRef<HTMLAnchorElement | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [hlOpen, setHlOpen] = useState(false);
  const [link, setLink] = useState<LinkDraft | null>(null);
  const pages = useContext(PageLinksContext);

  // outside changes (undo, another section loaded) — never while typing, so the caret stays where it is
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value && document.activeElement !== el) el.innerHTML = value || '';
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML === '<br>' ? '' : el.innerHTML;
    if (html !== value) onChange(html);
  };

  const inside = (n: Node | null) => !!n && !!ref.current && ref.current.contains(n);
  const saveRange = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && inside(sel.getRangeAt(0).commonAncestorContainer)) range.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreRange = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const refresh = () => {
    saveRange();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !inside(sel.anchorNode)) return;
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    setActive({
      bold: q('bold'), italic: q('italic'), underline: q('underline'), ul: q('insertUnorderedList'), ol: q('insertOrderedList'),
      link: !!(sel.anchorNode && (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('a')),
    });
  };
  useEffect(() => {
    document.addEventListener('selectionchange', refresh);
    return () => document.removeEventListener('selectionchange', refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (cmd: string, v?: string) => {
    restoreRange();
    exec(cmd, v);
    emit();
    refresh();
  };

  const anchorAtSelection = (): HTMLAnchorElement | null => {
    const n = range.current?.commonAncestorContainer || null;
    const el = n ? (n.nodeType === 1 ? (n as Element) : n.parentElement) : null;
    const a = el?.closest('a') as HTMLAnchorElement | null;
    return a && inside(a) ? a : null;
  };

  const openLink = () => {
    saveRange();
    const a = anchorAtSelection();
    editingLink.current = a;
    const href = a?.getAttribute('href') || '';
    const known = href.startsWith('#pa:') ? href.slice(4) : href.startsWith('/') && pages.some((p) => `/${p.slug}` === href) ? `page:${href.slice(1)}` : '';
    setLink({
      text: a ? a.textContent || '' : range.current?.toString() || '',
      target: a ? (known || '__custom') : 'inventory',
      custom: a && !known ? href : '',
      newTab: a ? a.getAttribute('target') === '_blank' : false,
      editing: !!a,
    });
  };

  const hrefOf = (d: LinkDraft) => (d.target === '__custom' ? d.custom.trim() : d.target.startsWith('page:') ? `/${d.target.slice(5)}` : quickHref(d.target));

  const applyLink = () => {
    if (!link) return;
    const href = hrefOf(link);
    if (!href) return;
    restoreRange();
    const setAttrs = (a: HTMLAnchorElement) => {
      a.setAttribute('href', href);
      if (link.newTab) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      } else {
        a.removeAttribute('target');
        a.removeAttribute('rel');
      }
    };
    const text = link.text.trim();
    let a = editingLink.current;
    if (a && inside(a)) {
      setAttrs(a);
      if (text && text !== a.textContent) a.textContent = text;
    } else if (!range.current || range.current.collapsed) {
      a = document.createElement('a');
      setAttrs(a);
      a.textContent = text || href;
      const r = range.current;
      if (r) {
        r.insertNode(a);
        r.setStartAfter(a);
        r.collapse(true);
      } else ref.current?.appendChild(a);
    } else {
      const mark = `pa-link-${Date.now()}`;
      exec('createLink', mark);
      ref.current?.querySelectorAll(`a[href="${mark}"]`).forEach((x) => {
        setAttrs(x as HTMLAnchorElement);
        if (text && text !== range.current?.toString()) x.textContent = text;
      });
    }
    setLink(null);
    emit();
  };

  const removeLink = () => {
    saveRange();
    const a = anchorAtSelection();
    if (!a) return;
    const parent = a.parentNode;
    while (a.firstChild) parent?.insertBefore(a.firstChild, a);
    parent?.removeChild(a);
    emit();
    refresh();
  };

  const btn = (key: string, title: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      key={key}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active[key]}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx('rounded-md p-1.5 text-slate-600 hover:bg-white hover:text-slate-900', active[key] && 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200')}
    >
      {icon}
    </button>
  );

  return (
    <div className="rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-slate-200 bg-slate-50 px-1.5 py-1" role="toolbar" aria-label="Text formatting">
        {btn('bold', 'Bold', <Bold className="h-4 w-4" />, () => run('bold'))}
        {btn('italic', 'Italic', <Italic className="h-4 w-4" />, () => run('italic'))}
        {btn('underline', 'Underline', <Underline className="h-4 w-4" />, () => run('underline'))}
        <div className="relative">
          {btn('hl', 'Highlight', <Highlighter className="h-4 w-4" />, () => (saveRange(), setHlOpen((o) => !o)))}
          {hlOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg" onMouseDown={(e) => e.preventDefault()}>
              {HIGHLIGHTS.map(([c, name]) => (
                <button key={c} type="button" title={name} aria-label={`${name} highlight`} onClick={() => (setHlOpen(false), run('hiliteColor', c))} className="h-6 w-6 rounded ring-1 ring-slate-300 hover:scale-110" style={{ background: c }} />
              ))}
              <button type="button" onClick={() => (setHlOpen(false), run('hiliteColor', 'transparent'))} className="ml-1 rounded px-1.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                None
              </button>
            </div>
          )}
        </div>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        {btn('ul', 'Bullet list', <List className="h-4 w-4" />, () => run('insertUnorderedList'))}
        {btn('ol', 'Numbered list', <ListOrdered className="h-4 w-4" />, () => run('insertOrderedList'))}
        <span className="mx-1 h-5 w-px bg-slate-300" />
        {btn('link', active.link ? 'Edit link' : 'Add link', <Link2 className="h-4 w-4" />, openLink)}
        {active.link && btn('unlink', 'Remove link', <Unlink className="h-4 w-4" />, removeLink)}
        <span className="mx-1 h-5 w-px bg-slate-300" />
        {btn('clear', 'Clear formatting', <Eraser className="h-4 w-4" />, () => run('removeFormat'))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyUp={refresh}
        onMouseUp={refresh}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openLink();
          }
        }}
        className={cx(
          'pa-rt max-w-none px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none',
          '[&_a]:font-semibold [&_a]:text-blue-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_h3]:text-base [&_h3]:font-bold',
          'empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]',
        )}
        style={{ minHeight }}
      />

      <Modal
        open={!!link}
        onClose={() => setLink(null)}
        title={link?.editing ? 'Edit link' : 'Add a link'}
        footer={
          <>
            {link?.editing && (
              <Button variant="secondary" onClick={() => (setLink(null), removeLink())}>
                <Unlink className="h-3.5 w-3.5" /> Remove link
              </Button>
            )}
            <Button variant="secondary" onClick={() => setLink(null)}>
              Cancel
            </Button>
            <Button onClick={applyLink} disabled={!link || !hrefOf(link)}>
              {link?.editing ? 'Save link' : 'Add link'}
            </Button>
          </>
        }
      >
        {link && (
          <div className="space-y-4">
            <Field label="Link text" hint="Leave as it is to link the text you selected.">
              <Input value={link.text} onChange={(e) => setLink({ ...link, text: e.target.value.slice(0, 200) })} placeholder="e.g. Browse our SUVs" autoFocus />
            </Field>
            <Field label="Goes to" hint="Pages of the website follow each dealership's design. Other: /a-page, https://…, tel:… or mailto:…">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={link.target} onChange={(e) => setLink({ ...link, target: e.target.value })} className="sm:w-60">
                  <optgroup label="Website pages">
                    {LINKS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </optgroup>
                  {!!pages.length && (
                    <optgroup label="Pages & SEO pages">
                      {pages.map((p) => (
                        <option key={p.slug} value={`page:${p.slug}`}>
                          {p.title} (/{p.slug})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value="__custom">Other address…</option>
                </Select>
                {link.target === '__custom' && <Input value={link.custom} onChange={(e) => setLink({ ...link, custom: e.target.value })} placeholder="https://… or /trade-in" />}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={link.newTab} onChange={(e) => setLink({ ...link, newTab: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Open in a new window
              <span className="text-xs text-slate-400">(otherwise the same window)</span>
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
