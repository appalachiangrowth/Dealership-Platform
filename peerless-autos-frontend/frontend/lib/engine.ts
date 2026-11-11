/**
 * TEMPLATE ENGINE — TypeScript port of platform/lib/content.php (pa_render_string & friends).
 *
 * The five website designs are the ORIGINAL theme files, unchanged:
 *   frontend/themes/<id>/<version>/theme.json, templates/*.html, partials/*.html
 *   frontend/public/themes/<id>/<version>/assets/…   (css, js, images, 3D models — served as-is)
 * so every page looks and works exactly like before. Only the server behind them changed.
 *
 * Markers: {%text key | Default%} {%para%} {%head key hl="cls"%} {%link%} {%img%} {%js%} {%site key%} {%siteurl key%}
 *          {%sitejs key%} {%asset path%} {%raw NAME%} {%include file.html%} {%if site.x%}…{%endif%} {%show content.key%}…{%endshow%}
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { CONTENT_FIELDS } from './content.schema';
import { h, hDecode, isLocalAsset, jsonHex, nl2br, safeUrl } from './php';

const THEMES_DIR = join(process.cwd(), 'themes');
const MARKER_RE = /\{%(text|para|head|link|img|js|site|siteurl|sitejs|asset|raw)\s+([A-Za-z0-9_.\/\-]+)((?:\s+[a-z]+="[^"]*")*)\s*(?:\|(.*?))?%\}/gs;

export interface ThemeManifest {
  id: string;
  name: string;
  version: string;
  pages: { id: string; label: string; template: string; sitemap?: boolean }[];
  design?: { colors?: { var: string; label: string; default: string; also?: string[]; hint?: string }[] };
  content_map?: Record<string, string>;
  [k: string]: unknown;
}

export interface Theme {
  id: string;
  version: string;
  dir: string;
  url: string;
  manifest: ThemeManifest;
}

const cache = new Map<string, unknown>();
const cached = <T>(key: string, fn: () => T): T => {
  if (process.env.NODE_ENV !== 'production') return fn();
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key) as T;
};

const versionCmp = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** pa_themes_installed: { id: [versions ascending] } — re-read every 15 s so designs installed from Platform Admin appear without a restart */
let installedAt = 0;
let installedList: Record<string, string[]> | null = null;
export function themesInstalled(): Record<string, string[]> {
  if (installedList && Date.now() - installedAt < 15_000) return installedList;
  installedAt = Date.now();
  return (installedList = (() => {
    const out: Record<string, string[]> = {};
    if (!existsSync(THEMES_DIR)) return out;
    for (const id of readdirSync(THEMES_DIR)) {
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) continue;
      const vers = readdirSync(join(THEMES_DIR, id)).filter((v: string) => /^\d+\.\d+\.\d+$/.test(v) && existsSync(join(THEMES_DIR, id, v, 'theme.json')));
      if (vers.length) out[id] = vers.sort(versionCmp);
    }
    return out;
  })());
}

/** Resolves the design (and version) to render; falls back like pa_theme_for_tenant. */
export function loadTheme(id: string, version: string): Theme {
  const inst = themesInstalled();
  const tid = inst[id] ? id : inst['classic'] ? 'classic' : Object.keys(inst)[0];
  if (!tid) throw new Error('No theme installed');
  const vers = inst[tid];
  const ver = tid === id && vers.includes(version) ? version : vers[vers.length - 1];
  const dir = join(THEMES_DIR, tid, ver);
  const manifest = cached(`m:${tid}@${ver}`, () => JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')) as ThemeManifest);
  return { id: tid, version: ver, dir, url: `themes/${tid}/${ver}`, manifest };
}

/** A template file as written (partials not expanded). "partials/x.html" reads a partial. */
export function rawTemplate(theme: Theme, file: string): string {
  if (!/^[a-z0-9][a-z0-9_\-\/]*\.html$/.test(file) || file.includes('..')) return '';
  const path = join(theme.dir, file.includes('/') ? file : join('templates', file));
  return cached(`f:${path}`, () => (existsSync(path) ? readFileSync(path, 'utf8') : ''));
}

/** {%include x.html%} → the partial (up to 4 levels deep) */
function expandIncludes(theme: Theme, src: string, depth = 0): string {
  if (depth > 3) return src;
  return src.replace(/\{%include\s+([a-z0-9_\-\/]+\.html)\s*%\}/g, (_m: string, f: string) =>
    expandIncludes(theme, rawTemplate(theme, 'partials/' + f.split('/').pop()), depth + 1),
  );
}

/** pa_tpl_source: template with {%include%} partials expanded */
function tplSource(theme: Theme, file: string): string {
  return expandIncludes(theme, rawTemplate(theme, file));
}

function markerAttrs(s: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const m of (s || '').matchAll(/([a-z]+)="([^"]*)"/g)) a[m[1]] = m[2];
  return a;
}

function subst(s: string, tokens: Record<string, unknown>): string {
  if (!s.includes('{')) return s;
  return s.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in tokens ? String(tokens[k] ?? '') : m));
}

/** pa_initials ("Sarah M." → "SM") */
function initials(name: string): string {
  const parts = String(name).replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
  let s = '';
  for (const p of parts) if (p !== '') s += Array.from(p)[0].toUpperCase();
  return Array.from(s).slice(0, 2).join('');
}

function cvalShape(v: string, markerType: string, fieldType: string): string {
  if (fieldType === 'head' && markerType !== 'head') v = v.replace(/\*([^*\n]+)\*/g, '$1');
  if (markerType === 'text' || markerType === 'js') v = v.replace(/\s*\n\s*/g, ' ').trim();
  return v;
}

/** pa_cval: dealer text for shared keys, otherwise the theme's own default wording. */
export function cval(type: string, key: string, def: string, values: Record<string, string>, map: Record<string, string> = {}): string {
  const k = map[key] ?? key;
  const f = CONTENT_FIELDS[k];
  if (f) {
    if (k in values) {
      const v = String(values[k]);
      if (v !== '' || f.type === 'para') return cvalShape(v, type, f.type);
    }
    return cvalShape(String(f.default), type, f.type);
  }
  const r = k.match(/^home\.reviews\.r([1-3])_initials$/);
  if (r) return initials(cval('text', `home.reviews.r${r[1]}_name`, '', values));
  return String(def).trim();
}

function fmtHead(text: string, hl: string): string {
  let out = h(text).replace(/\*([^*\n]+)\*/g, (_m, w: string) => (hl === 'em' ? `<em>${w}</em>` : `<span class="${h(hl !== '' ? hl : 'hl')}">${w}</span>`));
  out = out.replace(/\n/g, '<br>');
  return out;
}

function fmtLinks(escaped: string): string {
  return escaped.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (_m, label: string, url: string) => {
    const u = safeUrl(hDecode(url));
    if (u === '' || u === '#') return label;
    const ext = /^https?:\/\//i.test(u) ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${h(u)}"${ext}>${label}</a>`;
  });
}

function fmtValue(type: string, v: string, attrs: Record<string, string>, tokens: Record<string, unknown>): string {
  v = subst(v, tokens);
  switch (type) {
    case 'text':
      return h(v.replace(/\n/g, ' '));
    case 'para':
      return nl2br(fmtLinks(h(v)));
    case 'head':
      return fmtHead(v, attrs.hl ?? '');
    case 'link': {
      const u = safeUrl(v);
      return h(u === '' ? '#' : u);
    }
    case 'img':
      return h(safeUrl(v, !isLocalAsset(v)));
    case 'js':
      return jsonHex(v);
  }
  return '';
}

export interface RenderCtx {
  values: Record<string, string>;
  tokens: Record<string, any>;
  raw: Record<string, string>;
  features: Record<string, boolean>;
  /** Live preview for the Dealership Portal editor: editable texts are wrapped in <!--pa:…--> … <!--/pa--> comments. */
  live?: boolean;
}

/** Parts of a page where an editable-text marker must stay plain: <script>, <style>, <title>, comments … */
function plainRegions(src: string): { bodyAt: number; regions: [number, number][] } {
  const regions: [number, number][] = [];
  for (const m of src.matchAll(/<!--[\s\S]*?-->|<(script|style|title|textarea|noscript|template)\b[\s\S]*?<\/\1\s*>/gi)) regions.push([m.index!, m.index! + m[0].length]);
  regions.sort((a, b) => a[0] - b[0]);
  const b = src.search(/<body[\s>]/i);
  return { bodyAt: b < 0 ? 0 : b, regions };
}

/** True when position `at` of `src` is ordinary page text (not inside a tag/attribute, <script>, <title>, <head> …). */
function isTextPosition(src: string, plain: ReturnType<typeof plainRegions>, at: number): boolean {
  if (at < plain.bodyAt) return false;
  if (src.lastIndexOf('<', at - 1) > src.lastIndexOf('>', at - 1)) return false; // inside <tag …>
  let lo = 0;
  let hi = plain.regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, z] = plain.regions[mid];
    if (at < a) hi = mid - 1;
    else if (at >= z) lo = mid + 1;
    else return false;
  }
  return true;
}

const liveAttr = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D');

/** pa_render_template */
export function renderTemplate(theme: Theme, file: string, ctx: RenderCtx): string {
  return renderSource(theme, tplSource(theme, file), ctx);
}

/** Renders template text that is not a file (custom pages built from Platform Admin › Pages & SEO). */
export function renderSource(theme: Theme, source: string, ctx: RenderCtx): string {
  let src = expandIncludes(theme, source);
  const { values, tokens, raw, features } = ctx;
  const map = (theme.manifest.content_map || {}) as Record<string, string>;
  const real = (tokens._real && typeof tokens._real === 'object' ? tokens._real : {}) as Record<string, unknown>;

  src = src.replace(/\{%show\s+(!?)content\.([A-Za-z0-9_.]+)\s*%\}([\s\S]*?)\{%endshow%\}/g, (_m, neg: string, k: string, body: string) => {
    const on = cval('para', k, '', values, map).trim() !== '';
    return on !== (neg === '!') ? body : '';
  });

  src = src.replace(/\{%if\s+(!?)([a-z]+)\.([A-Za-z0-9_.]+)\s*%\}([\s\S]*?)\{%endif%\}/g, (_m, neg: string, ns: string, k: string, body: string) => {
    let on = false;
    if (ns === 'site') on = k in tokens && String(tokens[k] ?? '').trim() !== '' && tokens[k] !== '#' && (!(k in real) || !!real[k]);
    else if (ns === 'feature') on = !!features[k];
    else if (ns === 'content') on = cval('para', k, '', values, map).trim() !== '';
    return on !== (neg === '!') ? body : '';
  });

  const plain = ctx.live ? plainRegions(src) : null;
  return src.replace(MARKER_RE, (_m, type: string, key: string, attrStr: string, def: string | undefined, at: number) => {
    const attrs = markerAttrs(attrStr);
    if (ctx.live && (type === 'text' || type === 'para' || type === 'head')) {
      const k = map[key] ?? key;
      const f = CONTENT_FIELDS[k];
      const out = fmtValue(type, cval(type, key, def ?? '', values, map), attrs, tokens);
      if (!f || !plain || !isTextPosition(src, plain, at)) return out;
      return `<!--pa:${k}:${type}:${f.type}:${liveAttr(attrs.hl ?? '')}-->${out}<!--/pa-->`;
    }
    switch (type) {
      case 'site':
        return h(tokens[key] ?? '');
      case 'siteurl':
        return h(safeUrl(tokens[key] ?? '') || '#');
      case 'sitejs':
        return jsonHex(String(tokens[key] ?? ''));
      case 'asset':
        return h(theme.url + '/assets/' + key.replace(/\.\./g, '').replace(/^\/+/, ''));
      case 'raw':
        return raw[key] ?? '';
    }
    return fmtValue(type, cval(type, key, def ?? '', values, map), attrs, tokens);
  });
}

/** Saved colour key (primary, dark …) → the design's CSS variable. */
const COLOR_VARS: Record<string, Record<string, string>> = {
  classic: { primary: '--color-primary', dark: '--color-navy', accent: '--home-accent' },
  atelier: { primary: '--color-primary', accent: '--hub-accent', dark: '--color-navy' },
  'apex-drift': { primary: '--color-primary', accent: '--sodium', dark: '--asphalt' },
  halcyon: { accent: '--sr-accent', dark: '--sr-night', light: '--sr-paper', paint: '--sr-paint' },
  vroomfox: { primary: '--blue', dark: '--blue-d' },
};

/** pa_design_css: the dealer's brand colours as CSS variables (only colours they changed). */
export function designCss(theme: Theme, saved: Record<string, string>): string {
  const byVar: Record<string, string> = {};
  const map = COLOR_VARS[theme.id] || {};
  for (const [k, v] of Object.entries(saved || {})) if (map[k]) byVar[map[k]] = v;
  for (const [k, v] of Object.entries(saved || {})) if (k.startsWith('--')) byVar[k] = v; // CSS-var keyed values also work
  const vars: string[] = [];
  for (const c of theme.manifest.design?.colors || []) {
    const v = byVar[c.var] || '';
    if (v === '' || !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v)) continue;
    for (const cv of [c.var, ...(Array.isArray(c.also) ? c.also : [])]) if (/^--[a-z0-9\-]+$/.test(cv)) vars.push(`${cv}:${v}`);
  }
  return vars.length ? `<style id="pa-design">:root{${vars.join(';')}}</style>` : '';
}

/** Content keys used by each page of a design — lets the editor open the page where a text appears. */
export function templateKeys(theme: Theme): { template: string; label: string; keys: string[] }[] {
  const map = (theme.manifest.content_map || {}) as Record<string, string>;
  return (theme.manifest.pages || []).map((p) => {
    const keys = new Set<string>();
    for (const m of tplSource(theme, p.template).matchAll(MARKER_RE)) {
      if (!['text', 'para', 'head', 'link', 'img', 'js'].includes(m[1])) continue;
      const k = map[m[2]] ?? m[2];
      if (CONTENT_FIELDS[k]) keys.add(k);
    }
    for (const m of tplSource(theme, p.template).matchAll(/\{%(?:show|if)\s+!?content\.([A-Za-z0-9_.]+)/g)) {
      const k = map[m[1]] ?? m[1];
      if (CONTENT_FIELDS[k]) keys.add(k);
    }
    return { template: p.template, label: p.label, keys: [...keys] };
  });
}

/** Saved colour key → every CSS variable it sets in this design (for live colour changes in the preview). */
export function colorVarMap(theme: Theme): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const map = COLOR_VARS[theme.id] || {};
  for (const c of theme.manifest.design?.colors || []) {
    const vars = [c.var, ...(Array.isArray(c.also) ? c.also : [])].filter((v) => /^--[a-z0-9\-]+$/.test(v));
    out[c.var] = vars;
    for (const [k, v] of Object.entries(map)) if (v === c.var) out[k] = vars;
  }
  return out;
}
