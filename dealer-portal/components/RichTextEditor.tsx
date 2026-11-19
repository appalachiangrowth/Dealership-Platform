'use client';

/**
 * Google Docs–style article editor (Blog & News). No editor library: the browser's own editing (contentEditable)
 * plus a toolbar, so it works with Next.js 16 / React 19 without new packages.
 *
 * The article is stored as clean HTML in the post's `body` (lib/rich-html.ts keeps only safe formatting; the backend
 * cleans it again on save). Older articles written as plain text open as paragraphs and are saved as HTML from then on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Check,
  ChevronDown,
  ExternalLink,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import { API_URL, api } from '@/lib/api';
import { isRichHtml, sanitizeRichHtml } from '@/lib/rich-html';
import { useToast } from './toast';
import { Spinner, cx } from './ui';

/* ───────────────────────── options ───────────────────────── */

const BLOCKS: [tag: string, label: string][] = [
  ['p', 'Normal text'],
  ['h1', 'Heading 1'],
  ['h2', 'Heading 2'],
  ['h3', 'Heading 3'],
  ['h4', 'Heading 4'],
  ['blockquote', 'Quote'],
];

const FONTS: [label: string, css: string][] = [
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Inter', 'Inter, Arial, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
  ['Sans Serif', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
];

const SIZES = [10, 11, 12, 14, 16, 18, 24, 32];
const LINE_HEIGHTS: [value: string, label: string][] = [
  ['1', 'Single (1.0)'],
  ['1.15', '1.15'],
  ['1.5', '1.5'],
  ['2', 'Double (2.0)'],
];

const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#b91c1c', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#1d4ed8', '#7c3aed', '#db2777',
  '#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#fbcfe8',
];

const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,div,pre';
const INDENT_STEP = 40;
const INDENT_MAX = 240;

/* ───────────────────────── stored HTML ⇄ editor HTML ───────────────────────── */

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** an older plain-text article ("## heading", "- item", "[text](https://…)", blank line between paragraphs) → HTML */
export function legacyToHtml(text: string): string {
  const inline = (s: string) =>
    escHtml(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|mailto:[^\s)]+|tel:[^\s)]+)\)/g, (_m, t: string, u: string) => `<a href="${u}">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      // "# " and "## " → Heading 2 (the page title is the Heading 1), "### " → Heading 3, "#### " → Heading 4
      const h = /^(#{1,4})\s+(.+)$/s.exec(block);
      if (h) {
        const n = Math.min(4, Math.max(2, h[1].length));
        return `<h${n}>${inline(h[2])}</h${n}>`;
      }
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
      if (/^>\s?/.test(block)) return `<blockquote>${inline(block.replace(/^>\s?/gm, ''))}</blockquote>`;
      return `<p>${inline(block)}</p>`;
    })
    .join('');
}

/** pictures in the editor are shown through the API address ("/uploads/x.jpg" → "<API>/uploads/x.jpg") */
export function toEditorHtml(stored: string): string {
  const html = isRichHtml(stored) ? sanitizeRichHtml(stored) : legacyToHtml(stored);
  return API_URL ? html.replace(/(<img\b[^>]*?\bsrc=")\/uploads\//gi, `$1${API_URL}/uploads/`) : html;
}

/** the editor's HTML → what is saved: clean HTML with "/uploads/…" picture addresses ("" for an empty article) */
export function fromEditorHtml(html: string): string {
  let out = html;
  if (API_URL) out = out.replace(new RegExp(`(<img\\b[^>]*?\\bsrc=")${escRe(API_URL)}/uploads/`, 'gi'), '$1/uploads/');
  out = sanitizeRichHtml(out)
    .replace(/<p>(\s|&nbsp;|<br>)*<\/p>$/g, '')
    .trim();
  const text = out.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return text || /<img\b/i.test(out) ? out : '';
}

/* ───────────────────────── small UI pieces ───────────────────────── */

function Tb({ title, active, onClick, children, disabled }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // keep the text selection in the editor
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-slate-700 transition-colors hover:bg-slate-200/70 disabled:opacity-40',
        active && 'bg-blue-100 text-blue-800 hover:bg-blue-100',
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden />;

function TbSelect({ title, value, onChange, children, className }: { title: string; value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx('relative inline-flex h-8 items-center rounded-md hover:bg-slate-200/70', className)} title={title}>
      <span className="sr-only">{title}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full cursor-pointer appearance-none truncate rounded-md bg-transparent pl-2 pr-6 text-[13px] font-medium text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-slate-500" />
    </label>
  );
}

/** a toolbar button with a panel under it (colors, link, picture) */
function Pop({ open, onClose, children, align = 'left' }: { open: boolean; onClose: () => void; children: React.ReactNode; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={cx('absolute top-full z-40 mt-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xl', align === 'right' ? 'right-0' : 'left-0')}>
      {children}
    </div>
  );
}

function ColorPanel({ label, onPick, onClear }: { label: string; onPick: (c: string) => void; onClear: () => void }) {
  const [custom, setCustom] = useState('#1d4ed8');
  return (
    <div className="w-[236px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClear} className="text-xs font-semibold text-blue-700 hover:underline">
          None
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className="h-6 w-6 rounded-md ring-1 ring-slate-300 transition-transform hover:scale-110"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
        <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5" aria-label="Custom color" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(custom)} className="h-8 flex-1 rounded-md border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Use custom color
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── editor ───────────────────────── */

type Fmt = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: string;
  font: string;
  size: string;
  align: string;
  lineHeight: string;
  ul: boolean;
  ol: boolean;
  check: boolean;
  link: boolean;
};
const NO_FMT: Fmt = { bold: false, italic: false, underline: false, strike: false, block: 'p', font: '', size: '', align: 'left', lineHeight: '', ul: false, ol: false, check: false, link: false };

/** upload one picture for the article (kept as JPG / PNG / GIF / WebP in the dealership's website images) */
async function uploadArticleImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('files', file);
  const r = await api<{ files: { url: string }[]; errors: { file: string; error: string }[] }>('/dealer/media?folder=site', { form });
  if (r.errors.length) throw new Error(r.errors.map((e) => `${e.file}: ${e.error}`).join('\n'));
  return r.files[0]?.url || '';
}

export function RichTextEditor({ value, onChange, placeholder = 'Start writing your article…' }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const ed = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [fmt, setFmt] = useState<Fmt>(NO_FMT);
  const [pop, setPop] = useState<'' | 'color' | 'highlight' | 'link' | 'image'>('');
  const [link, setLink] = useState({ url: '', newTab: true, editing: false });
  const [imgUrl, setImgUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [imgPos, setImgPos] = useState({ top: 0, left: 0 });
  const [empty, setEmpty] = useState(true);
  const [words, setWords] = useState(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /* first content (the editor is not re-filled while typing: the page gives it a new key per post) */
  useEffect(() => {
    const el = ed.current;
    if (!el) return;
    el.innerHTML = toEditorHtml(value || '');
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* older browsers */
    }
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measure = () => {
    const el = ed.current;
    if (!el) return;
    const text = (el.textContent || '').trim();
    setEmpty(!text && !el.querySelector('img,li,hr'));
    setWords(text ? text.split(/\s+/).length : 0);
  };

  const inEditor = (n: Node | null) => !!n && !!ed.current && (n === ed.current || ed.current.contains(n));

  const range = (): Range | null => {
    const s = window.getSelection();
    if (s && s.rangeCount && inEditor(s.anchorNode)) return s.getRangeAt(0);
    return saved.current;
  };

  const restore = () => {
    const el = ed.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const r = saved.current;
    const s = window.getSelection();
    if (!r || !s) return;
    if (!inEditor(r.startContainer)) return;
    s.removeAllRanges();
    s.addRange(r);
  };

  const closestEl = (sel: string): HTMLElement | null => {
    const r = range();
    if (!r) return null;
    let n: Node | null = r.startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    const found = n instanceof Element ? n.closest(sel) : null;
    return found && inEditor(found) ? (found as HTMLElement) : null;
  };

  /* fonts / sizes from the browser's own commands → <span style> (what the website shows) */
  const normalize = () => {
    const el = ed.current;
    if (!el) return;
    el.querySelectorAll('font').forEach((f) => {
      const span = document.createElement('span');
      const face = f.getAttribute('face');
      const color = f.getAttribute('color');
      if (face) span.style.fontFamily = face;
      if (color) span.style.color = color;
      if (f.getAttribute('size') === '7') span.dataset.paSize = '1';
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    el.querySelectorAll('b').forEach((b) => {
      const s = document.createElement('strong');
      while (b.firstChild) s.appendChild(b.firstChild);
      b.replaceWith(s);
    });
    // a stray <div> line from some browsers becomes a paragraph
    el.querySelectorAll(':scope > div').forEach((d) => {
      const p = document.createElement('p');
      for (const a of Array.from(d.attributes)) if (a.name === 'style') p.setAttribute('style', a.value);
      while (d.firstChild) p.appendChild(d.firstChild);
      d.replaceWith(p);
    });
  };

  const emit = () => {
    const el = ed.current;
    if (!el) return;
    onChangeRef.current(fromEditorHtml(el.innerHTML));
    measure();
  };

  const refresh = useCallback(() => {
    const r = range();
    if (!r || !ed.current) return;
    let n: Node | null = r.startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    if (!(n instanceof Element)) return;
    const st = getComputedStyle(n);
    const block = n.closest('h1,h2,h3,h4,blockquote,p,li');
    const fam = st.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const font = FONTS.find(([l, css]) => css.split(',')[0].replace(/["']/g, '').trim().toLowerCase() === fam || l.toLowerCase() === fam)?.[1] || '';
    const px = Math.round(parseFloat(st.fontSize));
    const blockEl = n.closest(BLOCK_SEL) as HTMLElement | null;
    const ul = n.closest('ul');
    const q = (c: string) => {
      try {
        return document.queryCommandState(c);
      } catch {
        return false;
      }
    };
    setFmt({
      bold: q('bold'),
      italic: q('italic'),
      underline: q('underline'),
      strike: q('strikeThrough'),
      block: block && inEditor(block) ? (block.tagName === 'LI' ? 'p' : block.tagName.toLowerCase()) : 'p',
      font,
      size: SIZES.includes(px) ? String(px) : '',
      align: blockEl && inEditor(blockEl) ? getComputedStyle(blockEl).textAlign.replace('start', 'left') : 'left',
      lineHeight: blockEl && inEditor(blockEl) ? blockEl.style.lineHeight : '',
      ul: !!ul && inEditor(ul) && ul.dataset.type !== 'checklist',
      ol: !!n.closest('ol') && inEditor(n.closest('ol')),
      check: !!ul && inEditor(ul) && ul.dataset.type === 'checklist',
      link: !!n.closest('a') && inEditor(n.closest('a')),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* remember where the caret was (selects and panels take the focus away) */
  useEffect(() => {
    let raf = 0;
    const onSel = () => {
      const s = window.getSelection();
      if (s && s.rangeCount && inEditor(s.anchorNode)) {
        saved.current = s.getRangeAt(0).cloneRange();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(refresh);
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const after = () => {
    normalize();
    emit();
    refresh();
    const s = window.getSelection();
    if (s && s.rangeCount && inEditor(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange();
  };

  /** bold / italic / underline / strike-through as <strong> <em> <u> <s>; colors, fonts and alignment as styles */
  const INLINE_TAGS = new Set(['bold', 'italic', 'underline', 'strikeThrough']);
  const exec = (cmd: string, val?: string) => {
    restore();
    try {
      document.execCommand('styleWithCSS', false, INLINE_TAGS.has(cmd) ? 'false' : 'true');
    } catch {
      /* ignore */
    }
    document.execCommand(cmd, false, val);
    after();
  };

  /** the paragraphs / headings / list items the selection touches */
  const selectedBlocks = (): HTMLElement[] => {
    const r = range();
    const el = ed.current;
    if (!r || !el) return [];
    const all = Array.from(el.querySelectorAll<HTMLElement>(BLOCK_SEL)).filter((b) => r.intersectsNode(b));
    return all.filter((b) => !all.some((o) => o !== b && b.contains(o)));
  };

  const ensureBlocks = (): HTMLElement[] => {
    let blocks = selectedBlocks();
    if (!blocks.length) {
      exec('formatBlock', '<p>');
      blocks = selectedBlocks();
    }
    return blocks;
  };

  const setBlock = (tag: string) => exec('formatBlock', `<${tag}>`);

  const setFont = (css: string) => {
    if (css) exec('fontName', css);
  };

  const setSize = (px: string) => {
    if (!px) return;
    restore();
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* ignore */
    }
    document.execCommand('fontSize', false, '7');
    normalize();
    ed.current?.querySelectorAll<HTMLElement>('span').forEach((s) => {
      const fs = s.style.fontSize;
      if (s.dataset.paSize || fs === 'xxx-large' || fs === '-webkit-xxx-large') {
        s.style.fontSize = `${px}px`;
        delete s.dataset.paSize;
      }
    });
    after();
  };

  const setLineHeight = (lh: string) => {
    restore();
    for (const b of ensureBlocks()) b.style.lineHeight = lh;
    after();
  };

  const indent = (dir: 1 | -1) => {
    restore();
    if (closestEl('li')) {
      document.execCommand(dir > 0 ? 'indent' : 'outdent');
      after();
      return;
    }
    for (const b of ensureBlocks()) {
      const cur = parseInt(b.style.marginLeft || '0', 10) || 0;
      const next = Math.max(0, Math.min(INDENT_MAX, cur + dir * INDENT_STEP));
      b.style.marginLeft = next ? `${next}px` : '';
    }
    after();
  };

  const toggleChecklist = () => {
    restore();
    const list = closestEl('ul,ol');
    if (list && list.tagName === 'UL' && list.dataset.type === 'checklist') {
      list.removeAttribute('data-type');
      list.querySelectorAll(':scope > li').forEach((li) => li.removeAttribute('data-checked'));
      after();
      return;
    }
    if (!list || list.tagName !== 'UL') document.execCommand('insertUnorderedList');
    const ul = closestEl('ul');
    if (ul) {
      ul.dataset.type = 'checklist';
      ul.querySelectorAll(':scope > li').forEach((li) => {
        if (!(li as HTMLElement).dataset.checked) (li as HTMLElement).dataset.checked = 'false';
      });
    }
    after();
  };

  const clearFormatting = () => {
    restore();
    document.execCommand('removeFormat');
    for (const b of selectedBlocks()) {
      b.style.removeProperty('line-height');
      b.style.removeProperty('margin-left');
      b.style.removeProperty('text-align');
      if (!b.getAttribute('style')) b.removeAttribute('style');
    }
    const r = range();
    ed.current?.querySelectorAll<HTMLElement>('span[style]').forEach((s) => {
      if (r && r.intersectsNode(s)) s.removeAttribute('style');
    });
    after();
  };

  /* ── links ── */
  const openLink = () => {
    const a = closestEl('a') as HTMLAnchorElement | null;
    setLink({ url: a?.getAttribute('href') || '', newTab: a ? a.target === '_blank' : true, editing: !!a });
    setPop('link');
  };

  const applyLink = () => {
    let url = link.url.trim();
    if (!url) return;
    if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) url = (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? 'mailto:' : 'https://') + url;
    restore();
    const cur = closestEl('a') as HTMLAnchorElement | null;
    const r = range();
    if (cur) {
      cur.setAttribute('href', url);
    } else if (r && r.collapsed) {
      document.execCommand('insertHTML', false, `<a href="${escHtml(url)}">${escHtml(link.url.trim())}</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    const r2 = range();
    ed.current?.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
      if (a.getAttribute('href') !== url || !(a === cur || (r2 && r2.intersectsNode(a)))) return;
      if (link.newTab) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else {
        a.removeAttribute('target');
        a.removeAttribute('rel');
      }
    });
    setPop('');
    after();
  };

  const removeLink = () => {
    restore();
    const a = closestEl('a');
    if (a) {
      const s = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(a);
      s?.removeAllRanges();
      s?.addRange(r);
    }
    document.execCommand('unlink');
    setPop('');
    after();
  };

  /* ── pictures ── */
  const insertImage = (src: string) => {
    if (!src) return;
    const show = src.startsWith('/uploads/') ? `${API_URL}${src}` : src;
    exec('insertHTML', `<p><img src="${escHtml(show)}" alt="" data-align="center" style="width: 100%"></p><p><br></p>`);
    setPop('');
    setImgUrl('');
  };

  const uploadAndInsert = async (files: FileList | File[] | null) => {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp)$/i.test(f.name));
    if (!list.length) return;
    setUploading(true);
    try {
      for (const f of list.slice(0, 10)) insertImage(await uploadArticleImage(f));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const placeImgBar = useCallback((el: HTMLImageElement | null) => {
    if (!el || !wrap.current) return;
    const w = wrap.current.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    // on the picture's top-left corner, so the text above stays visible
    setImgPos({ top: Math.max(0, b.top - w.top + 8), left: Math.max(8, Math.min(b.left - w.left + 8, w.width - 388)) });
  }, []);

  useEffect(() => {
    if (!img) return;
    const move = () => placeImgBar(img);
    move();
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    return () => {
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
    };
  }, [img, placeImgBar]);

  const imgSet = (fn: (el: HTMLImageElement) => void) => {
    if (!img) return;
    fn(img);
    emit();
    requestAnimationFrame(() => placeImgBar(img));
  };

  /* ── editor events ── */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    } else if (e.key === 'Tab' && closestEl('li')) {
      e.preventDefault();
      indent(e.shiftKey ? -1 : 1);
    } else if (mod && e.shiftKey && e.key === '7') {
      e.preventDefault();
      exec('insertOrderedList');
    } else if (mod && e.shiftKey && e.key === '8') {
      e.preventDefault();
      exec('insertUnorderedList');
    } else if (mod && e.key === '\\') {
      e.preventDefault();
      clearFormatting();
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    // tick / untick a checklist item (click on its box)
    const li = t.closest('li');
    const ul = li?.parentElement;
    if (li && ul?.dataset.type === 'checklist' && e.clientX - li.getBoundingClientRect().left < 26) {
      e.preventDefault();
      li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
      emit();
      return;
    }
    setImg(t.tagName === 'IMG' ? (t as HTMLImageElement) : null);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files || []).filter((f) => /^image\//.test(f.type));
    if (files.length) {
      e.preventDefault();
      void uploadAndInsert(files);
      return;
    }
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      // Word / Google Docs / web pages: only safe formatting is kept
      const clean = sanitizeRichHtml(html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/gi, '')).replace(/(<img\b[^>]*?\bsrc=")\/uploads\//gi, `$1${API_URL}/uploads/`);
      exec('insertHTML', clean);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    const pos = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) saved.current = pos;
    void uploadAndInsert(files);
  };

  const colorBtn = (kind: 'color' | 'highlight') => (
    <div className="relative">
      <Tb
        title={kind === 'color' ? 'Text color' : 'Highlight color'}
        onClick={() => {
          setPop(pop === kind ? '' : kind);
        }}
        active={pop === kind}
      >
        {kind === 'color' ? <Baseline className="h-4 w-4" /> : <Highlighter className="h-4 w-4" />}
      </Tb>
      <Pop open={pop === kind} onClose={() => setPop('')}>
        <ColorPanel
          label={kind === 'color' ? 'Text color' : 'Highlight'}
          onPick={(c) => {
            exec(kind === 'color' ? 'foreColor' : 'hiliteColor', c);
            setPop('');
          }}
          onClear={() => {
            if (kind === 'color') exec('foreColor', '#000000');
            else exec('hiliteColor', 'transparent');
            if (kind === 'highlight') {
              const r = range();
              ed.current?.querySelectorAll<HTMLElement>('span').forEach((s) => {
                if (r && r.intersectsNode(s) && /transparent|rgba\(0, 0, 0, 0\)/.test(s.style.backgroundColor)) s.style.removeProperty('background-color');
              });
              emit();
            }
            setPop('');
          }}
        />
      </Pop>
    </div>
  );

  return (
    <div ref={wrap} className="relative rounded-xl border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
      <style>{EDITOR_CSS}</style>

      {/* toolbar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-slate-200 bg-slate-50/95 px-2 py-1.5 backdrop-blur" role="toolbar" aria-label="Formatting">
        <Tb title="Undo (Ctrl+Z)" onClick={() => exec('undo')}>
          <Undo2 className="h-4 w-4" />
        </Tb>
        <Tb title="Redo (Ctrl+Y)" onClick={() => exec('redo')}>
          <Redo2 className="h-4 w-4" />
        </Tb>
        <Sep />
        <TbSelect title="Text style" value={fmt.block} onChange={setBlock} className="w-[128px]">
          {BLOCKS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </TbSelect>
        <Sep />
        <TbSelect title="Font" value={fmt.font} onChange={setFont} className="w-[136px]">
          <option value="">Font</option>
          {FONTS.map(([l, css]) => (
            <option key={l} value={css}>
              {l}
            </option>
          ))}
        </TbSelect>
        <TbSelect title="Font size" value={fmt.size} onChange={setSize} className="w-[64px]">
          <option value="">Size</option>
          {SIZES.map((s) => (
            <option key={s} value={String(s)}>
              {s}
            </option>
          ))}
        </TbSelect>
        <Sep />
        <Tb title="Bold (Ctrl+B)" active={fmt.bold} onClick={() => exec('bold')}>
          <Bold className="h-4 w-4" />
        </Tb>
        <Tb title="Italic (Ctrl+I)" active={fmt.italic} onClick={() => exec('italic')}>
          <Italic className="h-4 w-4" />
        </Tb>
        <Tb title="Underline (Ctrl+U)" active={fmt.underline} onClick={() => exec('underline')}>
          <Underline className="h-4 w-4" />
        </Tb>
        <Tb title="Strikethrough" active={fmt.strike} onClick={() => exec('strikeThrough')}>
          <Strikethrough className="h-4 w-4" />
        </Tb>
        {colorBtn('color')}
        {colorBtn('highlight')}
        <Sep />

        {/* link */}
        <div className="relative">
          <Tb title="Insert / edit link (Ctrl+K)" active={fmt.link || pop === 'link'} onClick={() => (pop === 'link' ? setPop('') : openLink())}>
            <Link2 className="h-4 w-4" />
          </Tb>
          <Pop open={pop === 'link'} onClose={() => setPop('')}>
            <form
              className="w-[300px] space-y-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                applyLink();
              }}
            >
              <label className="block text-xs font-semibold text-slate-600">
                Link address
                <input
                  autoFocus
                  value={link.url}
                  onChange={(e) => setLink((l) => ({ ...l, url: e.target.value }))}
                  placeholder="https://… , /inventory or email"
                  className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm font-normal text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <input type="checkbox" checked={link.newTab} onChange={(e) => setLink((l) => ({ ...l, newTab: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                Open in a new tab <ExternalLink className="h-3 w-3 text-slate-400" />
              </label>
              <div className="flex items-center justify-between pt-1">
                {link.editing ? (
                  <button type="button" onClick={removeLink} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline">
                    <Unlink className="h-3.5 w-3.5" /> Remove link
                  </button>
                ) : (
                  <span />
                )}
                <button type="submit" disabled={!link.url.trim()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
                  <Check className="h-3.5 w-3.5" /> {link.editing ? 'Update' : 'Apply'}
                </button>
              </div>
            </form>
          </Pop>
        </div>

        {/* picture */}
        <div className="relative">
          <Tb title="Insert image" active={pop === 'image'} onClick={() => setPop(pop === 'image' ? '' : 'image')}>
            {uploading ? <Spinner className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
          </Tb>
          <Pop open={pop === 'image'} onClose={() => setPop('')}>
            <div className="w-[300px] space-y-3">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700"
              >
                <Upload className="h-5 w-5" />
                {uploading ? 'Uploading…' : 'Upload from computer'}
                <span className="font-normal text-slate-400">JPG, PNG, GIF or WebP</span>
              </button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^https?:\/\/\S+$/i.test(imgUrl.trim())) insertImage(imgUrl.trim());
                  else toast.error('Paste a picture address that starts with https://');
                }}
              >
                <input
                  value={imgUrl}
                  onChange={(e) => setImgUrl(e.target.value)}
                  placeholder="…or paste an image URL"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
                <button type="submit" disabled={!imgUrl.trim()} className="h-9 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
                  Insert
                </button>
              </form>
            </div>
          </Pop>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple hidden onChange={(e) => void uploadAndInsert(e.target.files)} />
        </div>
        <Sep />

        <Tb title="Align left" active={fmt.align === 'left'} onClick={() => exec('justifyLeft')}>
          <AlignLeft className="h-4 w-4" />
        </Tb>
        <Tb title="Align center" active={fmt.align === 'center'} onClick={() => exec('justifyCenter')}>
          <AlignCenter className="h-4 w-4" />
        </Tb>
        <Tb title="Align right" active={fmt.align === 'right'} onClick={() => exec('justifyRight')}>
          <AlignRight className="h-4 w-4" />
        </Tb>
        <Tb title="Justify" active={fmt.align === 'justify'} onClick={() => exec('justifyFull')}>
          <AlignJustify className="h-4 w-4" />
        </Tb>
        <TbSelect title="Line & paragraph spacing" value={fmt.lineHeight} onChange={setLineHeight} className="w-[78px]">
          <option value="">Spacing</option>
          {LINE_HEIGHTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </TbSelect>
        <Sep />
        <Tb title="Bulleted list (Ctrl+Shift+8)" active={fmt.ul} onClick={() => exec('insertUnorderedList')}>
          <List className="h-4 w-4" />
        </Tb>
        <Tb title="Numbered list (Ctrl+Shift+7)" active={fmt.ol} onClick={() => exec('insertOrderedList')}>
          <ListOrdered className="h-4 w-4" />
        </Tb>
        <Tb title="Checklist" active={fmt.check} onClick={toggleChecklist}>
          <ListChecks className="h-4 w-4" />
        </Tb>
        <Tb title="Decrease indent" onClick={() => indent(-1)}>
          <IndentDecrease className="h-4 w-4" />
        </Tb>
        <Tb title="Increase indent" onClick={() => indent(1)}>
          <IndentIncrease className="h-4 w-4" />
        </Tb>
        <Sep />
        <Tb title="Clear formatting (Ctrl+\)" onClick={clearFormatting}>
          <RemoveFormatting className="h-4 w-4" />
        </Tb>
      </div>

      {/* picture toolbar */}
      {img && ed.current?.contains(img) && (
        <div
          className="absolute z-30 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          style={{ top: imgPos.top, left: imgPos.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {(['left', 'center', 'right'] as const).map((a) => (
            <Tb key={a} title={`Image ${a}`} active={(img.dataset.align || 'center') === a} onClick={() => imgSet((el) => (el.dataset.align = a))}>
              {a === 'left' ? <AlignLeft className="h-4 w-4" /> : a === 'center' ? <AlignCenter className="h-4 w-4" /> : <AlignRight className="h-4 w-4" />}
            </Tb>
          ))}
          <Sep />
          {[25, 50, 75, 100].map((w) => (
            <Tb key={w} title={`Width ${w}%`} active={img.style.width === `${w}%`} onClick={() => imgSet((el) => (el.style.width = `${w}%`))}>
              <span className="text-[11px] font-semibold">{w}%</span>
            </Tb>
          ))}
          <Sep />
          <Tb
            title="Picture description (alt text)"
            onClick={() => {
              const alt = window.prompt('Describe the picture (for Google and screen readers):', img.alt || '');
              if (alt !== null) imgSet((el) => (el.alt = alt.slice(0, 300)));
            }}
          >
            <span className="text-[11px] font-semibold">Alt</span>
          </Tb>
          <Tb
            title="Remove picture"
            onClick={() => {
              const p = img.parentElement;
              img.remove();
              if (p && p.tagName === 'P' && !p.textContent?.trim() && !p.querySelector('img')) p.remove();
              setImg(null);
              emit();
            }}
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Tb>
          <Tb title="Close" onClick={() => setImg(null)}>
            <X className="h-4 w-4" />
          </Tb>
        </div>
      )}

      {/* the page */}
      <div className="rounded-b-xl bg-[#F8FAFC] px-3 py-4 sm:px-6 sm:py-6">
        <div
          ref={ed}
          className="pa-rte mx-auto min-h-[420px] max-w-[820px] rounded-md bg-white px-5 py-6 text-[16px] text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.12)] outline-none ring-1 ring-slate-200 sm:px-10 sm:py-10"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Article"
          data-empty={empty ? 'true' : 'false'}
          data-placeholder={placeholder}
          spellCheck
          onInput={() => {
            normalize();
            emit();
          }}
          onBlur={emit}
          onKeyDown={onKeyDown}
          onKeyUp={refresh}
          onMouseDown={onMouseDown}
          onMouseUp={refresh}
          onPaste={onPaste}
          onDrop={onDrop}
        />
      </div>
      <div className="flex items-center justify-between rounded-b-xl border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
        <span>
          {words} word{words === 1 ? '' : 's'} · about {Math.max(1, Math.round(words / 200))} min read
        </span>
        <span className="hidden sm:inline">Tip: paste from Word or Google Docs — formatting is kept. Drop pictures straight into the article.</span>
      </div>
    </div>
  );
}

/** the editing page looks like the article on the website (same as .pa-article in the website's lib/site-extras.ts) */
const EDITOR_CSS = `
.pa-rte{line-height:1.7;overflow-wrap:break-word;font-family:Inter,Arial,sans-serif}
.pa-rte[data-empty=true]:before{content:attr(data-placeholder);color:#94a3b8;pointer-events:none;position:absolute}
.pa-rte>:first-child{margin-top:0}
.pa-rte p{margin:0 0 1em}
.pa-rte h1,.pa-rte h2,.pa-rte h3,.pa-rte h4{line-height:1.25;margin:1.4em 0 .5em;font-weight:700;color:#0f172a}
.pa-rte h1{font-size:2em}.pa-rte h2{font-size:1.6em}.pa-rte h3{font-size:1.3em}.pa-rte h4{font-size:1.1em}
.pa-rte ul,.pa-rte ol{margin:0 0 1em;padding-left:1.6em}.pa-rte ul{list-style:disc}.pa-rte ol{list-style:decimal}
.pa-rte ul ul{list-style:circle}.pa-rte ol ol{list-style:lower-alpha}.pa-rte li{margin:.25em 0}
.pa-rte ul[data-type=checklist]{list-style:none;padding-left:.2em}
.pa-rte ul[data-type=checklist] li{position:relative;padding-left:1.8em}
.pa-rte ul[data-type=checklist] li:before{content:"";position:absolute;left:0;top:.32em;width:1.05em;height:1.05em;border:2px solid #64748b;border-radius:4px;box-sizing:border-box;cursor:pointer;background:#fff}
.pa-rte ul[data-type=checklist] li[data-checked=true]:before{background:#2563eb;border-color:#2563eb}
.pa-rte ul[data-type=checklist] li[data-checked=true]:after{content:"";position:absolute;left:.38em;top:.45em;width:.3em;height:.58em;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg);pointer-events:none}
.pa-rte li[data-checked=true]{text-decoration:line-through;color:#64748b}
.pa-rte blockquote{margin:1.2em 0;padding:.3em 0 .3em 1.1em;border-left:4px solid #cbd5e1;color:#475569;font-style:italic}
.pa-rte a{color:#1d4ed8;text-decoration:underline}
.pa-rte img{max-width:100%;height:auto;border-radius:10px;display:block;margin:1.2em 0;cursor:pointer}
.pa-rte img[data-align=center]{margin-left:auto;margin-right:auto}
.pa-rte img[data-align=right]{margin-left:auto;margin-right:0}
.pa-rte img:hover{outline:2px solid #93c5fd;outline-offset:2px}
.pa-rte hr{border:0;border-top:1px solid #e2e8f0;margin:2em 0}
`;
