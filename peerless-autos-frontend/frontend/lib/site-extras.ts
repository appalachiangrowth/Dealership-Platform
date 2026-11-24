/**
 * Small additions to every dealer website page (front controller, app/[[...path]]/route.ts):
 *   · favicon   — the dealership's own browser-tab icon (Business details › Favicon), and /favicon.ico never 404s
 *   · rich blog — articles written in the dealer portal's rich text editor are shown with their formatting
 *                 (headings, colours, lists, images …) in every design, see richPostRuntime()
 *   · alt text  — alt text / title saved in Platform Admin › SEO & URLs › Images go on every <img> of that picture
 *                 that has none of its own: in the page HTML (applyMediaMeta) and in what the design draws later
 *                 from inventory.json (richPostRuntime)
 */
import { h } from './php';
import { isRichHtml, sanitizeRichHtml } from './rich-html';

/** neutral 16 / 32 / 48 px car icon, used for /favicon.ico until the dealership uploads its own */
export const DEFAULT_FAVICON = Buffer.from('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', 'base64');

const ICON_TYPES: Record<string, string> = {
  ico: 'image/x-icon', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
};

/** "/uploads/t/site/x.ico", "uploads/…" or "https://…" → address usable in the page; "" when not a safe address */
export function faviconHref(raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return v;
  if (/^\/?uploads\/[^\s"'<>]+$/i.test(v)) return '/' + v.replace(/^\/+/, '');
  return '';
}

function iconType(href: string): string {
  const ext = (href.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
  return ICON_TYPES[ext] || '';
}

/** <link> tags for the browser tab, bookmarks and the iPhone home screen */
export function faviconTags(href: string): string {
  if (!href) return '';
  const type = iconType(href);
  const t = type ? ` type="${type}"` : '';
  return `<link rel="icon" href="${h(href)}"${t}><link rel="shortcut icon" href="${h(href)}"${t}><link rel="apple-touch-icon" href="${h(href)}">`;
}

/** Replaces the design's own icons with the dealership's favicon (nothing changes when none is set). */
export function applyFavicon(html: string, raw: unknown): string {
  const href = faviconHref(raw);
  if (!href) return html;
  const end = html.search(/<\/head\s*>/i);
  if (end < 0) return html;
  const head = html.slice(0, end).replace(/<link\b[^>]*\brel\s*=\s*["']?(?:shortcut icon|icon|apple-touch-icon(?:-precomposed)?|mask-icon)["']?[^>]*>/gi, '');
  const out = head + html.slice(end);
  return /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + faviconTags(href)) : faviconTags(href) + out;
}

export type MediaMeta = Record<string, { a?: string; t?: string }>;

/** "/uploads/x.jpg?w=800", "https://site/uploads/x.jpg", "uploads/x.jpg" → "/uploads/x.jpg" ("" = not an uploaded file) */
export function mediaKey(src: string): string {
  const v = String(src || '');
  const i = v.indexOf('uploads/');
  if (i < 0 || (i > 0 && v[i - 1] !== '/')) return '';
  return '/' + v.slice(i).split(/[?#]/)[0];
}

/**
 * Pictures in the page HTML: an <img> of an uploaded picture with no (or an empty) alt text gets the alt text saved
 * for it, and its title when it has none. Pictures inside scripts (design templates) are handled in the browser.
 */
export function applyMediaMeta(html: string, meta: MediaMeta | undefined | null): string {
  if (!meta || !Object.keys(meta).length || !html.includes('uploads/')) return html;
  return html.replace(/<img\b([^>]*)>/gi, (tag, attrs: string) => {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!src) return tag;
    const m = meta[mediaKey(src[1] ?? src[2] ?? '')];
    if (!m) return tag;
    let a = attrs;
    if (m.a) {
      const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(a);
      if (!alt) a = ` alt="${h(m.a)}" data-pa-alt="1"` + a;
      else if (!(alt[1] ?? alt[2] ?? '').trim()) a = a.replace(alt[0], ` alt="${h(m.a)}" data-pa-alt="1"`);
    }
    if (m.t && !/\stitle\s*=/i.test(a)) a = ` title="${h(m.t)}" data-pa-title="1"` + a;
    const selfClose = /\/\s*$/.test(a);
    return `<img${selfClose ? a.replace(/\/\s*$/, '') : a}${selfClose ? ' /' : ''}>`;
  });
}

/** /favicon.ico: the dealership's favicon (302), else the neutral icon — never a 404 */
export function faviconResponse(raw: unknown, url: URL): Response {
  const href = faviconHref(raw);
  if (href) return new Response(null, { status: 302, headers: { Location: new URL(href, url).toString(), 'Cache-Control': 'public, max-age=300' } });
  return new Response(new Uint8Array(DEFAULT_FAVICON), { headers: { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=86400' } });
}

/**
 * "Certified pre-owned" is not offered on the websites. The backend may still send it (`certified: "Yes"` from older
 * records, or imported fields such as certified_pre_owned / cpo): those fields are removed before any design sees the
 * vehicle — some designs list every field of a vehicle on its page — so no design shows a Certified row, badge or
 * filter. A condition such as "Certified Pre-Owned" shows as "Used", and a feature or deal badge that only says
 * "Certified" / "CPO" is left out.
 */
const CPO_KEY = /^(is_?)?(certified|cpo)(_?pre_?owned)?$/i;
const CPO_TEXT = /^\s*(manufacturer\s+)?(certified(\s+pre[\s-]?owned)?(\s+vehicle)?|c\.?p\.?o\.?)\s*$/i;
const itemText = (x: unknown) => (x && typeof x === 'object' ? String((x as Record<string, unknown>).label ?? (x as Record<string, unknown>).name ?? '') : String(x ?? ''));

export function hideCertified<T extends Record<string, unknown>>(v: T): T {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (CPO_KEY.test(k)) delete o[k];
  if (typeof o.condition === 'string' && /certified|\bcpo\b/i.test(o.condition)) o.condition = 'Used';
  for (const k of ['features', 'safety', 'safetyFeatures', 'options', 'equipment']) {
    if (Array.isArray(o[k])) o[k] = (o[k] as unknown[]).filter((x) => !CPO_TEXT.test(itemText(x)));
  }
  for (const k of ['deal', 'dealLabel', 'badge']) if (typeof o[k] === 'string' && CPO_TEXT.test(o[k] as string)) o[k] = '';
  return v;
}

/**
 * /inventory.json passes through here: certified / CPO details are removed from every vehicle (hideCertified), and an
 * article written in the rich text editor carries its HTML in `contentHtml` (cleaned again here, whatever the backend
 * sent) next to the plain-text `content` the designs use.
 */
export function cleanInventoryPosts(json: string): string {
  try {
    const data = JSON.parse(json) as { vehicles?: Record<string, unknown>[]; posts?: Record<string, unknown>[] };
    if (!data || typeof data !== 'object') return json;
    if (Array.isArray(data.vehicles)) data.vehicles.forEach(hideCertified);
    for (const p of data.posts || []) {
      if (!p || typeof p !== 'object' || !('contentHtml' in p)) continue;
      const html = String(p.contentHtml || '');
      p.contentHtml = html && isRichHtml(html) ? sanitizeRichHtml(html) : '';
    }
    return JSON.stringify(data);
  } catch {
    return json;
  }
}

const ARTICLE_CSS =
  '.pa-article{line-height:1.7;overflow-wrap:break-word}.pa-article>:first-child{margin-top:0}.pa-article p{margin:0 0 1em}' +
  '.pa-article h1,.pa-article h2,.pa-article h3,.pa-article h4{line-height:1.25;margin:1.4em 0 .5em;font-weight:700}' +
  '.pa-article h1{font-size:2em}.pa-article h2{font-size:1.6em}.pa-article h3{font-size:1.3em}.pa-article h4{font-size:1.1em}' +
  '.pa-article ul,.pa-article ol{margin:0 0 1em;padding-left:1.6em}.pa-article ul{list-style:disc}.pa-article ol{list-style:decimal}.pa-article li{margin:.25em 0}' +
  '.pa-article ul[data-type=checklist]{list-style:none;padding-left:.2em}.pa-article ul[data-type=checklist] li{position:relative;padding-left:1.8em}' +
  '.pa-article ul[data-type=checklist] li:before{content:"";position:absolute;left:0;top:.32em;width:1em;height:1em;border:2px solid currentColor;border-radius:4px;opacity:.55;box-sizing:border-box}' +
  '.pa-article ul[data-type=checklist] li[data-checked=true]:after{content:"";position:absolute;left:.36em;top:.42em;width:.3em;height:.58em;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg)}' +
  '.pa-article li[data-checked=true]{text-decoration:line-through;opacity:.7}' +
  '.pa-article blockquote{margin:1.2em 0;padding:.3em 0 .3em 1.1em;border-left:4px solid currentColor;opacity:.85;font-style:italic}' +
  '.pa-article a{color:inherit;text-decoration:underline}.pa-article img{max-width:100%;height:auto;border-radius:10px;display:block;margin:1.2em 0}' +
  '.pa-article img[data-align=center]{margin-left:auto;margin-right:auto}.pa-article img[data-align=right]{margin-left:auto;margin-right:0}' +
  '.pa-article hr{border:0;border-top:1px solid currentColor;opacity:.2;margin:2em 0}.pa-article pre{white-space:pre-wrap;padding:1em;border-radius:8px;background:rgba(127,127,127,.12)}';

/**
 * The designs show an article as plain paragraphs (their own scripts read `content` from inventory.json). This script
 * reads the same inventory.json answer the design loads (no extra request), finds the paragraphs of an article that
 * has rich HTML and puts the formatted article in their place (.pa-article).
 */
export function richPostRuntime(): string {
  return (
    `<style data-pa-article>${ARTICLE_CSS}</style>` +
    '<script data-pa>(function(){if(window.__paRich)return;window.__paRich=1;var M=[],T=0,MM=null;' +
    'function N(s){return String(s||"").replace(/\\s+/g,"")}' +
    'function take(d){try{(d&&d.posts||[]).forEach(function(p){if(!p||!p.contentHtml||!p.content)return;var k=String(p.id);' +
    'for(var i=0;i<M.length;i++)if(M[i].k===k)return;var t=String(p.content).split(/\\n\\s*\\n/).map(N).filter(Boolean);if(t.length)M.push({k:k,t:t,h:String(p.contentHtml)})});' +
    'if(d&&d.mediaMeta&&typeof d.mediaMeta==="object"){var any=0;for(var q in d.mediaMeta){any=1;break}MM=any?d.mediaMeta:null}if(M.length||MM)go()}catch(e){}}' +
    // alt text / title of uploaded pictures (Platform Admin › SEO & URLs › Images)
    'function K(u){u=String(u||"");var i=u.indexOf("uploads/");if(i<0||(i>0&&u.charAt(i-1)!=="/"))return "";return "/"+u.slice(i).split(/[?#]/)[0]}' +
    'function one(im){var m=MM[K(im.getAttribute("src"))],oa=im.getAttribute("data-pa-alt")==="1",ot=im.getAttribute("data-pa-title")==="1";' +
    'if(m&&m.a){var a=im.getAttribute("alt");if(!a||!a.trim()||oa){if(a!==m.a)im.setAttribute("alt",m.a);im.setAttribute("data-pa-alt","1")}}else if(oa){im.setAttribute("alt","");im.removeAttribute("data-pa-alt")}' +
    'if(m&&m.t){if(!im.getAttribute("title")||ot){if(im.getAttribute("title")!==m.t)im.setAttribute("title",m.t);im.setAttribute("data-pa-title","1")}}else if(ot){im.removeAttribute("title");im.removeAttribute("data-pa-title")}}' +
    'function alts(){if(!MM)return;var ims=document.getElementsByTagName("img");for(var i=0;i<ims.length;i++)one(ims[i])}' +
    'function inv(u){return /(^|\\/)inventory\\.json([?#]|$)/.test(String(u||""))}' +
    'var F=window.fetch;if(F){window.fetch=function(i){var u=typeof i==="string"?i:(i&&i.url)||"",r=F.apply(this,arguments);' +
    'if(inv(u)&&r&&r.then)r.then(function(x){try{x.clone().json().then(take,function(){})}catch(e){}},function(){});return r}}' +
    'var X=window.XMLHttpRequest&&XMLHttpRequest.prototype;if(X){var O=X.open,S=X.send;X.open=function(m,u){this.__paInv=inv(u);return O.apply(this,arguments)};' +
    'X.send=function(){var x=this;function d(){if(x.__paDone||x.readyState!==4)return;x.__paDone=1;try{if(x.status>=200&&x.status<300)take(JSON.parse(x.responseText))}catch(e){}}' +
    'if(x.__paInv&&x.addEventListener)x.addEventListener("load",d);var r=S.apply(this,arguments);if(x.__paInv)d();return r}}' +
    'function apply(){T=0;alts();if(!M.length)return;var ps=document.getElementsByTagName("p"),n=[],i,j;for(i=0;i<ps.length;i++)n.push(N(ps[i].textContent));' +
    'M.forEach(function(e){var best=null;for(i=0;i<ps.length;i++){if(n[i]!==e.t[0])continue;var p=ps[i];if(p.closest&&p.closest(".pa-article"))continue;' +
    'var run=[p],s=p,ok=1;for(j=1;j<e.t.length;j++){s=s.nextElementSibling;if(!s||s.tagName!=="P"||N(s.textContent)!==e.t[j]){ok=0;break}run.push(s)}if(ok)best=run}' +
    'if(!best)return;var b=document.createElement("div");b.className="pa-article";b.innerHTML=e.h;best[0].parentNode.insertBefore(b,best[0]);' +
    'best.forEach(function(x){x.parentNode&&x.parentNode.removeChild(x)});ps=document.getElementsByTagName("p");n=[];for(i=0;i<ps.length;i++)n.push(N(ps[i].textContent))})}' +
    'function go(){if(!T)T=setTimeout(apply,40)}' +
    'if(window.MutationObserver)new MutationObserver(function(){if(M.length||MM)go()}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["src"]});' +
    '})();</script>'
  );
}
