import { gunzipSync } from 'zlib';

/**
 * Theme Safety Report + auto-hardening for design ZIPs (Platform Admin › Themes & releases › Install).
 * Goal: no installed design can crash an iPhone tab (iOS WebKit kills a page at roughly 350–500 MB).
 *
 *  Hard reject (the ZIP is not installed):
 *   - a 3D model (.glb / .gltf / .bin) over 12 MB, a video over 4 MB, an image over 3 MB
 *   - more than 30 MB unpacked in total
 *   - no templates/index.html, or a template that points at a theme file ({%asset …%} / {%include …%}) not in the ZIP
 *   (unsafe paths, missing theme.json, PHP … are refused by the installer itself)
 *  Warnings (installed, shown in the report):
 *   - a 3D model over 2 MB without Draco compression (KHR_draco_mesh_compression)
 *   - scripts loaded from another website (CDN) instead of the theme's own assets
 *  Auto-fixes (applied while installing):
 *   - assets/css/pa-mobile-safe.css and assets/js/pa-ios-guard.js added when the design has none, and linked right
 *     before </head> in every template that does not load them yet
 *   - loading="lazy" decoding="async" added to <img> tags below the header (logos, hero and slideshow pictures stay eager)
 */

const MB = 1024 * 1024;
export const SAFETY_LIMITS = { modelMB: 12, videoMB: 4, imageMB: 3, totalMB: 30, dracoWarnMB: 2 } as const;

export interface ThemeFile {
  rel: string;
  data: Buffer;
}
export interface ThemeSafetyReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  fixes: string[];
  stats: { files: number; totalMB: number; templates: number; largestModel: { file: string; mb: number } | null; largestImage: { file: string; mb: number } | null };
}

const mb = (n: number) => Math.round((n / MB) * 100) / 100;
const isModel = (r: string) => /^assets\/.+\.(glb|gltf|bin)$/i.test(r);
const isVideo = (r: string) => /^assets\/.+\.(mp4|webm)$/i.test(r);
const isImage = (r: string) => /^assets\/.+\.(png|jpe?g|webp|gif|avif)$/i.test(r);
const isPage = (r: string) => /^(templates|partials)\/.+\.html$/i.test(r);

/** true when a .glb (or a gzipped .glb saved as .bin) declares Draco compression; null = not a binary glTF */
function usesDraco(data: Buffer): boolean | null {
  let b = data;
  if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) {
    try {
      b = gunzipSync(b, { maxOutputLength: 64 * MB });
    } catch {
      return null;
    }
  }
  if (b.length < 20 || b.toString('latin1', 0, 4) !== 'glTF') return null;
  const jsonLen = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLen > b.length) return null;
  return b.toString('utf8', 20, 20 + jsonLen).includes('KHR_draco_mesh_compression');
}

/** Checks a design before it is installed. `errors` non-empty = refuse the ZIP. */
export function auditTheme(files: ThemeFile[]): ThemeSafetyReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const have = new Set(files.map((f) => f.rel));
  let total = 0;
  let largestModel: { file: string; mb: number } | null = null;
  let largestImage: { file: string; mb: number } | null = null;

  for (const f of files) {
    const size = f.data.length;
    total += size;
    if (isModel(f.rel)) {
      if (!largestModel || size > largestModel.mb * MB) largestModel = { file: f.rel, mb: mb(size) };
      if (size > SAFETY_LIMITS.modelMB * MB) errors.push(`3D model ${f.rel} is ${mb(size)} MB (limit ${SAFETY_LIMITS.modelMB} MB). Compress it (Draco, 512 px textures) and upload again.`);
      else if (size > SAFETY_LIMITS.dracoWarnMB * MB && /\.(glb|bin)$/i.test(f.rel) && usesDraco(f.data) === false) {
        warnings.push(`3D model ${f.rel} is ${mb(size)} MB without Draco compression; compressing it would cut the download several times.`);
      }
    } else if (isVideo(f.rel) && size > SAFETY_LIMITS.videoMB * MB) {
      errors.push(`Video ${f.rel} is ${mb(size)} MB (limit ${SAFETY_LIMITS.videoMB} MB).`);
    } else if (isImage(f.rel)) {
      if (!largestImage || size > largestImage.mb * MB) largestImage = { file: f.rel, mb: mb(size) };
      if (size > SAFETY_LIMITS.imageMB * MB) errors.push(`Image ${f.rel} is ${mb(size)} MB (limit ${SAFETY_LIMITS.imageMB} MB).`);
    }
  }
  if (total > SAFETY_LIMITS.totalMB * MB) errors.push(`The design is ${mb(total)} MB unpacked (limit ${SAFETY_LIMITS.totalMB} MB).`);
  if (!have.has('templates/index.html')) errors.push('templates/index.html is missing.');

  const missing = new Set<string>();
  const cdn = new Set<string>();
  for (const f of files) {
    if (!isPage(f.rel)) continue;
    const html = f.data.toString('utf8');
    for (const m of html.matchAll(/\{%asset\s+([^%]+?)\s*%\}/g)) {
      const a = m[1].trim().split(/[?#]/)[0];
      if (!have.has(`assets/${a}`)) missing.add(`${f.rel} → assets/${a}`);
    }
    for (const m of html.matchAll(/\{%include\s+([^%]+?)\s*%\}/g)) {
      const p = m[1].trim();
      if (!have.has(`partials/${p}`)) missing.add(`${f.rel} → partials/${p}`);
    }
    for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'](https?:)?\/\/([^/"']+)/gi)) cdn.add(m[2].toLowerCase());
  }
  for (const m of [...missing].slice(0, 12)) errors.push(`Missing theme file: ${m}`);
  if (missing.size > 12) errors.push(`…and ${missing.size - 12} more missing theme files.`);
  if (cdn.size) warnings.push(`Scripts are loaded from other websites (${[...cdn].join(', ')}). Bundle them in assets/js so the design works when those sites are slow or down.`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    fixes: [],
    stats: { files: files.length, totalMB: mb(total), templates: files.filter((f) => f.rel.startsWith('templates/')).length, largestModel, largestImage },
  };
}

const LAZY_SKIP = /logo|hero|slide|fetchpriority|loading=|carPhoto|apxMainVehicleImage|gMainImg|class="on"/i;

/** adds loading="lazy" decoding="async" to <img> tags after the first </header> (outside scripts and styles) */
function lazyImages(html: string): { html: string; count: number } {
  const cut = html.search(/<\/header>/i);
  if (cut < 0) return { html, count: 0 };
  let count = 0;
  const head = html.slice(0, cut);
  // split the rest into script/style blocks (left alone) and markup
  const rest = html.slice(cut).split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/i);
  for (let i = 0; i < rest.length; i += 2) {
    rest[i] = rest[i].replace(/<img\b([^>]*)>/gi, (tag, attrs: string) => {
      if (LAZY_SKIP.test(attrs)) return tag;
      count++;
      return `<img loading="lazy"${/decoding=/i.test(attrs) ? '' : ' decoding="async"'}${attrs}>`;
    });
  }
  return { html: head + rest.join(''), count };
}

/** Applies the auto-fixes; returns the new file list and what was changed (for the report). */
export function hardenTheme(files: ThemeFile[]): { files: ThemeFile[]; fixes: string[] } {
  const fixes: string[] = [];
  const out = files.map((f) => ({ ...f }));
  const have = new Set(out.map((f) => f.rel));
  if (!have.has('assets/css/pa-mobile-safe.css')) {
    out.push({ rel: 'assets/css/pa-mobile-safe.css', data: Buffer.from(CANONICAL_MOBILE_SAFE_CSS) });
    fixes.push('Added the platform mobile-safe stylesheet (assets/css/pa-mobile-safe.css).');
  }
  if (!have.has('assets/js/pa-ios-guard.js')) {
    out.push({ rel: 'assets/js/pa-ios-guard.js', data: Buffer.from(CANONICAL_IOS_GUARD_JS) });
    fixes.push('Added the platform iOS guard script (assets/js/pa-ios-guard.js).');
  }
  let linked = 0;
  let lazy = 0;
  for (const f of out) {
    if (!/^templates\/.+\.html$/i.test(f.rel)) continue;
    let html = f.data.toString('utf8');
    const before = html;
    const add: string[] = [];
    if (!html.includes('pa-mobile-safe.css')) add.push('<link rel="stylesheet" href="{%asset css/pa-mobile-safe.css%}" data-pa-mobile-safe>');
    if (!html.includes('pa-ios-guard.js')) add.push('<script src="{%asset js/pa-ios-guard.js%}" defer></script>');
    if (add.length && /<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, add.join('') + '</head>');
      linked++;
    }
    const l = lazyImages(html);
    html = l.html;
    lazy += l.count;
    if (html !== before) f.data = Buffer.from(html, 'utf8');
  }
  if (linked) fixes.push(`Linked the mobile-safe stylesheet / iOS guard right before </head> in ${linked} template${linked === 1 ? '' : 's'}.`);
  if (lazy) fixes.push(`Added loading="lazy" decoding="async" to ${lazy} below-the-fold picture${lazy === 1 ? '' : 's'}.`);
  return { files: out, fixes };
}

/* ---------------- platform-owned files (added only when a design has none of its own) ---------------- */

export const CANONICAL_MOBILE_SAFE_CSS = `/* pa-mobile-safe.css — platform iOS WebKit (Safari) memory guard, added by Platform Admin on install.
   Touch phones / tablets only — (hover: none) and (pointer: coarse), plus iPads that report a trackpad (html.pa-ios,
   set by pa-ios-guard.js). Desktop keeps every effect. Blur, compositor layers and 3D card tilts each cost an extra
   offscreen surface; here they are flattened so the page looks the same with far less graphics memory. */

/* all devices (invisible): CSS animations sleep while their section is off screen or the tab is hidden */
.pa-off,.pa-off *,.pa-off *::before,.pa-off *::after,html.pa-bg *,html.pa-bg *::before,html.pa-bg *::after{animation-play-state:paused!important}

@media (hover: none) and (pointer: coarse) {
  html body *,html body *::before,html body *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;will-change:auto!important;transform-style:flat!important;perspective:none!important}
}
html.pa-ios body *,html.pa-ios body *::before,html.pa-ios body *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;will-change:auto!important;transform-style:flat!important;perspective:none!important}
`;

export const CANONICAL_IOS_GUARD_JS = `/* pa-ios-guard.js — platform iOS memory guard, added by Platform Admin on install (nothing visible changes):
   1. marks touch devices (html.pa-touch) and iPads with a trackpad (html.pa-ios) for pa-mobile-safe.css
   2. CSS animations inside a section pause while that section is off screen or the tab is in the background
   3. window.paOnWidth(fn): run fn on resize only when the WIDTH changed, at most once per 150 ms */
(function () {
  "use strict";
  var root = document.documentElement, n = navigator, m = window.matchMedia;
  var ios = /iP(hone|ad|od)/.test(n.platform || "") || (n.platform === "MacIntel" && (n.maxTouchPoints || 0) > 1);
  var fine = !!(m && m("(hover: hover) and (pointer: fine)").matches), coarse = !!(m && m("(hover: none) and (pointer: coarse)").matches);
  if (window.PA_TOUCH === undefined) window.PA_TOUCH = coarse || ios || ((n.maxTouchPoints || 0) > 0 && !fine);
  if (window.PA_TOUCH) root.classList.add("pa-touch");
  if (ios) root.classList.add("pa-ios");
  if (!window.paOnWidth) window.paOnWidth = function (fn, ms) {
    var w = innerWidth, t = 0;
    addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { if (innerWidth !== w) { w = innerWidth; fn(); } }, ms || 150); }, { passive: true });
  };
  function bg() { root.classList.toggle("pa-bg", document.visibilityState === "hidden"); }
  document.addEventListener("visibilitychange", bg); bg();
  if (!("IntersectionObserver" in window)) return;
  function watch() {
    var list = [].slice.call(document.querySelectorAll("main > section, body > section, main > div > section, .page > section, footer, .pin"));
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { e.target.classList.toggle("pa-off", !e.isIntersecting); }); }, { rootMargin: "250px 0px" });
    list.forEach(function (s) { if (!s.closest("#paDrawer")) io.observe(s); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
})();
`;
