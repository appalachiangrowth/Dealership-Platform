/**
 * Blog articles written in the dealer portal's rich text editor are stored as HTML in BlogPost.body.
 * This file has NO dependencies (no DOM): the same copy runs in the backend (on save) and on the websites (before
 * showing an article), so only safe formatting ever reaches a visitor's browser.
 *
 * Kept:    h1–h4, p, br, hr, span, strong/b, em/i, u, s/strike/del, sub, sup, ul, ol, li, blockquote, a, img, div, figure,
 *          figcaption — with a short list of attributes and inline styles (colour, highlight, font, size, alignment,
 *          line height, indent, image width / alignment).
 * Removed: scripts, styles, iframes, forms, event handlers (onclick …), javascript: links, CSS url(…) / expression(…),
 *          and every other tag (its text stays).
 * Old articles (plain text with blank lines between paragraphs) are not HTML: isRichHtml() is false for them and
 * they are shown exactly as before.
 */

const VOID = new Set(['br', 'hr', 'img']);
const ALLOWED = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'br', 'hr', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup',
  'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'div', 'figure', 'figcaption', 'mark', 'code', 'pre',
]);
/** dropped together with everything inside them */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'select', 'title',
  'head', 'frame', 'frameset', 'applet', 'xml', 'canvas', 'audio', 'video', 'button',
]);
/** tag names written differently by browsers / Word, stored as one name */
const RENAME: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's', h5: 'h4', h6: 'h4' };

const STYLE_PROPS = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
  'text-decoration-line', 'text-align', 'line-height', 'margin-left', 'padding-left', 'width', 'max-width', 'height',
  'float', 'display', 'margin', 'margin-right', 'margin-top', 'margin-bottom', 'vertical-align', 'list-style-type',
]);

const FONT_FAMILY = /^[a-z0-9 ,'"-]{1,120}$/i;
const LENGTH = /^-?\d{1,4}(\.\d{1,3})?(px|em|rem|%|pt)?$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i;

function styleValueOk(prop: string, v: string): boolean {
  if (!v || v.length > 160 || /[<>\\@{};]|url\s*\(|expression|javascript|behaviou?r|-moz-binding|import/i.test(v)) return false;
  switch (prop) {
    case 'color':
    case 'background-color':
      return COLOR.test(v);
    case 'font-family':
      return FONT_FAMILY.test(v);
    case 'font-size':
    case 'line-height':
    case 'margin-left':
    case 'margin-right':
    case 'margin-top':
    case 'margin-bottom':
    case 'padding-left':
    case 'width':
    case 'max-width':
      return LENGTH.test(v) || v === 'auto' || v === 'normal';
    case 'height':
      return v === 'auto' || LENGTH.test(v);
    case 'margin':
      return v.split(/\s+/).length <= 4 && v.split(/\s+/).every((x) => LENGTH.test(x) || x === 'auto');
    case 'font-weight':
      return /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(v);
    case 'font-style':
      return /^(normal|italic|oblique)$/i.test(v);
    case 'text-decoration':
    case 'text-decoration-line':
      return /^(none|underline|line-through|overline)( (underline|line-through|overline))*$/i.test(v);
    case 'text-align':
      return /^(left|right|center|justify|start|end)$/i.test(v);
    case 'float':
      return /^(left|right|none)$/i.test(v);
    case 'display':
      return /^(block|inline|inline-block)$/i.test(v);
    case 'vertical-align':
      return /^(top|middle|bottom|baseline|sub|super)$/i.test(v);
    case 'list-style-type':
      return /^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/i.test(v);
  }
  return false;
}

/** "color: red; font-size: 18px; position: fixed" → "color: red; font-size: 18px" */
export function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const part of decodeEntities(style).split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim().replace(/\s*!important$/i, '').replace(/\s+/g, ' ');
    if (STYLE_PROPS.has(prop) && styleValueOk(prop, val)) out.push(`${prop}: ${val}`);
  }
  return out.slice(0, 16).join('; ');
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});?/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[k] ?? m;
  });
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/&(?!(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** links: http(s), mailto, tel, site-relative and #anchors only */
export function safeHref(raw: string): string {
  const v = decodeEntities(raw).replace(/[\u0000- \u007f]+/g, '').trim();
  if (!v) return '';
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(v)) return v.slice(0, 2000);
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return ''; // javascript:, data:, vbscript: …
  if (v.startsWith('//')) return '';
  return v.slice(0, 2000);
}

/** pictures: http(s) and the platform's own /uploads/ files */
export function safeSrc(raw: string): string {
  const v = decodeEntities(raw).replace(/[\u0000- \u007f]+/g, '').trim();
  if (/^https?:\/\//i.test(v)) return v.slice(0, 2000);
  if (/^\/?uploads\//i.test(v)) return '/' + v.replace(/^\/+/, '');
  return '';
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function attrsFor(tag: string, a: Record<string, string>): string {
  const out: string[] = [];
  const style = a.style ? cleanStyle(a.style) : '';
  // the editor's alignment / indent may also come as old-style attributes
  const align = /^(left|right|center|justify)$/i.test(a.align || '') ? `text-align: ${a.align.toLowerCase()}` : '';
  const st = [style, tag !== 'img' && !/text-align/.test(style) ? align : ''].filter(Boolean).join('; ');
  if (st) out.push(`style="${escAttr(st)}"`);
  if (tag === 'a') {
    const href = safeHref(a.href || '');
    if (href) out.push(`href="${escAttr(href)}"`);
    if (a.target === '_blank') out.push('target="_blank"', 'rel="noopener noreferrer"');
    if (a.title) out.push(`title="${escAttr(decodeEntities(a.title).slice(0, 200))}"`);
  } else if (tag === 'img') {
    const src = safeSrc(a.src || '');
    if (!src) return '\u0000'; // no picture without a safe address
    out.unshift(`src="${escAttr(src)}"`);
    out.push(`alt="${escAttr(decodeEntities(a.alt || '').slice(0, 300))}"`);
    if (/^\d{1,4}%?$/.test(a.width || '')) out.push(`width="${a.width}"`);
    if (/^(left|center|right)$/.test(a['data-align'] || '')) out.push(`data-align="${a['data-align']}"`);
    out.push('loading="lazy"');
  } else if (tag === 'ul' && a['data-type'] === 'checklist') out.push('data-type="checklist"');
  else if (tag === 'li' && /^(true|false)$/.test(a['data-checked'] || '')) out.push(`data-checked="${a['data-checked']}"`);
  else if (tag === 'ol' && /^\d{1,4}$/.test(a.start || '')) out.push(`start="${a.start}"`);
  return out.length ? ' ' + out.join(' ') : '';
}

/** Safe formatting HTML (see the top of this file). `max` = longest result kept (characters). */
export function sanitizeRichHtml(input: unknown, max = 200_000): string {
  let html = String(input ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  html = html.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '').replace(/<![^>]*>/g, '').replace(/<\?[^>]*>/g, '');
  const out: string[] = [];
  const stack: string[] = [];
  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|(<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      out.push(escText(m[4]));
      continue;
    }
    if (m[5] !== undefined) {
      out.push('&lt;');
      continue;
    }
    const closing = !!m[1];
    const raw = m[2].toLowerCase();
    if (DROP_WITH_CONTENT.has(raw)) {
      if (!closing && !/\/\s*$/.test(m[3])) {
        const end = new RegExp(`<\\s*/\\s*${raw}\\s*>`, 'i');
        const rest = html.slice(re.lastIndex);
        const e = end.exec(rest);
        re.lastIndex = e ? re.lastIndex + e.index + e[0].length : html.length;
      }
      continue;
    }
    const tag = RENAME[raw] || raw;
    if (!ALLOWED.has(tag)) continue; // unknown tag: dropped, its text stays
    if (closing) {
      if (VOID.has(tag)) continue;
      const i = stack.lastIndexOf(tag);
      if (i < 0) continue;
      while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }
    const attrs = attrsFor(tag, parseAttrs(m[3]));
    if (attrs === '\u0000') continue;
    out.push(`<${tag}${attrs}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  let result = out.join('').trim();
  if (result.length > max) result = sanitizeRichHtml(result.slice(0, max), Infinity); // cut, then re-balance the tags
  return result;
}

/** true when the article was written in the rich text editor (HTML), false for old plain-text articles */
export function isRichHtml(body: unknown): boolean {
  return /^\s*<(p|h[1-6]|ul|ol|blockquote|div|figure|img|hr|pre|span|strong|em|u|s|a|br)\b[^>]*>/i.test(String(body ?? ''));
}

/**
 * Plain text of an article (paragraphs separated by a blank line, list items with "• "), for the website designs
 * that show articles as text, word counts and search.
 */
export function richHtmlToText(html: string): string {
  const s = String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n\n• ')
    .replace(/<\s*\/?\s*(p|h[1-6]|ul|ol|li|blockquote|div|figure|figcaption|pre|hr)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(s)
    .replace(/ /g, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim())
    .filter((p) => p && p !== '•')
    .join('\n\n');
}
