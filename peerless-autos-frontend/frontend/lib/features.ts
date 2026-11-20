/**
 * Storefront switches from Platform Admin (Themes & releases › Storefront features, Feature flags, dealer Settings):
 *   features.financing — Financing links, sections, payment estimates, calculator / application CTAs
 *   features.tradeIn   — Trade-In links, sections, "Value your trade" CTAs
 * Both are on unless Platform Admin turns them off (an older API without the flags = on).
 *
 * The designs are not edited: when a switch is off the website
 *   · sends visitors of the feature's pages (/financing, /trade-in, Pages & SEO pages about it, their clean addresses)
 *     to the home page (302, so turning it back on works at once)
 *   · leaves those pages out of the menus and sitemap.xml
 *   · marks matching links, buttons and sections data-pa-off (hidden by CSS) in the server HTML, and the browser
 *     runtime (lib/spa.ts) does the same for what the design builds later (vehicle pages, cards, drawers …)
 * Designs can also use {%if feature.financing%}…{%endif%} / {%if feature.tradeIn%}…{%endif%} themselves.
 *
 * Theme contract (themes/README.md › "Financing & Trade-In"), for existing and new designs:
 *   · theme.json "features": { "financing": { pages, routes, sections, paths }, "tradeIn": { … } }
 *   · markup: data-pa-feature="financing" / "tradeIn" on any element (also in markup built by scripts)
 *   · <html data-pa-financing="off" data-pa-trade-in="off" class="pa-no-financing pa-no-trade-in"> + window.SITE.features
 * What a design declares always applies; the wording / name matching below is the fallback for designs that do not
 * declare anything (a design can turn the fallback off with "feature_heuristics": false).
 */
import type { ThemeContext } from './page';
import type { Theme } from './engine';

export interface Flags {
  financing: boolean;
  tradeIn: boolean;
}

export function flagsOf(ctx: Pick<ThemeContext, 'features'> & { financingEnabled?: unknown; tradeInEnabled?: unknown }): Flags {
  const f = ctx.features || {};
  return {
    financing: f.financing !== false && ctx.financingEnabled !== false,
    tradeIn: f.tradeIn !== false && ctx.tradeInEnabled !== false,
  };
}

export const allOn = (f: Flags) => f.financing && f.tradeIn;

/** page names (address parts) of each feature */
export const FIN_SLUGS = [
  'financing', 'finance', 'financing-page', 'get-financing', 'get-approved', 'get-pre-approved', 'apply-for-financing', 'finance-application',
  'financing-application', 'credit-application', 'credit-app', 'pre-approval', 'preapproval', 'pre-approved', 'car-loans', 'auto-loans',
  'auto-financing', 'payment-calculator', 'loan-calculator', 'finance-calculator',
];
export const TRADE_SLUGS = [
  'trade-in', 'tradein', 'trade-ins', 'trade', 'trade-in-page', 'value-your-trade', 'value-my-trade', 'trade-in-value', 'trade-value',
  'trade-appraisal', 'trade-in-appraisal', 'appraise-my-trade',
];

/** link / button / page-title wording of each feature (kept to short texts: see `offText`) */
export const FIN_TEXT = /\b(financ(?:e|es|ed|ing)|get (?:pre-?)?approved|pre-?approv(?:al|ed)|apply (?:now )?for (?:credit|a loan|financing)|credit app(?:lication)?|(?:payment|loan|finance) calculator|calculate (?:your |my )?payments?|auto loans?|car loans?)\b/i;
export const TRADE_TEXT = /\b(trade[- ]?ins?|value (?:your|my) trade|trade(?:-in)? value|appraise (?:your|my) trade|trade appraisal)\b/i;

/** the feature a page name / title belongs to (null = neither) */
export function featureOfPage(slug: string, title = ''): keyof Flags | null {
  const s = slug.toLowerCase().replace(/\.html?$/, '').replace(/^\/+|\/+$/g, '');
  if (FIN_SLUGS.includes(s) || FIN_TEXT.test(title) || /(^|-)financ/.test(s)) return 'financing';
  if (TRADE_SLUGS.includes(s) || TRADE_TEXT.test(title) || /(^|-)trade-?in(-|$)/.test(s)) return 'tradeIn';
  return null;
}

/**
 * Addresses (without "/") that belong to a switched-off feature: the standard names, the dealership's Pages & SEO
 * pages about it, and their clean addresses from SEO & URLs (`cleanPages`: design address → clean address).
 */
export function blockedPaths(flags: Flags, ctx: ThemeContext, cleanPages: Record<string, string> = {}, theme?: Theme | null): Set<string> {
  const out = new Set<string>();
  if (allOn(flags)) return out;
  const off = (k: keyof Flags | null) => !!k && !flags[k];
  // what the design declares (theme.json "features")
  const tf = themeFeatures(theme);
  for (const k of ['financing', 'tradeIn'] as const) {
    if (flags[k]) continue;
    for (const p of tf[k].pages) out.add(p.toLowerCase().replace(/\.html?$/, ''));
    for (const p of tf[k].paths) out.add(p);
    for (const r of tf[k].routes) out.add(r.replace(/^#\/?/, '').toLowerCase());
  }
  if (!flags.financing) FIN_SLUGS.forEach((s) => out.add(s));
  if (!flags.tradeIn) TRADE_SLUGS.forEach((s) => out.add(s));
  for (const p of ctx.pages || []) if (off(featureOfPage(p.slug, p.title))) out.add(p.slug.toLowerCase());
  for (const [from, to] of Object.entries(cleanPages)) {
    const f = from.toLowerCase().replace(/\.html?$/, '');
    if (out.has(f) || off(featureOfPage(f))) out.add(to.replace(/^\/+/, '').toLowerCase());
  }
  for (const s of [...out]) out.add(s + '.html');
  return out;
}

/** true when an address (path, "#hash", "index.html#hash", full URL) points at a blocked page or section */
export function hrefBlocked(href: string, flags: Flags, blocked: Set<string>): boolean {
  if (allOn(flags) || !href) return false;
  let h = href.trim();
  try {
    if (/^https?:\/\//i.test(h)) h = new URL(h).pathname + new URL(h).hash;
  } catch {
    /* keep */
  }
  const hash = h.includes('#') ? h.slice(h.indexOf('#') + 1).replace(/^\/+/, '').toLowerCase() : '';
  const path = h.replace(/[?#].*$/, '').replace(/^\.?\/+/, '').toLowerCase();
  if (path && blocked.has(path)) return true;
  if (hash && (blocked.has(hash) || featureOfPage(hash) && !flags[featureOfPage(hash)!])) return true;
  return false;
}

/** short link / button text of a switched-off feature */
export function offText(text: string, flags: Flags): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return false;
  return (!flags.financing && FIN_TEXT.test(t)) || (!flags.tradeIn && TRADE_TEXT.test(t));
}

/** id / data-key / class of a section that belongs to a switched-off feature */
export function offSectionAttr(value: string, flags: Flags): boolean {
  const v = value.toLowerCase();
  if (!flags.financing && /(^|[\s._-])(financ\w*|fin-calc\w*|loan-calc\w*|payment-calc\w*|pre-?approv\w*)($|[\s._-])/.test(v)) return true;
  if (!flags.tradeIn && /(^|[\s._-])(trade-?in\w*|value-your-trade|trade-value|trade-appraisal)($|[\s._-])/.test(v)) return true;
  return false;
}

/**
 * Hide rules win over the design's own CSS: a design can show its menu links with a more specific
 * `.menu > .dd a { display:block !important }`, so every rule gets two id-level :not()s (specificity 2,x,x).
 */
export const BOOST = ':not(#pa-x):not(#pa-y)';
export const FEATURE_CSS = `<style data-pa>[data-pa-off]${BOOST}{display:none!important}li:has(>[data-pa-off]:only-child)${BOOST}{display:none!important}</style>`;

const stripTags = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/**
 * Server HTML: links, buttons and sections of switched-off features get data-pa-off (hidden by FEATURE_CSS);
 * matching <option>s (contact form topics) are removed. `outside` runs a function outside <script>/<style>.
 */
export function hideFeatures(html: string, flags: Flags, blocked: Set<string>, outside: (h: string, fn: (p: string) => string) => string, heuristics = true): string {
  if (allOn(flags)) return html;
  if (!heuristics) {
    // the design declares its parts itself: only links to blocked addresses are marked
    return outside(html, (part) =>
      part.replace(/(<a\b[^>]*>)/gi, (open: string) => {
        const href = /\shref=(["'])([^"']*)\1/i.exec(open)?.[2] || '';
        const orig = /\sdata-pa-href=(["'])([^"']*)\1/i.exec(open)?.[2] || '';
        return hrefBlocked(href, flags, blocked) || hrefBlocked(orig, flags, blocked) ? open.replace(/^<a/i, '<a data-pa-off') : open;
      }),
    );
  }
  const mark = (tag: string) => (/\sdata-pa-off\b/i.test(tag) ? tag : tag.replace(/^<([a-z][\w-]*)/i, '<$1 data-pa-off'));
  return outside(html, (part) =>
    part
      // sections / blocks by id, data-key or class
      .replace(/<(section|div|aside|article|li|nav|form|p|span)\b[^>]*>/gi, (tag) => {
        const attrs = [...tag.matchAll(/\s(id|data-key|data-section|class)=(["'])([^"']*)\2/gi)].map((m) => m[3]);
        return attrs.some((a) => offSectionAttr(a, flags)) ? mark(tag) : tag;
      })
      // links
      .replace(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi, (m, open: string, inner: string) => {
        const href = /\shref=(["'])([^"']*)\1/i.exec(open)?.[2] || '';
        const orig = /\sdata-pa-href=(["'])([^"']*)\1/i.exec(open)?.[2] || '';
        if (hrefBlocked(href, flags, blocked) || hrefBlocked(orig, flags, blocked) || offText(stripTags(inner), flags)) return mark(open) + inner + '</a>';
        return m;
      })
      // buttons
      .replace(/(<button\b[^>]*>)([\s\S]*?)<\/button>/gi, (m, open: string, inner: string) => (offText(stripTags(inner), flags) ? mark(open) + inner + '</button>' : m))
      // form options ("Financing" contact topic)
      .replace(/<option\b[^>]*>([^<]*)<\/option>/gi, (m, text: string) => (offText(text, flags) ? '' : m)),
  );
}

/* ───────────────── theme contract: what a design declares in theme.json ───────────────── */

export interface FeatureDecl {
  /** design pages of the feature (templates): "financing.html" — 302 to home and out of menus / sitemap when off */
  pages: string[];
  /** single-page views: "#financing-page" — opened at /financing, /trade-in when on; home when off */
  routes: string[];
  /** CSS selectors of its sections / widgets / buttons: "#financing", ".hx-fin", "[data-key=\"home.financing\"]" */
  sections: string[];
  /** more addresses of the feature: "get-approved" */
  paths: string[];
}

const KEY_ALIAS: Record<string, keyof Flags> = { financing: 'financing', finance: 'financing', tradein: 'tradeIn', 'trade-in': 'tradeIn', trade_in: 'tradeIn', trade: 'tradeIn' };
const list = (v: unknown, re: RegExp, max = 40): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
    .map((x) => String(x ?? '').trim())
    .filter((x) => x && x.length <= 200 && re.test(x))
    .slice(0, max);
/** a CSS selector that is safe to put in a <style> rule and querySelectorAll */
const SELECTOR_RE = /^[^{}<>;@\\]+$/;

/** theme.json "features" of a design (missing = nothing declared) */
export function themeFeatures(theme: Theme | null | undefined): Record<keyof Flags, FeatureDecl> & { heuristics: boolean } {
  const empty = (): FeatureDecl => ({ pages: [], routes: [], sections: [], paths: [] });
  const out = { financing: empty(), tradeIn: empty(), heuristics: true };
  const m = (theme?.manifest || {}) as Record<string, unknown>;
  if (m.feature_heuristics === false) out.heuristics = false;
  const decl = m.features;
  if (!decl || typeof decl !== 'object') return out;
  for (const [rawKey, v] of Object.entries(decl as Record<string, unknown>)) {
    const k = KEY_ALIAS[rawKey.toLowerCase()] || (rawKey === 'tradeIn' ? 'tradeIn' : null);
    if (!k || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const d = out[k];
    d.pages.push(...list(o.pages, /^[a-z0-9][a-z0-9_\-/]*\.html$/i));
    d.routes.push(...list(o.routes, /^#[\w\-/]+$/));
    d.sections.push(...list(o.sections, SELECTOR_RE));
    d.paths.push(...list(o.paths, /^\/?[a-z0-9][a-z0-9\-/]*$/i).map((p) => p.replace(/^\/+/, '').toLowerCase()));
  }
  return out;
}

/** attributes for <html>: data-pa-financing="off" class="pa-no-financing" … (designs can style on them) */
export function markRoot(html: string, flags: Flags): string {
  if (allOn(flags)) return html;
  const attrs: string[] = [];
  const classes: string[] = [];
  if (!flags.financing) {
    attrs.push('data-pa-financing="off"');
    classes.push('pa-no-financing');
  }
  if (!flags.tradeIn) {
    attrs.push('data-pa-trade-in="off"');
    classes.push('pa-no-trade-in');
  }
  return html.replace(/<html\b([^>]*)>/i, (_m, a: string) => {
    let rest = a;
    if (/\sclass=(["'])/.test(rest)) rest = rest.replace(/\sclass=(["'])([^"']*)\1/, (_c, q: string, v: string) => ` class=${q}${(v + ' ' + classes.join(' ')).trim()}${q}`);
    else rest += ` class="${classes.join(' ')}"`;
    return `<html${rest} ${attrs.join(' ')}>`;
  });
}

/**
 * CSS that hides a switched-off feature: data-pa-off (marked by the website), data-pa-feature (marked by the design)
 * and the design's declared section selectors — pure CSS, so it works before and without JavaScript.
 */
export function featureCss(flags: Flags, theme?: Theme | null): string {
  if (allOn(flags)) return '';
  const tf = themeFeatures(theme);
  const sel: string[] = ['[data-pa-off]', 'li:has(>[data-pa-off]:only-child)'];
  const feat = (k: keyof Flags, word: string) => {
    if (flags[k]) return;
    sel.push(`[data-pa-feature~="${word}"]`, `li:has(>[data-pa-feature~="${word}"]:only-child)`);
    if (k === 'tradeIn') sel.push('[data-pa-feature~="trade-in"]');
    for (const s of tf[k].sections) sel.push(...s.split(',').map((x) => x.trim()).filter(Boolean));
  };
  feat('financing', 'financing');
  feat('tradeIn', 'tradeIn');
  // one rule per selector: a selector the browser does not understand only drops its own rule
  return '<style data-pa>' + [...new Set(sel)].map((s) => `:is(${s})${BOOST}{display:none!important}`).join('') + '</style>';
}
