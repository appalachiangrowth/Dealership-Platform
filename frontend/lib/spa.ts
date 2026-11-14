/**
 * Clean addresses for single-page designs (Classic, VroomFox and any design with "hash_routes" in theme.json).
 *
 * These designs switch views by reading location.hash (#/about, #about-page, #/vehicle/<id>, #vehicle-<slug> …).
 * Browsers do not allow location.hash to be redefined, so the website gives the design a virtual hash instead:
 *   · the design's scripts are rewritten as they are served: location.hash → PA_LOC.hash, a[href="#x"] selectors also
 *     match the original link (data-pa-href), el.getAttribute('href') → PA_HREF(el)
 *   · PA_LOC keeps the view's hash in memory and puts the clean address in the address bar (history.pushState);
 *     hashchange is fired by hand, so the design's own router runs unchanged
 *   · links are rewritten to the clean addresses on the server and, for links the design builds later, in the browser
 *   · an old address (/index.html#about-page, /#/inventory) is turned into the clean one when the page opens
 * Default clean addresses (when Platform Admin › SEO & URLs has none): / /inventory /about-us /contact /blog /financing.
 */
import { rawTemplate, type Theme } from './engine';
import type { SeoLinks } from './seo';

export interface SpaRoute {
  /** the design's hash for the view (#/about, #about-page) */
  h: string;
  /** clean address (/about-us) */
  p: string;
  /** element to scroll to after the view opens */
  s?: string;
  /** a real page of its own (Classic's used-cars.html, a Pages & SEO page): normal navigation */
  full?: 1;
  /** Platform Admin page key (about-us, contact-us …) */
  k?: string;
  /** design addresses / default clean addresses that answer with a 301 to `p` */
  old?: string[];
}

export interface SpaConf {
  style: 'classic' | 'hash';
  /** hash of the home view */
  home: string;
  routes: SpaRoute[];
  /** other hashes that mean the same view: #contact → #/contact (plus a section to scroll to) */
  alias: { h: string; to: string; s?: string }[];
  /** #/blog/<slug> ↔ /blog/<slug> */
  prefixes: { h: string; p: string }[];
  /** how the design opens a vehicle */
  vehicle: 'classic' | 'vroomfox' | '';
  base: string;
}

const KEY_DEFAULTS: Record<string, [string, string]> = {
  // view name in the design → [Platform Admin key, default clean address]
  inventory: ['inventory', '/inventory'],
  about: ['about-us', '/about-us'],
  contact: ['contact-us', '/contact'],
  blog: ['blog', '/blog'],
  financing: ['financing', '/financing'],
};

/** The design's single-page routes, or null for designs with real pages per view (Apex, Velocity, Halcyon). */
export function spaConf(theme: Theme, links: SeoLinks, customSlugs: Set<string>): SpaConf | null {
  const index = rawTemplate(theme, 'index.html');
  const hashRoutes = (theme.manifest.hash_routes || null) as Record<string, string> | null;
  const classic = /["']#\/inventory/.test(index) || /\.\/#\/inventory/.test(index);
  if (!classic && !hashRoutes) return null;

  const pages = links.pages || {};
  /** clean address of a page: Platform Admin setting → default */
  const P = (key: string, def: string) => pages[key + '.html'] || pages[key] || def;
  const routes: SpaRoute[] = [];
  const alias: SpaConf['alias'] = [];
  const prefixes: SpaConf['prefixes'] = [];
  const add = (h: string, key: string, def: string, extra: Partial<SpaRoute> = {}) => {
    const p = P(key, def);
    const old = [def, '/' + key + '.html', '/' + key].filter((x, i, a) => x !== p && a.indexOf(x) === i);
    routes.push({ h, p, k: key, old, ...extra });
  };
  const ownPages = new Set((theme.manifest.pages || []).map((p) => p.template));

  if (classic) {
    routes.push({ h: '#/', p: '/', k: 'home' });
    for (const [view, [key, def]] of Object.entries(KEY_DEFAULTS)) {
      if (view === 'financing') continue;
      add('#/' + view, key, def);
    }
    // Classic's used-car pages are real pages of their own
    if (ownPages.has('used-cars.html')) routes.push({ h: '#/used-cars', p: P('used-cars', '/used-cars.html'), full: 1 });
    if (ownPages.has('used-sedans.html')) routes.push({ h: '#/used-cars/sedans', p: P('used-sedans', '/used-sedans.html'), full: 1 });
    prefixes.push({ h: '#/blog/', p: P('blog', '/blog') + '/' });
    for (const v of ['inventory', 'about', 'contact', 'blog']) alias.push({ h: '#' + v, to: '#/' + v, s: v });
    alias.push({ h: '#home', to: '#/' });
  } else {
    routes.push({ h: '#home', p: '/', k: 'home' });
    for (const [view, hash] of Object.entries(hashRoutes || {})) {
      if (!/^#[a-z0-9][\w-]*$/i.test(hash)) continue;
      const [key, def] = KEY_DEFAULTS[view] || [view, '/' + view];
      add(hash, key, def);
      alias.push({ h: '#' + view, to: hash, s: view });
    }
    for (const m of index.matchAll(/href="#(used-(?:cars|sedans|trucks|suvs|wagons))"/g)) {
      if (!routes.some((r) => r.h === '#' + m[1])) add('#' + m[1], m[1], '/' + m[1]);
    }
    if (index.includes("'#post-'") || index.includes('"#post-"') || index.includes('#post-${')) prefixes.push({ h: '#post-', p: P('blog', '/blog') + '/' });
  }

  // a "Financing" section of the home page (or a Pages & SEO page called financing)
  if (/id=["']financing["']/.test(index) || customSlugs.has('financing')) {
    if (customSlugs.has('financing')) routes.push({ h: '#financing', p: P('financing', '/financing'), full: 1 });
    else routes.push({ h: '#financing', p: P('financing', '/financing'), s: 'financing', k: 'financing' });
  }
  // a Pages & SEO page with the same name as a view wins: its link opens the real page
  for (const r of routes) {
    const slug = r.p.replace(/^\/+/, '');
    if (!r.full && r.k !== 'home' && customSlugs.has(slug)) r.full = 1;
  }
  const vehicle = classic ? 'classic' : /['"]#vehicle-['"]|#vehicle-\$\{/.test(index) ? 'vroomfox' : '';
  return { style: classic ? 'classic' : 'hash', home: classic ? '#/' : '#home', routes, alias, prefixes, vehicle, base: links.base || 'inventory' };
}

const lower = (s: string) => s.toLowerCase();

/** the view for a clean address requested from the server: { hash } to show, { redirect } to a newer address, or null */
export function spaMatch(conf: SpaConf, rawPath: string, search: string): { hash: string } | { redirect: string } | null {
  const path = '/' + lower(rawPath).replace(/^\/+|\/+$/g, '');
  for (const r of conf.routes) {
    if (r.full) continue;
    if (lower(r.p) === path) {
      const q = conf.style === 'classic' ? cleanQuery(search) : '';
      return { hash: r.h + (q ? '?' + q : '') };
    }
  }
  for (const r of conf.routes) if (!r.full && r.old?.some((o) => lower(o) === path)) return { redirect: r.p };
  for (const x of conf.prefixes) {
    const p = lower(x.p);
    if (path.startsWith(p) && path.length > p.length && !path.slice(p.length).includes('/')) return { hash: x.h + path.slice(p.length) };
  }
  return null;
}

/** the hash a Platform Admin page key opens (null = no view for it) */
export function spaHashForKey(conf: SpaConf, key: string): string | null {
  const r = conf.routes.find((x) => x.k === key && !x.full);
  return r ? r.h : null;
}

/** query of the address without the website's own parameters (Classic keeps inventory filters in its hash) */
export function cleanQuery(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of [...q.keys()]) if (k === 'tenant' || k === 'id' || k.startsWith('pa_') || k === 'theme') q.delete(k);
  return q.toString();
}

/** hash → its route (clean address) — server copy of the browser's route() for links in the HTML */
function routeOf(conf: SpaConf, hash: string, depth = 0): { p: string; full?: 1 } | null {
  const qi = hash.indexOf('?');
  const h = qi > -1 ? hash.slice(0, qi) : hash;
  const q = qi > -1 ? hash.slice(qi) : '';
  const a = conf.alias.find((x) => x.h === h);
  if (a && depth < 3) return routeOf(conf, a.to + q, depth + 1);
  const r = conf.routes.find((x) => x.h === h);
  if (r) return { p: r.p + (q && !r.full ? q : ''), full: r.full };
  const x = conf.prefixes.find((y) => h.startsWith(y.h) && h.length > y.h.length);
  if (x) return { p: x.p + h.slice(x.h.length) };
  return null;
}

/**
 * New href for a design link, or null to keep it:
 *   index.html → /   ·   index.html#reviews → /#reviews   ·   #about-page / ./#/about / index.html#contact-page → /about-us …
 */
export function mapHashHref(raw: string, conf: SpaConf | null): string | null {
  const m = /^(\.\/|\/)?(index\.html?)?(#.*)?$/i.exec(raw.trim());
  if (!m || (!m[2] && m[3] === undefined)) return null;
  const hash = m[3] || '';
  if (conf && hash && hash !== '#') {
    const r = routeOf(conf, hash);
    if (r) return r.p;
  }
  if (hash === '' || hash === '#') return m[2] ? '/' : null;
  return m[1] || m[2] ? '/' + hash : null;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** applies `fn` to the HTML outside <script> / <style> blocks (links inside the design's scripts are left alone) */
export function outsideScripts(html: string, fn: (part: string) => string): string {
  const re = /<(script|style)\b[\s\S]*?<\/\1\s*>/gi;
  let out = '';
  let at = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out += fn(html.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + fn(html.slice(at));
}

/** Server-side: <a href="index.html#about-page"> → <a href="/about-us" data-pa-href="index.html#about-page"> */
export function rewriteHashLinks(html: string, conf: SpaConf | null): string {
  return outsideScripts(html, (part) => part.replace(/<a\b[^>]*>/gi, (tag) => {
    const m = /\shref=(["'])([^"']*)\1/i.exec(tag);
    if (!m || /\sdata-pa-href=/i.test(tag)) return tag;
    const raw = m[2].replace(/&amp;/g, '&');
    const next = mapHashHref(raw, conf);
    if (next === null || next === raw) {
      // keep it, but let the design's a[href="#x"] selectors find it after the browser rewrites nearby links
      return conf && raw.startsWith('#') ? tag.replace(m[0], `${m[0]} data-pa-href="${escAttr(raw)}"`) : tag;
    }
    return tag.replace(m[0], ` href="${escAttr(next)}" data-pa-href="${escAttr(raw)}"`);
  }));
}

/** The design's JavaScript, reading the virtual hash instead of the address bar. */
export function virtualizeJs(code: string): string {
  return code
    .replace(/(?<![\w$.])(?:(?:window|document|self)\.)?location\.href\s*=\s*(["'`])(?:\.\/|\/)?(?:index\.html?)?#/g, 'PA_LOC.hash = $1#')
    .replace(/(?<![\w$.])(?:(?:window|document|self)\.)?location\.hash\b/g, 'PA_LOC.hash')
    .replace(/\[href([\^$*~|]?)=(\\?["'])(#[^"'\]\\]*)\2\]/g, ':is([href$1=$2$3$2],[data-pa-href$1=$2$3$2])')
    .replace(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.getAttribute\(\s*(["'])href\2\s*\)/g, 'PA_HREF($1)');
}

/** inline design scripts → virtualized; design script files → served through /pa-spa/ (virtualized there) */
export function virtualizeHtml(html: string): string {
  return html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs: string, body: string) => {
      if (/\bsrc\s*=/i.test(attrs) || /\bdata-pa\b/i.test(attrs)) return m;
      if (/\btype\s*=/i.test(attrs) && !/\btype\s*=\s*["']?(?:text\/javascript|module|application\/javascript)\b/i.test(attrs)) return m;
      return `<script${attrs}>${virtualizeJs(body)}</script>`;
    })
    .replace(/(<script\b[^>]*\bsrc=)(["'])(?:\.\/|\/)?(themes\/[a-z0-9][a-z0-9-]*\/\d+\.\d+\.\d+\/assets\/[^"'?#]+\.js)([^"']*)\2/gi, '$1$2/pa-spa/$3$4$2');
}

const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Browser side of SEO & URLs for every design: link rewriting (pages, vehicles, index.html#…) and, for single-page
 * designs, the virtual hash (PA_LOC), click handling, back/forward and per-view title / description.
 */
export function runtimeScript(o: {
  conf: SpaConf | null;
  links: SeoLinks;
  /** id → clean vehicle slug (null = fetched from /pa-seo.json) */
  vehicles: Record<string, string> | null;
  /** this page is the design's single-page shell (its home template) */
  shell: boolean;
  /** view to open: hash, or a vehicle id (VroomFox finds its hash once its data has loaded) */
  init?: { h?: string; v?: string } | null;
}): string {
  const pages = Object.fromEntries(Object.entries(o.links.pages || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const cfg = { C: o.conf, P: pages, B: o.links.base || 'inventory', V: o.vehicles, S: o.shell && !!o.conf, I: o.init || null };
  return `<script data-pa>(function(){var X=${js(cfg)};${RUNTIME}})();</script>`;
}

/* The runtime (ES5, no dependencies). Kept readable: it is small and every design runs it. */
const RUNTIME = `
var W=window,D=document,L=location,H=history,C=X.C,P=X.P,B=X.B,V=X.V,SHELL=X.S,RV=null,seq=0,busy=0;
function low(s){return String(s==null?"":s).toLowerCase()}
function slug(t){return low(t).replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}
function rv(){if(!RV&&V){RV={};for(var k in V)RV[V[k]]=k}return RV||{}}
function tq(sep){var m=/[?&]tenant=([^&#]*)/.exec(L.search);return m?(sep||"?")+"tenant="+m[1]:""}
function withT(p){return p+tq(p.indexOf("?")>-1?"&":"?")}
function live(){return (W.VF_LIVE&&W.VF_LIVE.ids)||{}}
function vid(h){
  if(!C)return null;
  if(C.vehicle==="classic"&&h.indexOf("#/vehicle/")===0){try{return decodeURIComponent(h.slice(10))}catch(e){return h.slice(10)}}
  if(C.vehicle==="vroomfox"&&h.indexOf("#vehicle-")===0){var s=h.slice(9).replace(/^featured-/,""),ids=live();for(var t in ids)if(slug(t)===s)return String(ids[t]);return ""}
  return null}
function vhash(id){
  if(!C||id==null)return null;
  if(C.vehicle==="classic")return "#/vehicle/"+encodeURIComponent(id);
  var ids=live();for(var t in ids)if(String(ids[t])===String(id))return "#vehicle-"+slug(t);return null}
function route(h,d){
  if(!C)return null;h=String(h==null?"":h);if(h&&h.charAt(0)!=="#")h="#"+h;
  var q="",qi=h.indexOf("?"),i,r;if(qi>-1){q=h.slice(qi);h=h.slice(0,qi)}
  if(h===""||h==="#")return {p:"/",h:C.home,s:""};
  for(i=0;i<C.alias.length;i++)if(C.alias[i].h===h&&(d||0)<3){r=route(C.alias[i].to+q,(d||0)+1);if(r&&C.alias[i].s)r.s=C.alias[i].s;return r}
  for(i=0;i<C.routes.length;i++){r=C.routes[i];if(r.h===h)return {p:r.p+(q&&!r.full?q:""),h:h+q,s:r.s||"",full:r.full}}
  for(i=0;i<C.prefixes.length;i++){r=C.prefixes[i];if(h.indexOf(r.h)===0&&h.length>r.h.length)return {p:r.p+h.slice(r.h.length),h:h+q,s:""}}
  var id=vid(h);if(id!=null){var sl=id&&V?V[id]:null;return {p:sl?"/"+B+"/"+sl:null,h:h,s:""}}
  return null}
function cleanQ(s){var o=[];String(s||"").replace(/^\\?/,"").split("&").forEach(function(kv){var k=kv.split("=")[0];if(kv&&k!=="tenant"&&k!=="id"&&k.indexOf("pa_")!==0&&k!=="theme")o.push(kv)});return o.join("&")}
function hashOf(path,search){
  if(!C)return null;path=low(path).replace(/\\/+$/,"")||"/";var i,r;
  for(i=0;i<C.routes.length;i++){r=C.routes[i];if(!r.full&&low(r.p)===path){var q=C.style==="classic"?cleanQ(search):"";return r.h+(q?"?"+q:"")}}
  for(i=0;i<C.prefixes.length;i++){r=C.prefixes[i];var pp=low(r.p);if(path.indexOf(pp)===0&&path.length>pp.length)return r.h+path.slice(pp.length)}
  var m=/^\\/([^\\/]+)\\/([^\\/]+)$/.exec(path);if(m&&m[1]===low(B)&&C.vehicle){var id=rv()[m[2]];if(id!=null){var vh=vhash(id);if(vh)return vh}}
  return null}
/* href → clean address (null = keep) */
function mapHref(raw){
  if(!raw||/^(mailto:|tel:|sms:|javascript:|data:)/i.test(raw))return null;
  var m=/^(\\.\\/|\\/)?(index\\.html?)?(#.*)?$/i.exec(raw);
  if(m&&(m[2]||m[3]!==undefined)){
    var h=m[3]||"";
    if(C&&h&&h!=="#"){var r=route(h);if(r&&r.p)return r.p}
    if(h===""||h==="#")return m[2]?"/":null;
    return (m[1]||m[2])?"/"+h:null}
  try{var u=new URL(raw,D.baseURI);if(u.origin!==L.origin)return null;
    var p=u.pathname.replace(/^\\/+/,"").toLowerCase();
    if(/(^|\\/)vehicle\\.html$/.test(p)){var id=u.searchParams.get("id");if(id&&V&&V[id]){u.searchParams.delete("id");return "/"+B+"/"+V[id]+u.search+u.hash}return null}
    if(P[p])return P[p]+u.search+u.hash;
    if(/(^|\\/)index\\.html?$/.test(p))return "/"+p.replace(/(^|\\/)index\\.html?$/,"")+u.search+u.hash;
  }catch(e){}
  return null}
function fix(a){var h=a.getAttribute("href"),n=mapHref(h);if(n!=null&&n!==h){a.setAttribute("data-pa-href",h);a.setAttribute("href",n)}}
function all(){busy=0;var a=D.querySelectorAll("a[href]");for(var i=0;i<a.length;i++)fix(a[i])}
function soon(){if(!busy){busy=1;(W.requestAnimationFrame||setTimeout)(all)}}
W.PA_HREF=function(el){return el&&el.getAttribute?(el.getAttribute("data-pa-href")||el.getAttribute("href")):null};

/* ---------- virtual hash ---------- */
var cur=C?C.home:"",pendingV=null;
function fire(){var e;try{e=new HashChangeEvent("hashchange",{oldURL:L.href,newURL:L.href})}catch(x){e=D.createEvent("Event");e.initEvent("hashchange",false,false)}W.dispatchEvent(e)}
function scrollTo(s){if(!s)return;setTimeout(function(){var el=D.getElementById(s);if(el&&el.offsetParent!==null&&el.scrollIntoView)el.scrollIntoView({behavior:"smooth",block:"start"})},80)}
function setMeta(sel,attr,name,val){var m=D.querySelector(sel);if(!m){m=D.createElement("meta");m.setAttribute(attr,name);D.head.appendChild(m)}m.setAttribute("content",val)}
function meta(path){
  var n=++seq;try{fetch("/pa-seo.json?path="+encodeURIComponent(String(path||"/").split("?")[0])+tq("&"),{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(d){
    if(n!==seq||!d)return;
    if(d.title){D.title=d.title;setMeta('meta[property="og:title"]',"property","og:title",d.title)}
    if(d.description){setMeta('meta[name="description"]',"name","description",d.description);setMeta('meta[property="og:description"]',"property","og:description",d.description)}
    if(d.canonical){var c=D.querySelector('link[rel="canonical"]');if(c)c.setAttribute("href",d.canonical);setMeta('meta[property="og:url"]',"property","og:url",d.canonical)}
  }).catch(function(){})}catch(e){}}
function go(h,replace,s){
  var r=route(h),path;
  if(r&&r.full){L.assign(withT(r.p));return}
  if(r){h=r.h;path=r.p||(L.pathname+L.search);s=s||r.s}
  else{
    /* a section of the view on screen: just scroll to it */
    var id=String(h).replace(/^#/,""),el=id?D.getElementById(id):null;
    if(el&&el.offsetParent!==null){scrollTo(id);return}
    path="/";s=s||id}
  var url=r&&!r.p?path:withT(path),changed=h!==cur;
  if(L.pathname+L.search!==url||changed)H[replace?"replaceState":"pushState"]({pa:h},"",url);
  if(changed){cur=h;fire()}
  scrollTo(s);
  if(path!==(W.__paMetaPath||"")){W.__paMetaPath=path;meta(path)}}
W.PA_LOC={
  get hash(){if(!SHELL)return L.hash;if(pendingV!=null){var vh=vhash(pendingV);if(vh){cur=vh;pendingV=null;try{H.replaceState({pa:cur},"",L.pathname+L.search)}catch(e){}}}return cur},
  set hash(v){v=String(v==null?"":v);if(v&&v.charAt(0)!=="#")v="#"+v;
    if(!SHELL){var r=route(v);if(r&&r.p){L.assign(withT(r.p));return}L.hash=v;return}
    go(v,false)}};

if(SHELL){
  if(X.I&&X.I.h)cur=X.I.h;
  if(X.I&&X.I.v!=null){var vh0=vhash(X.I.v);if(vh0)cur=vh0;else pendingV=X.I.v}
  var bootScroll="";
  if(/\\/index\\.html?$/i.test(L.pathname))H.replaceState(null,"",L.pathname.replace(/index\\.html?$/i,"")+L.search+L.hash);
  if(L.hash&&L.hash!=="#"){var r0=route(L.hash);
    if(r0&&r0.full){L.replace(withT(r0.p))}
    else if(r0){cur=r0.h;bootScroll=r0.s;H.replaceState({pa:cur},"",r0.p?withT(r0.p):L.pathname+L.search)}
    else{cur=L.hash;bootScroll=L.hash.slice(1);H.replaceState({pa:cur},"",L.pathname+L.search)}}
  else H.replaceState({pa:cur},"",L.pathname+L.search);
  W.__paMetaPath=L.pathname;
  W.addEventListener("popstate",function(e){var h=(e.state&&e.state.pa)||hashOf(L.pathname,L.search)||C.home;if(h!==cur){cur=h;fire()}W.__paMetaPath=L.pathname;meta(L.pathname)});
  /* clicks the design did not handle itself: open the view, no reload, clean address */
  W.addEventListener("click",function(e){
    if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;
    if(!a||(a.target&&a.target!=="_self")||a.hasAttribute("download"))return;
    var raw=a.getAttribute("data-pa-href")||a.getAttribute("href")||"",t=null,m=/^(?:\\.\\/|\\/)?(?:index\\.html?)?(#.*)$/i.exec(raw);
    if(m){if(m[1]==="#")return;var r=route(m[1]);if(r&&r.full)return;t={h:r?r.h:m[1],s:r?r.s:m[1].slice(1)}}
    else{try{var u=new URL(a.getAttribute("href"),D.baseURI);if(u.origin!==L.origin)return;var hh=hashOf(u.pathname,u.search);
      if(hh!=null)t={h:hh,s:u.hash?u.hash.slice(1):""};
      else if((u.pathname==="/"||/\\/index\\.html?$/i.test(u.pathname))&&u.hash&&u.hash!=="#"){var r2=route(u.hash);if(r2&&r2.full)return;t={h:r2?r2.h:u.hash,s:r2?r2.s:u.hash.slice(1)}}
    }catch(x){}}
    if(!t)return;e.preventDefault();go(t.h,false,t.s)});
  W.addEventListener("load",function(){scrollTo(bootScroll);meta(L.pathname)});
}
D.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(a)fix(a)},true);
function start(){all();try{new MutationObserver(soon).observe(D.documentElement,{childList:true,subtree:true})}catch(e){}}
if(D.readyState==="loading")D.addEventListener("DOMContentLoaded",start);else start();
W.addEventListener("load",soon);
if(!V){try{fetch("/pa-seo.json"+tq(),{credentials:"same-origin"}).then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.vehicles){V=d.vehicles;RV=null;if(d.base)B=d.base;soon()}}).catch(function(){})}catch(e){}}
`;
