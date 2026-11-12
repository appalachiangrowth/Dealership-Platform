/**
 * CUSTOM PAGES — pages built in Platform Admin › Pages & SEO.
 *
 * A custom page has no design of its own. It is rendered INSIDE the dealership's current theme:
 *   - the theme's own <head>, header (menu), footer and scripts come from one of the theme's page templates
 *     (the "shell"), with the main content cut out and replaced by the page's sections;
 *   - the sections are styled with CSS variables that point at the theme's own variables (brand colours,
 *     fonts, corner radius), so they follow the dealer's colours and change look when the theme changes.
 * Published pages can also get a menu link: injectNav() adds it to the theme's desktop and mobile menus
 * on every page of the website.
 */
import { rawTemplate, type Theme } from './engine';
import { renderPage, type ThemeContext } from './page';
import { h, safeUrl } from './php';
import { absSiteUrl, siteTokens, siteTokensDisplay } from './tokens';

/* ============================================================================ types */

export type Block = { id?: string; type: string; tone?: string; pad?: string; [k: string]: any };
export interface CustomPage {
  slug: string;
  title: string;
  sections: Block[];
  seo?: { title?: string; description?: string; image?: string; noindex?: boolean };
}
export interface NavItem {
  slug: string;
  label: string;
}
/** a vehicle as /inventory.json publishes it */
export type InvVehicle = Record<string, any>;

/* ============================================================================ per-theme knowledge */

interface Shell {
  /** page template whose header + footer are used */
  template: string;
  /** cut out everything between `start` and `end` (both kept) */
  start: string;
  end: string;
  /** the content area is not inside a <main> already */
  wrapMain?: boolean;
  /** one-page theme: the header lives inside the home hero (VroomFox) */
  header?: RegExp;
  /** hash links (#about-page) point at the home page */
  singlePage?: boolean;
  /** the header floats over the first section: the page starts with a dark band */
  overlayHeader?: boolean;
  /** remove the theme's inline page scripts after the content (they only drive the home page sections) */
  dropInlineScripts?: boolean;
  /** small script that runs the header (menu button, dropdowns) instead */
  headerScript?: string;
}

interface Links {
  home: string;
  inventory: string;
  contact: string;
  about: string;
  category: (cat: string) => string;
  vehicle: (v: InvVehicle) => string;
  /** inventory filtered by make (empty = not supported) */
  make?: (make: string) => string;
}

interface NavSlot {
  /** the opening tag of the menu element (start of it is enough) */
  open: string;
  item: string; // {href} {label} {current}
  /** insert before this text inside the menu (e.g. the call button), otherwise at the end */
  before?: string;
  /** the links sit in a list inside the menu element (e.g. "<ul"): they are added to that list */
  inside?: string;
}

interface ThemeKit {
  shell: Shell;
  links: Links;
  nav: NavSlot[];
  /** CSS variables of the sections, mostly pointing at the theme's own variables */
  vars: Record<string, string>;
  /** extra CSS for this theme: its own buttons, headings, labels and cards (the "skin") */
  css?: string;
  /** web fonts the skin needs that the shell page doesn't load */
  fonts?: string;
}

const slugOf = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const vid = (v: InvVehicle) => encodeURIComponent(String(v.id ?? ''));

/* ============================================================================ theme skins
 * The sections are built once; each theme's skin dresses them in that theme's own design language —
 * its buttons, heading style, small labels, cards and section backgrounds — copied from the theme's CSS.
 * (".pa-page " in front so the skin wins over the shared base styles.)
 */

/** Classic: Manrope headings, "── LABEL" eyebrows, 9px buttons with a soft brand shadow */
const CLASSIC_SKIN =
  '.pa-page .pa-eyebrow{display:inline-flex;align-items:center;gap:12px;font:600 12px/1 var(--pa-fh);letter-spacing:.22em;color:var(--pa-primary);margin-bottom:14px}' +
  '.pa-page .pa-eyebrow::before{content:"";width:34px;height:2px;border-radius:2px;background:currentColor}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-eyebrow{color:#4DA3FF}' +
  '.pa-page .pa-title{letter-spacing:var(--ls-heading,-.01em);font-size:calc(clamp(1.7rem,3vw,2.4rem) * var(--scale-heading,1));line-height:1.15}' +
  '.pa-page .pa-title--xl{font-size:calc(clamp(2.3rem,5vw,3.9rem) * var(--scale-heading,1));line-height:1.08}' +
  '.pa-page .pa-btn{padding:14px 28px;font-family:var(--font-button,var(--pa-fb));font-weight:var(--fw-button,600);font-size:calc(14.5px * var(--scale-button,1));text-transform:var(--btn-transform,none);background:var(--btn-primary-bg,var(--pa-primary));box-shadow:0 10px 24px color-mix(in srgb,var(--pa-primary) 35%,transparent);border:0}' +
  '.pa-page .pa-btn:hover{background:var(--btn-primary-hover-bg,var(--pa-primary-hover))}' +
  '.pa-page .pa-btn--ghost{background:transparent;border:2px solid var(--btn-hub-ghost-border,#b9d2f5);color:var(--pa-primary)!important;box-shadow:none}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-btn--ghost{border-color:rgba(255,255,255,.55);color:#fff!important}.pa-page .pa-sec[data-tone="dark"] .pa-btn--ghost:hover{background:rgba(255,255,255,.12);border-color:#fff}' +
  '.pa-page .pa-card,.pa-page .pa-car,.pa-page .pa-stat,.pa-page .pa-form{box-shadow:0 10px 30px rgba(6,43,73,.08)}' +
  '.pa-page .pa-hero:not(.pa-hero--img){background:linear-gradient(135deg,var(--hub-hero-from,var(--pa-dark)),var(--hub-hero-to,color-mix(in srgb,var(--pa-dark) 80%,var(--pa-primary))))}' +
  '.pa-page .pa-hero .pa-eyebrow{color:var(--hub-eyebrow,#4DA3FF)}';

/** Apex Drift: night asphalt, Michroma gauge labels, tight Anybody display type, amber pill buttons */
const APEX_SKIN =
  '.pa-page .pa-eyebrow{font:400 .62rem/1.3 var(--pa-fe);letter-spacing:.2em;margin-bottom:20px}' +
  '.pa-page .pa-title{letter-spacing:-.035em;line-height:.98;text-wrap:balance}' +
  '.pa-page .pa-title--xl{font-size:clamp(2.75rem,6.4vw,5.5rem);line-height:.96}' +
  '.pa-page .pa-btn{padding:13px 22px;font-weight:800;border:1px solid transparent;background:var(--sodium,var(--pa-primary));color:var(--sodium-ink,var(--pa-on-primary))!important;box-shadow:0 12px 30px -14px var(--sodium,var(--pa-primary))}' +
  '.pa-page .pa-btn:hover{background:var(--sodium,var(--pa-primary));box-shadow:0 18px 40px -14px var(--sodium,var(--pa-primary))}' +
  '.pa-page .pa-btn--ghost{background:rgba(255,255,255,.05);border-color:rgba(238,243,250,.18);color:#EEF3FA!important;box-shadow:none}' +
  '.pa-page .pa-card,.pa-page .pa-car,.pa-page .pa-stat{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.02))}' +
  '.pa-page .pa-car-body small,.pa-page .pa-badge{font-family:var(--pa-fe);font-weight:400;font-size:.55rem;letter-spacing:.14em}' +
  '.pa-page .pa-hero:not(.pa-hero--img){background:radial-gradient(ellipse 70% 90% at 80% 0%,color-mix(in srgb,var(--pa-accent) 16%,transparent),transparent 70%),var(--pa-dark)}';

/** Halcyon: midnight showroom — mono labels with a hairline, stretched UPPERCASE titles with an italic serif
 *  highlight word, tall red-gradient pill buttons with a glow, glassy outline buttons on dark */
const HALCYON_SKIN =
  '.pa-page .pa-eyebrow{display:flex;align-items:center;gap:14px;margin-bottom:24px;font:500 12px/1 var(--pa-fe);letter-spacing:.2em;color:var(--pa-muted)}' +
  '.pa-page .pa-eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--pa-accent);box-shadow:0 0 10px var(--pa-accent)}' +
  '.pa-page .pa-eyebrow::after{content:"";width:42px;height:1px;background:currentColor;opacity:.6}' +
  '.pa-page .pa-center .pa-eyebrow{justify-content:center}' +
  '.pa-page .pa-title{font-stretch:112%;letter-spacing:-.035em;line-height:.96;font-size:clamp(34px,4.3vw,68px)}' +
  '.pa-page .pa-title--xl{font-size:clamp(42px,6vw,96px);line-height:.94;letter-spacing:-.04em}' +
  '.pa-page .pa-hl{font-family:var(--pa-fs);font-style:italic;font-weight:400;font-stretch:100%;text-transform:none;letter-spacing:-.02em;padding-right:.06em}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-hl{background:linear-gradient(100deg,#fff 0%,#c9d0db 28%,#fff 46%,#8f99a8 66%,#e9edf3 100%);-webkit-background-clip:text;background-clip:text;color:transparent}' +
  '.pa-page .pa-btn{min-height:58px;padding:0 28px;gap:14px;font:700 13.5px/1 var(--pa-fh);font-stretch:108%;letter-spacing:.1em;text-transform:uppercase;border:1px solid transparent;background:linear-gradient(135deg,var(--pa-primary) 0%,var(--pa-primary-hover) 100%);box-shadow:0 14px 34px -12px color-mix(in srgb,var(--pa-primary) 60%,transparent),inset 0 1px 0 rgba(255,255,255,.25)}' +
  '.pa-page .pa-btn:hover{background:linear-gradient(135deg,var(--pa-primary) 0%,var(--pa-primary-hover) 100%);box-shadow:0 22px 46px -14px color-mix(in srgb,var(--pa-primary) 60%,transparent)}' +
  '.pa-page .pa-btn svg{width:30px;height:30px;padding:7px;border-radius:50%;background:rgba(0,0,0,.22);margin-right:-14px}' +
  '.pa-page .pa-btn--ghost{background:var(--pa-head);color:#fff!important;box-shadow:0 16px 36px -16px rgba(10,13,19,.6)}.pa-page .pa-btn--ghost:hover{background:var(--pa-primary)}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-btn--ghost{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.2);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-btn--ghost:hover{background:#fff;color:#0a0d13!important;border-color:#fff}' +
  '.pa-page .pa-sec[data-tone="dark"]{--pa-card:color-mix(in srgb,var(--pa-dark) 88%,#ffffff);--pa-muted:#8e98a8}' +
  '.pa-page .pa-card,.pa-page .pa-car,.pa-page .pa-stat,.pa-page .pa-form{box-shadow:0 20px 40px -32px rgba(10,13,19,.4)}' +
  '.pa-page .pa-car-body small,.pa-page .pa-badge,.pa-page .pa-info small,.pa-page .pa-car-specs span{font-family:var(--pa-fe)}' +
  '.pa-page .pa-hero:not(.pa-hero--img){background:radial-gradient(ellipse 50% 70% at 78% 30%,rgba(46,78,140,.38),transparent 70%),radial-gradient(ellipse 40% 50% at 80% 110%,color-mix(in srgb,var(--pa-accent) 30%,transparent),transparent 70%),linear-gradient(180deg,#04060b,#080b14)}' +
  '.pa-page .pa-hero .pa-lead{color:#aeb7c6}';

/** Atelier: warm clay — cream paper, Manrope titles with tight tracking and a Playfair highlight word,
 *  "── LABEL" in rust, rounded clay buttons, soft paper cards */
const ATELIER_SKIN =
  '.pa-page .pa-eyebrow{display:flex;align-items:center;gap:12px;font:700 10px/1.4 var(--pa-fb);letter-spacing:.19em;color:#8b4e36;margin-bottom:22px}' +
  '.pa-page .pa-eyebrow::before{content:"";width:30px;height:1px;background:currentColor;opacity:.78}' +
  '.pa-page .pa-center .pa-eyebrow{justify-content:center}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-eyebrow{color:#d0a08a}' +
  '.pa-page .pa-title{letter-spacing:-.065em;line-height:1.05;font-size:clamp(36px,4.6vw,68px);text-wrap:balance}' +
  '.pa-page .pa-title--xl{font-size:clamp(48px,6.3vw,100px);line-height:.96;letter-spacing:-.075em;font-weight:700}' +
  '.pa-page .pa-hl{font-family:var(--pa-fs);font-weight:500;letter-spacing:-.055em}' +
  '.pa-page .pa-sec[data-tone="dark"]{--pa-text:#f3dfd0;--pa-head:#fff1e5;--pa-muted:rgba(243,223,208,.72)}' +
  '.pa-page .pa-btn{min-height:51px;padding:0 22px;gap:20px;font:700 12px/1 var(--pa-fb);letter-spacing:.005em;border:0;box-shadow:0 10px 30px rgba(57,27,17,.17)}' +
  '.pa-page .pa-btn:hover{transform:translateY(-3px)}' +
  '.pa-page .pa-btn--ghost{background:rgba(255,243,231,.12);border:1px solid rgba(52,29,22,.35);color:#2a1712!important;box-shadow:none}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-btn--ghost{background:#f8e9dd;border-color:rgba(69,40,27,.13);color:#3d241b!important}' +
  '.pa-page .pa-card,.pa-page .pa-car,.pa-page .pa-stat,.pa-page .pa-form,.pa-page .pa-faq details{box-shadow:0 18px 40px -30px rgba(57,27,17,.35)}' +
  '.pa-page .pa-card-icon{background:color-mix(in srgb,var(--pa-primary) 12%,#fff8f1)}' +
  '.pa-page .pa-hero:not(.pa-hero--img){background:radial-gradient(60% 90% at 85% 10%,color-mix(in srgb,var(--pa-accent-dark) 45%,transparent),transparent 70%),linear-gradient(135deg,var(--pa-dark),color-mix(in srgb,var(--pa-dark) 70%,var(--pa-primary)))}' +
  '.pa-page .pa-hero:not(.pa-hero--img)::before{display:none}' +
  '.pa-page .pa-hero .pa-lead{color:rgba(255,241,229,.8)}';

/** VroomFox: Montserrat 800 titles, Poppins text, blue kicker labels, 46px pill buttons */
const VROOMFOX_SKIN =
  '.pa-page .pa-eyebrow{display:flex;align-items:center;gap:12px;font:600 12px/1 var(--pa-fb);letter-spacing:.16em}' +
  '.pa-page .pa-eyebrow::before{content:"";width:26px;height:2px;border-radius:2px;background:currentColor}' +
  '.pa-page .pa-center .pa-eyebrow{justify-content:center}' +
  '.pa-page .pa-title{letter-spacing:-.035em;line-height:1.1;font-size:clamp(30px,3.6vw,46px)}' +
  '.pa-page .pa-title--xl{font-size:clamp(38px,5.4vw,68px);line-height:1.04}' +
  '.pa-page .pa-btn{height:46px;padding:0 26px;font:600 13px/1 var(--pa-fb);border:0;box-shadow:0 12px 26px -14px var(--pa-primary)}' +
  '.pa-page .pa-btn--ghost{background:#05070d;color:#fff!important;box-shadow:none}.pa-page .pa-btn--ghost:hover{background:var(--pa-primary)}' +
  '.pa-page .pa-sec[data-tone="dark"] .pa-btn--ghost{background:rgba(10,20,36,.35);border:1.5px solid rgba(255,255,255,.75);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
  '.pa-page .pa-card,.pa-page .pa-car,.pa-page .pa-stat,.pa-page .pa-form{box-shadow:0 18px 40px -28px rgba(14,26,51,.35)}' +
  '.pa-page .pa-hero:not(.pa-hero--img){background:linear-gradient(120deg,#0E1A33,color-mix(in srgb,var(--pa-primary) 45%,#0E1A33))}';

const MULTI_PAGE_LINKS: Links = {
  home: 'index.html',
  inventory: 'inventory.html',
  contact: 'contact-us.html',
  about: 'about-us.html',
  category: (c) => `used-${c}.html`,
  vehicle: (v) => `vehicle.html?id=${vid(v)}`,
  make: (m) => `inventory.html?make=${encodeURIComponent(m)}`,
};

const APEX_VARS = {
  '--pa-primary': '{c:--color-primary}',
  '--pa-accent': 'var(--sodium, {c:--color-primary})',
  '--pa-accent-dark': 'var(--sodium, {c:--color-primary})',
  '--pa-on-primary': '#1A1206',
  '--pa-dark': '{c:--asphalt}',
  '--pa-bg': '{c:--asphalt}',
  '--pa-alt': 'color-mix(in srgb, {c:--asphalt} 95%, #ffffff)',
  '--pa-card': 'rgba(255,255,255,.045)',
  '--pa-text': '#EEF3FA',
  '--pa-head': '#FFFFFF',
  '--pa-muted': 'rgba(238,243,250,.68)',
  '--pa-line': 'rgba(255,255,255,.1)',
  '--pa-fh': 'var(--display, "Anybody", "Arial Narrow", system-ui, sans-serif)',
  '--pa-fb': 'var(--body, "Hanken Grotesk", system-ui, sans-serif)',
  '--pa-fe': '"Michroma", Arial, sans-serif',
  '--pa-radius': '20px',
  '--pa-btn-radius': '999px',
  '--pa-head-weight': '800',
  '--pa-head-case': 'none',
  '--pa-top': '96px',
};

export const THEME_KITS: Record<string, ThemeKit> = {
  classic: {
    shell: { template: 'used-cars.html', start: '{%include site-header.html%}', end: '{%include site-footer.html%}', wrapMain: true },
    links: {
      home: './',
      inventory: './#/inventory',
      contact: './#/contact',
      about: './#/about',
      category: (c) => `used-${c}.html`,
      vehicle: (v) => `./#/vehicle/${vid(v)}`,
    },
    nav: [
      { open: '<div class="nav-links" id="navLinks">', item: '<a href="{href}" data-nav="pa-{slug}"{current}>{label}</a>' },
      { open: '<div class="mobile-menu" id="mobileMenu">', item: '<a href="{href}">{label}</a>', before: 'class="btn btn-primary btn-block"' },
    ],
    vars: {
      '--pa-primary': '{c:--color-primary}',
      '--pa-primary-hover': 'var(--color-primary-dark, color-mix(in srgb, {c:--color-primary} 85%, #000))',
      '--pa-accent': '{c:--color-primary}',
      '--pa-accent-dark': '{c:--home-accent}',
      '--pa-on-primary': 'var(--btn-text, #FFFFFF)',
      '--pa-dark': '{c:--color-navy}',
      '--pa-bg': '#FFFFFF',
      '--pa-alt': 'var(--color-gray, #F5F7FA)',
      '--pa-card': '#FFFFFF',
      '--pa-text': 'var(--text, #111827)',
      '--pa-head': '#0B1F3A',
      '--pa-muted': 'var(--muted, #5B6B7B)',
      '--pa-line': 'var(--line, #E3EAF2)',
      '--pa-fh': 'var(--font-heading, "Manrope", system-ui, sans-serif)',
      '--pa-fb': 'var(--font-body, "Inter", system-ui, sans-serif)',
      '--pa-fe': 'var(--font-heading, "Manrope", system-ui, sans-serif)',
      '--pa-radius': 'var(--radius, 12px)',
      '--pa-btn-radius': 'var(--btn-radius, 9px)',
      '--pa-head-weight': 'var(--fw-display, 800)',
      '--pa-head-case': 'var(--heading-transform, none)',
      '--pa-top': '118px',
    },
    css: CLASSIC_SKIN,
  },
  'apex-drift': {
    shell: { template: 'pages.html', start: '<main class="apx-main">', end: '<footer class="apx-home-footer"' },
    links: MULTI_PAGE_LINKS,
    nav: [
      { open: '<nav class="nav" aria-label="Main">', item: '<a href="{href}"{current}>{label}</a>' },
      { open: '<div class="apx-mobile-nav" id="apxMobileNav"', item: '<a href="{href}">{label}</a>' },
    ],
    vars: APEX_VARS,
    css: APEX_SKIN,
  },
  atelier: {
    shell: { template: 'pages.html', start: '<main class="apx-main">', end: '<footer class="apx-home-footer"' },
    links: MULTI_PAGE_LINKS,
    nav: [
      { open: '<nav class="nav" aria-label="Main">', item: '<a href="{href}"{current}>{label}</a>' },
      { open: '<div class="apx-mobile-nav" id="apxMobileNav"', item: '<a href="{href}">{label}</a>' },
      // the Atelier home page has its own header
      { open: '<nav class="desktop-nav"', item: '<a href="{href}">{label}</a>' },
      { open: '<nav class="mobile-nav" id="mobileNav"', item: '<a href="{href}">{label} <span>↗</span></a>', before: 'class="mobile-nav-bottom"' },
    ],
    vars: {
      '--pa-primary': '{c:--color-primary}',
      '--pa-primary-hover': 'color-mix(in srgb, {c:--color-primary} 78%, #000)',
      '--pa-accent': 'color-mix(in srgb, {c:--color-primary} 88%, #ffffff)',
      '--pa-accent-dark': '{c:--hub-accent}',
      '--pa-on-primary': '#FFF4E8',
      '--pa-dark': '{c:--color-navy}',
      '--pa-bg': '#F6E9DE',
      '--pa-alt': '#F1DCCB',
      '--pa-card': '#FFF8F1',
      '--pa-text': '#4D3028',
      '--pa-head': '#2C1913',
      '--pa-muted': '#75564B',
      '--pa-line': 'rgba(61,34,26,.19)',
      '--pa-fh': '"Manrope", system-ui, sans-serif',
      '--pa-fb': '"DM Sans", system-ui, sans-serif',
      '--pa-fe': '"DM Sans", system-ui, sans-serif',
      '--pa-fs': '"Playfair Display", Georgia, serif',
      '--pa-radius': '22px',
      '--pa-btn-radius': '999px',
      '--pa-head-weight': '600',
      '--pa-head-case': 'none',
      '--pa-top': '96px',
    },
    css: ATELIER_SKIN,
    fonts: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Manrope:wght@500;600;700;800&family=Playfair+Display:wght@500&display=swap',
  },
  halcyon: {
    shell: { template: 'pages.html', start: '<main id="main">', end: '</main>', overlayHeader: true },
    links: MULTI_PAGE_LINKS,
    nav: [
      { open: '<nav class="sr-topnav"', item: '<a href="{href}"{current}>{label}</a>' },
      { open: '<div class="mobile-nav" id="mobileNav"', item: '<a href="{href}">{label} <span>↗</span></a>' },
    ],
    vars: {
      '--pa-primary': '{c:--sr-accent}',
      '--pa-primary-hover': 'color-mix(in srgb, {c:--sr-accent} 70%, #000)',
      '--pa-accent': '{c:--sr-accent}',
      '--pa-accent-dark': '{c:--sr-accent}',
      '--pa-on-primary': '#FFFFFF',
      '--pa-dark': '{c:--sr-night}',
      '--pa-bg': '{c:--sr-paper}',
      '--pa-alt': 'color-mix(in srgb, {c:--sr-paper} 92%, #000000)',
      '--pa-card': '#FFFFFF',
      '--pa-text': '#1B1F27',
      '--pa-head': '#0A0D13',
      '--pa-muted': '#5C6170',
      '--pa-line': 'rgba(10,13,19,.12)',
      '--pa-fh': 'Archivo, "Helvetica Neue", Arial, system-ui, sans-serif',
      '--pa-fb': 'Archivo, "Helvetica Neue", Arial, system-ui, sans-serif',
      '--pa-fe': '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      '--pa-fs': '"Instrument Serif", "Times New Roman", Georgia, serif',
      '--pa-radius': '26px',
      '--pa-btn-radius': '999px',
      '--pa-head-weight': '800',
      '--pa-head-case': 'uppercase',
      '--pa-top': '110px',
    },
    css: HALCYON_SKIN,
  },
  vroomfox: {
    shell: {
      template: 'index.html',
      start: '<section class="hero" id="hero">',
      end: '<footer class="sitefoot"',
      header: /<header class="nav">[\s\S]*?<\/header>/,
      singlePage: true,
      dropInlineScripts: true,
      headerScript:
        "(function(){var b=document.getElementById('burger'),m=document.getElementById('menu');if(b&&m){b.addEventListener('click',function(){var o=m.classList.toggle('open');b.setAttribute('aria-expanded',o);});}" +
        "document.querySelectorAll('.pa-vf-top .has-sub').forEach(function(li){var t=li.querySelector('.trig');if(t)t.addEventListener('click',function(e){e.stopPropagation();var o=li.classList.toggle('open');t.setAttribute('aria-expanded',o);});});" +
        "document.addEventListener('click',function(){document.querySelectorAll('.pa-vf-top .has-sub.open').forEach(function(li){li.classList.remove('open');});});})();",
    },
    links: {
      home: 'index.html',
      inventory: 'index.html#inventory-page',
      contact: 'index.html#contact-page',
      about: 'index.html#about-page',
      category: (c) => `index.html#used-${c}`,
      vehicle: (v) => `index.html#vehicle-${slugOf(String(v.title || '').trim() || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' '))}`,
    },
    nav: [{ open: '<ul class="nav__list" id="menu">', item: '<li><a href="{href}"{current}>{label}</a></li>' }],
    vars: {
      '--pa-primary': '{c:--blue}',
      '--pa-primary-hover': '{c:--blue-d}',
      '--pa-accent': '{c:--blue}',
      '--pa-accent-dark': 'color-mix(in srgb, {c:--blue} 70%, #ffffff)',
      '--pa-on-primary': '#FFFFFF',
      '--pa-dark': 'color-mix(in srgb, {c:--blue-d} 22%, #0A1222)',
      '--pa-bg': '#FFFFFF',
      '--pa-alt': '#F2F6FD',
      '--pa-card': '#FFFFFF',
      '--pa-text': 'var(--ink, #0f1b2d)',
      '--pa-head': '#0E1A33',
      '--pa-muted': 'var(--muted, #6B7687)',
      '--pa-line': '#E2E8F2',
      '--pa-fh': 'Montserrat, system-ui, sans-serif',
      '--pa-fb': 'Poppins, system-ui, sans-serif',
      '--pa-fe': 'Poppins, system-ui, sans-serif',
      '--pa-radius': '22px',
      '--pa-btn-radius': '999px',
      '--pa-head-weight': '800',
      '--pa-head-case': 'none',
      '--pa-top': '0px',
    },
    css:
      VROOMFOX_SKIN +
      '.pa-vf-top{position:relative;z-index:30;color:#fff;background:linear-gradient(120deg,#0E1A33,color-mix(in srgb,var(--blue,#1F7BFF) 45%,#0E1A33));padding:10px 0}' +
      '.pa-vf-top .nav{position:relative}',
  },
};

/* ============================================================================ any installed theme
 * Custom pages must work in EVERY installed design — the built-in ones, a design uploaded later under a new id
 * (Velocity), a new version of a design, or a design deleted and installed again. So a design is never matched by
 * its id alone:
 *   1. theme.json "custom_page" (if the theme describes itself) always wins;
 *   2. otherwise the built-in kit whose layout the theme's markup actually uses (its own, or the one it was built
 *      from — Velocity uses the Apex Drift header, menus and content area, so it gets the Apex kit);
 *   3. otherwise the header + mobile menus are found in the theme's templates (detectNav) and the content area is
 *      the theme's <main> (shellSource), so the pages still appear in the menu and inside the theme.
 */
type CustomPageManifest = Partial<{
  template: string;
  start: string;
  end: string;
  overlay_header: boolean;
  vars: Record<string, string>;
  nav: NavSlot[];
  links: Partial<Record<'home' | 'inventory' | 'contact' | 'about' | 'category' | 'vehicle', string>>;
}>;

/** a template with its {%include%} partials put in (themes like Classic keep the header in a partial) */
function fullTemplate(theme: Theme, file: string): string {
  let src = rawTemplate(theme, file);
  for (let i = 0; i < 4 && src.includes('{%include'); i++) {
    src = src.replace(/\{%include\s+([a-z0-9_\-\/]+\.html)\s*%\}/g, (_m, f: string) => rawTemplate(theme, 'partials/' + f.split('/').pop()));
  }
  return src;
}

/** the theme's markup uses this built-in kit's layout: same content area markers and at least one of its menus */
function usesLayoutOf(theme: Theme, kit: ThemeKit): boolean {
  const src = rawTemplate(theme, kit.shell.template);
  if (!src) return false;
  if (kit.shell.start && !src.includes(kit.shell.start)) return false;
  if (kit.shell.end && !src.includes(kit.shell.end)) return false;
  if (kit.shell.header && !kit.shell.header.test(src)) return false;
  const full = fullTemplate(theme, kit.shell.template);
  return kit.nav.some((s) => full.includes(s.open));
}

const MENU_HINT = /(^|[\s"'_-])(nav|navbar|navigation|menu|drawer|offcanvas|sidebar|mobile)/i;
const NOT_A_MENU = /breadcrumb|pagination|pager|social|footer|tabs?\b|filter|sort/i;
/** links to other pages of the website (not #anchors, phone, e-mail, outside sites or dealer links) */
const PAGE_LINK = /<a\s[^>]*href="(?!#|tel:|mailto:|https?:|\{%)[^"]+"/gi;

/**
 * Finds the theme's header menu and mobile menu(s) in its templates, for designs that no kit knows.
 * A menu is a <nav> (or an element whose class/id says nav/menu/drawer/mobile) above the footer that links to at
 * least two pages of the website; the element that holds the links itself is used.
 */
function detectNav(theme: Theme, files: string[]): NavSlot[] {
  const out: NavSlot[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const src = fullTemplate(theme, file);
    if (!src) continue;
    const foot = src.search(/<footer\b/i);
    const limit = foot < 0 ? src.length : foot;
    const found: { s: number; e: number; open: string; tag: string }[] = [];
    const re = /<(nav|ul|ol|div|aside)\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) && m.index < limit) {
      const tag = m[1].toLowerCase();
      const attrs = m[2];
      const idClass = (attrs.match(/\s(?:id|class)="[^"]*"/gi) || []).join(' ');
      if (tag !== 'nav' && !MENU_HINT.test(idClass)) continue;
      if (NOT_A_MENU.test(idClass) || /aria-label="[^"]*(breadcrumb|pagination)/i.test(attrs)) continue;
      const e = closeOf(src, m.index, tag);
      if (e < 0) continue;
      if ((src.slice(m.index + m[0].length, e).match(PAGE_LINK) || []).length < 2) continue;
      found.push({ s: m.index, e, open: m[0], tag });
    }
    // the element that holds the links itself (a <div class="menu"><nav>…</nav></div> → the <nav>)
    const holders = found.filter((c) => !found.some((o) => o !== c && o.s > c.s && o.e <= c.e));
    for (const c of holders) {
      // the start of the opening tag up to the first template marker: it reads the same on the rendered page
      let open = c.open;
      const marker = open.indexOf('{%');
      if (marker > 0) open = open.slice(0, marker);
      if (open.length < 5 || seen.has(open)) continue;
      // a bare <nav> / <ul> could be any menu on the page — it must be unique in the template
      if (src.split(open).length - 1 !== 1) continue;
      seen.add(open);
      const body = src.slice(c.s + c.open.length, c.e);
      // links inside a list: <ul><li><a>, or <nav><ul><li><a> (then they go into that list)
      const list = c.tag === 'nav' || c.tag === 'div' || c.tag === 'aside' ? body.match(/^\s*<(ul|ol)\b/i) : null;
      const inList = /^(ul|ol)$/.test(c.tag) || /^\s*<li\b/i.test(body) || !!list;
      const anchors = body.match(/<a\s[^>]*>/gi) || [];
      const plain = anchors.find((a) => !/class="[^"]*\b(btn|button|cta|logo)\b/i.test(a)) || '';
      const cls = ((plain.match(/\sclass="([^"{]*)"/) || [])[1] || '').replace(/\b(active|is-active|current)\b/g, '').replace(/\s+/g, ' ').trim();
      const a = `<a${cls ? ` class="${cls}"` : ''} href="{href}"{current}>{label}</a>`;
      // a call / quote button at the end of the menu stays the last item
      const last = anchors[anchors.length - 1] || '';
      const btn = /class="[^"]*\b(btn|button|cta)\b/i.test(last) ? (last.match(/class="[^"]*"/i) || [])[0] : undefined;
      out.push({ open, item: inList ? `<li>${a}</li>` : a, ...(btn ? { before: btn } : {}), ...(list ? { inside: '<' + list[1].toLowerCase() } : {}) });
      if (out.length >= 4) return out;
    }
  }
  return out;
}

/** the {c:--x} colour variables a value uses are all colours of this theme */
const usesOwnColours = (value: string, names: Set<string>) => [...value.matchAll(/\{c:(--[a-z0-9-]+)\}/gi)].every((x) => names.has(x[1]));

function buildKit(theme: Theme): ThemeKit {
  const cp = (theme.manifest.custom_page || {}) as CustomPageManifest;
  const own = THEME_KITS[theme.id];
  // a built-in design, unchanged layout, nothing in theme.json: exactly as before
  if (own && !theme.manifest.custom_page && usesLayoutOf(theme, own)) return own;
  // the built-in layout this theme is made of (a new design built from Apex Drift, or a new version of a design)
  const base = Object.values(THEME_KITS).find((k) => usesLayoutOf(theme, k));

  const pages = (theme.manifest.pages || []).map((p) => p.template);
  const has = (t: string) => pages.includes(t);
  const template = cp.template || ['pages.html', 'about-us.html', 'contact-us.html', 'inventory.html', 'index.html'].find(has) || 'index.html';
  const colors = theme.manifest.design?.colors || [];
  const names = new Set(colors.flatMap((c) => [c.var, ...(Array.isArray(c.also) ? c.also : [])]));
  const pick = (re: RegExp) => colors.find((c) => re.test(c.var + ' ' + c.label));
  const primary = colors[0];
  const dark = pick(/dark|navy|night|asphalt/i);
  const tpl = (s: string | undefined, fallback: (x: string) => string) => (s ? (x: string) => s.replace('{x}', x) : fallback);
  const links: Links = {
    home: cp.links?.home || 'index.html',
    inventory: cp.links?.inventory || (has('inventory.html') ? 'inventory.html' : './#/inventory'),
    contact: cp.links?.contact || (has('contact-us.html') ? 'contact-us.html' : './#/contact'),
    about: cp.links?.about || (has('about-us.html') ? 'about-us.html' : './#/about'),
    category: tpl(cp.links?.category, (c) => (has(`used-${c}.html`) ? `used-${c}.html` : has('inventory.html') ? 'inventory.html' : './#/inventory')),
    vehicle: cp.links?.vehicle ? (v) => cp.links!.vehicle!.replace('{id}', vid(v)) : has('vehicle.html') ? (v) => `vehicle.html?id=${vid(v)}` : (v) => `./#/vehicle/${vid(v)}`,
    ...(has('inventory.html') ? { make: (m: string) => `inventory.html?make=${encodeURIComponent(m)}` } : {}),
  };
  // menus: theme.json → the matching built-in layout → found in the templates → the old kit of this id
  const detected = (cp.nav || base) ? [] : detectNav(theme, [template, 'index.html', ...pages.filter((p) => p !== template && p !== 'index.html')]);
  const nav = cp.nav || base?.nav || (detected.length ? detected : own?.nav) || [];
  // colours of the matching layout, as long as this theme has those colour variables
  const baseVars = Object.fromEntries(Object.entries(base?.vars || own?.vars || {}).filter(([, v]) => usesOwnColours(v, names)));
  return {
    shell: cp.template || !base ? { template, start: cp.start || '', end: cp.end || '', overlayHeader: !!cp.overlay_header } : base.shell,
    links: cp.links || !base ? links : base.links,
    nav,
    vars: {
      ...THEME_KITS.classic.vars,
      '--pa-primary': primary ? `{c:${primary.var}}` : '#2563EB',
      '--pa-primary-hover': primary ? `color-mix(in srgb, {c:${primary.var}} 85%, #000)` : '#1D4ED8',
      '--pa-accent': primary ? `{c:${primary.var}}` : '#2563EB',
      '--pa-accent-dark': primary ? `{c:${primary.var}}` : '#60A5FA',
      '--pa-dark': dark ? `{c:${dark.var}}` : '#0F172A',
      '--pa-fh': 'inherit',
      '--pa-fb': 'inherit',
      '--pa-fe': 'inherit',
      ...baseVars,
      ...(cp.vars || {}),
    },
    // the skin only where the markup is the one it was made for
    css: base?.css,
    fonts: base?.fonts,
  };
}

/** per installed design version; re-checked every 30 s so a design deleted and installed again is picked up */
const kits = new Map<string, { at: number; kit: ThemeKit }>();
export function kitFor(theme: Theme): ThemeKit {
  const key = theme.dir;
  const hit = kits.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.kit;
  const kit = buildKit(theme);
  kits.set(key, { at: Date.now(), kit });
  return kit;
}

/* ============================================================================ the shell */

/** index of the matching closing tag for the element whose opening tag starts at `at` */
function closeOf(html: string, at: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = at;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index;
  }
  return -1;
}

/** "#about-page" → "index.html#about-page" (one-page themes: the header must lead back to the home page) */
const homeHashes = (s: string) => s.replace(/href="#([^"]*)"/g, (_m, x: string) => `href="index.html${x ? '#' + x : ''}"`);

/** the theme template with its content area replaced by the markers {%raw PA_PAGE%} etc. */
function shellSource(theme: Theme, kit: ThemeKit): string {
  const sh = kit.shell;
  let src = rawTemplate(theme, sh.template) || rawTemplate(theme, 'index.html');

  let a = sh.start ? src.indexOf(sh.start) : -1;
  let b = sh.end ? src.indexOf(sh.end, Math.max(0, a)) : -1;
  let header = '';
  if (sh.header) {
    const m = src.match(sh.header);
    if (m) header = homeHashes(m[0]);
  }
  if (a < 0 || b < 0) {
    // unknown layout: the inside of <main>, or between the first </header> and the last <footer
    const main = src.search(/<main\b[^>]*>/i);
    if (main >= 0) {
      a = src.indexOf('>', main) + 1;
      b = src.indexOf('</main>', a);
    }
    if (a < 0 || b < 0 || b < a) {
      const hEnd = src.search(/<\/header>/i);
      a = hEnd >= 0 ? hEnd + 9 : src.search(/<body[^>]*>/i);
      b = src.lastIndexOf('<footer');
      if (a < 0) a = 0;
      if (b < a) b = src.search(/<\/body>/i);
    }
  } else if (!sh.header) {
    a += sh.start.length; // keep the start marker itself (e.g. <main class="apx-main"> or the header include)
    if (sh.start.startsWith('<') && !sh.start.endsWith('>')) a = src.indexOf('>', a) + 1;
  }

  // the header must not mark another page (Home) as the current one
  let before = src.slice(0, a).replace(/(<body[^>]*>)([\s\S]*)$/i, (_m, body: string, rest: string) => body + rest.replace(/\saria-current="page"/g, ''));
  let after = src.slice(b);
  if (sh.dropInlineScripts) after = after.replace(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
  if (sh.headerScript) after = after.replace(/<\/body>/i, `<script>${sh.headerScript}</script></body>`);
  if (sh.singlePage) {
    before = before.replace(/(<body[^>]*>)([\s\S]*)$/i, (_m, body: string, rest: string) => body + homeHashes(rest));
    after = homeHashes(after);
  }
  const top = header ? `<div class="pa-vf-top">${header.replace(/\saria-current="page"/g, '')}</div>` : '';
  src = before + top + '{%raw PA_PAGE%}' + after;

  // <head>: the page's own title / description / share text
  src = src
    .replace(/<title>[\s\S]*?<\/title>/i, '<title>{%raw PA_TITLE%}</title>')
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, '$1{%raw PA_DESC%}$2')
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, '$1{%raw PA_TITLE%}$2')
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, '$1{%raw PA_DESC%}$2')
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i, '$1{%raw PA_TITLE%}$2')
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i, '$1{%raw PA_DESC%}$2');
  if (!/rel="canonical"/.test(src)) src = src.replace(/<\/head>/i, '<link rel="canonical" href="{%raw CANONICAL%}"></head>');
  src = src.replace(/<\/head>/i, '{%raw PA_STYLE%}</head>');
  // the theme's page scripts must not think this is their own page
  src = src.replace(/<body([^>]*)>/i, (_m, attrs: string) => `<body${attrs.replace(/\sdata-(page|nav)="[^"]*"/g, '')} data-page="custom" data-nav="custom">`);
  return src;
}

/* ============================================================================ menu links on every page */

/** Adds the published custom pages that are "shown in the menu" to the theme's desktop + mobile menus. */
export function injectNav(html: string, theme: Theme, items: NavItem[], current = ''): string {
  if (!items.length) return html;
  const kit = kitFor(theme);
  for (const slot of kit.nav) {
    let at = html.indexOf(slot.open);
    if (at < 0) continue;
    let tag = (slot.open.match(/^<([a-z0-9]+)/i) || [])[1];
    if (!tag) continue;
    let close = closeOf(html, at, tag);
    if (close < 0) continue;
    if (slot.inside) {
      // the list inside the menu element
      const li = html.indexOf(slot.inside, at + 1);
      const ltag = (slot.inside.match(/^<([a-z0-9]+)/i) || [])[1];
      const lclose = li > at && li < close && ltag ? closeOf(html, li, ltag) : -1;
      if (lclose > li && lclose <= close) {
        at = li;
        tag = ltag!;
        close = lclose;
      }
    }
    const links = items
      .map((i) =>
        slot.item
          .replace(/\{href\}/g, h(i.slug))
          .replace(/\{slug\}/g, h(i.slug))
          .replace(/\{label\}/g, h(i.label))
          .replace(/\{current\}/g, i.slug === current ? ' aria-current="page" class="active is-active"' : '')
          // one class attribute when the menu links have their own class
          .replace(/(<a\b[^>]*?\sclass=")([^"]*)("[^>]*?) class="active is-active"/, '$1$2 active is-active$3'),
      )
      .join('');
    let at2 = close;
    if (slot.before) {
      const b = html.lastIndexOf(slot.before, close);
      let tagStart = b > at ? html.lastIndexOf('<', b) : -1;
      // list menus: before the button's <li>
      if (tagStart > at && slot.item.startsWith('<li')) {
        const liStart = html.lastIndexOf('<li', tagStart);
        if (liStart > at && !html.slice(liStart, tagStart).includes('</li>')) tagStart = liStart;
      }
      if (tagStart > at) at2 = tagStart;
    }
    html = html.slice(0, at2) + links + html.slice(at2);
  }
  return html;
}

/* ============================================================================ text helpers */

type Tokens = Record<string, any>;
const sub = (s: unknown, t: Tokens) => String(s ?? '').replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in t && typeof t[k] !== 'object' ? String(t[k] ?? '') : m));
const txt = (s: unknown, t: Tokens) => h(sub(s, t));

/** **bold**, *italic*, [label](link) on already escaped text */
function inline(escaped: string, links: Links, t: Tokens): string {
  return escaped
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (_m, label: string, url: string) => {
      const u = link(url.replace(/&amp;/g, '&'), links, t);
      const ext = /^https?:\/\//i.test(u) ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${h(u)}"${ext}>${label}</a>`;
    });
}

/** Simple formatting for long text: paragraphs, "## " headings, "- " lists, **bold**, *italic*, [links](url) */
function rich(src: unknown, links: Links, t: Tokens): string {
  const blocks = sub(src, t).replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  return blocks
    .filter((b) => b.trim())
    .map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(h(l.replace(/^\s*[-•*]\s+/, '')), links, t)}</li>`).join('') + '</ul>';
      if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) return '<ol>' + lines.map((l) => `<li>${inline(h(l.replace(/^\s*\d+[.)]\s+/, '')), links, t)}</li>`).join('') + '</ol>';
      // "## heading" lines, then the rest of the block as a paragraph
      let out = '';
      let para: string[] = [];
      const flushPara = () => {
        if (para.length) out += '<p>' + para.map((l) => inline(h(l), links, t)).join('<br>') + '</p>';
        para = [];
      };
      for (const l of lines) {
        const head = l.match(/^\s*#{2,3}\s+(.+)$/);
        if (head) {
          flushPara();
          out += `<h3>${inline(h(head[1]), links, t)}</h3>`;
        } else para.push(l);
      }
      flushPara();
      return out;
    })
    .join('');
}

/** Button / link targets: "inventory", "contact", "about", "home", "call", "category:suvs" or any address */
function link(raw: unknown, links: Links, t: Tokens): string {
  const s = String(raw ?? '').trim();
  switch (s) {
    case '':
      return '#';
    case 'inventory':
      return links.inventory;
    case 'contact':
      return links.contact;
    case 'about':
      return links.about;
    case 'home':
      return links.home;
    case 'call':
      return String(t.tel_link || '#');
    case 'email':
      return String(t.email_link || '#');
    case 'directions':
      return String(t.maps_dir || '#');
  }
  if (s.startsWith('category:')) return links.category(s.slice(9));
  if (s.startsWith('page:')) return slugOf(s.slice(5));
  return safeUrl(sub(s, t)) || '#';
}

/** an image address for <img src> ("/uploads/…", "uploads/…" or https) */
function img(u: unknown): string {
  const s = String(u ?? '').trim();
  if (!s) return '';
  if (/^\/?(uploads|themes|images)\/[A-Za-z0-9_\-./%]+$/.test(s) && !s.includes('..')) return s.startsWith('/') ? s : '/' + s;
  return safeUrl(s, true);
}

/* ============================================================================ sections */

interface Rc {
  theme: Theme;
  kit: ThemeKit;
  t: Tokens;
  vehicles: InvVehicle[];
}

const ARROW = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function buttons(list: unknown, rc: Rc, cls = ''): string {
  const arr = (Array.isArray(list) ? list : []).filter((b) => b && String(b.label || '').trim());
  if (!arr.length) return '';
  return (
    `<div class="pa-btns ${cls}">` +
    arr
      .map((b, i) => {
        const href = link(b.link, rc.kit.links, rc.t);
        const ext = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener"' : '';
        const style = b.style === 'ghost' || (i > 0 && b.style !== 'primary') ? 'pa-btn pa-btn--ghost' : 'pa-btn';
        return `<a class="${style}" href="${h(href)}"${ext}>${txt(b.label, rc.t)}${i === 0 ? ARROW : ''}</a>`;
      })
      .join('') +
    '</div>'
  );
}

function headBlock(b: Block, rc: Rc, opts: { center?: boolean; tag?: string } = {}): string {
  const tag = opts.tag || 'h2';
  const parts = [
    b.eyebrow ? `<p class="pa-eyebrow">${txt(b.eyebrow, rc.t)}</p>` : '',
    b.title ? `<${tag} class="pa-title">${headline(b.title, rc.t)}</${tag}>` : '',
    b.intro ? `<p class="pa-intro">${txt(b.intro, rc.t)}</p>` : '',
  ].join('');
  return parts ? `<div class="pa-head${opts.center ? ' pa-center' : ''}">${parts}</div>` : '';
}

/** "Find your *next* car" → the starred word in the brand colour (like the themes do) */
function headline(s: unknown, t: Tokens): string {
  return h(sub(s, t)).replace(/\*([^*\n]+)\*/g, '<span class="pa-hl">$1</span>');
}

const money = (n: unknown) => {
  const v = Number(String(n ?? '').replace(/[^0-9.]/g, ''));
  return v > 0 ? '$' + Math.round(v).toLocaleString('en-US') : 'Call for price';
};

const CAT_MATCH: Record<string, RegExp> = {
  cars: /car|sedan|coupe|hatch|convertible/i,
  sedans: /sedan/i,
  suvs: /suv|crossover|sport utility/i,
  trucks: /truck|pickup/i,
  wagons: /wagon/i,
  vans: /van/i,
};

/** inventory section: the dealer's live vehicles, filtered + sorted */
export function pickVehicles(all: InvVehicle[], b: Block): InvVehicle[] {
  const f = (b.filter || {}) as Record<string, any>;
  let list = all.filter((v) => !/^(draft|sold|hidden)$/i.test(String(v.status || '')));
  const body = (v: InvVehicle) => `${v.body || ''} ${v.type || ''}`;
  if (f.category && CAT_MATCH[f.category]) list = list.filter((v) => CAT_MATCH[f.category].test(body(v)));
  if (f.make) list = list.filter((v) => String(v.make || '').toLowerCase() === String(f.make).toLowerCase());
  if (f.featured) list = list.filter((v) => v.featured === true || /^(true|1|yes)$/i.test(String(v.featured)));
  const n = (x: unknown) => Number(String(x ?? '').replace(/[^0-9.]/g, '')) || 0;
  if (n(f.minPrice)) list = list.filter((v) => n(v.price) >= n(f.minPrice));
  if (n(f.maxPrice)) list = list.filter((v) => n(v.price) > 0 && n(v.price) <= n(f.maxPrice));
  if (n(f.minYear)) list = list.filter((v) => n(v.year) >= n(f.minYear));
  const sorts: Record<string, (a: InvVehicle, b: InvVehicle) => number> = {
    price_asc: (a, b2) => (n(a.price) || 1e12) - (n(b2.price) || 1e12),
    price_desc: (a, b2) => n(b2.price) - n(a.price),
    year_desc: (a, b2) => n(b2.year) - n(a.year),
    mileage_asc: (a, b2) => (n(a.mileage) || 1e12) - (n(b2.mileage) || 1e12),
  };
  if (sorts[f.sort]) list = [...list].sort(sorts[f.sort]);
  const limit = Math.min(48, Math.max(1, Number(b.limit) || 6));
  return list.slice(0, limit);
}

function vehicleCard(v: InvVehicle, rc: Rc): string {
  const imgs = Array.isArray(v.images) ? v.images : [];
  const first = imgs[0] && typeof imgs[0] === 'object' ? imgs[0].url || imgs[0].src : imgs[0];
  const title = String(v.title || '').trim() || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || 'Vehicle';
  const miles = Number(String(v.mileage ?? '').replace(/[^0-9]/g, ''));
  const specs = [miles ? miles.toLocaleString('en-US') + ' mi' : '', v.trans, v.drivetrain, v.fuel].filter((x) => String(x || '').trim()).slice(0, 3);
  const pic = img(first);
  const badge = v.featured === true || /^(true|1|yes)$/i.test(String(v.featured)) ? '<span class="pa-badge">Featured</span>' : '';
  return (
    `<a class="pa-car" href="${h(rc.kit.links.vehicle(v))}">` +
    `<span class="pa-car-media">${badge}${pic ? `<img src="${h(pic)}" alt="${h(title)}" loading="lazy" decoding="async">` : '<span class="pa-car-noimg">Photo coming soon</span>'}</span>` +
    `<span class="pa-car-body"><small>${h([v.year, v.make].filter(Boolean).join(' · '))}</small><strong>${h(title)}</strong>` +
    (specs.length ? `<span class="pa-car-specs">${specs.map((s) => `<span>${h(s)}</span>`).join('')}</span>` : '') +
    `<span class="pa-car-foot"><b>${h(money(v.price))}</b><span class="pa-car-go">View details ${ARROW}</span></span></span></a>`
  );
}

function items(b: Block): Record<string, any>[] {
  return (Array.isArray(b.items) ? b.items : []).filter((x) => x && typeof x === 'object');
}

const SECTIONS: Record<string, (b: Block, rc: Rc) => string> = {
  hero(b, rc) {
    const pic = img(b.image);
    const overlay = Math.min(90, Math.max(0, b.overlay === undefined || b.overlay === '' ? 55 : Number(b.overlay)));
    const bg = pic ? ` style="--pa-hero-img:url('${h(pic)}');--pa-overlay:${overlay / 100}"` : '';
    return (
      `<div class="pa-hero pa-hero--${['s', 'm', 'l'].includes(b.height) ? b.height : 'm'}${pic ? ' pa-hero--img' : ''}${b.align === 'center' ? ' pa-center' : ''}"${bg}><div class="pa-wrap">` +
      (b.eyebrow ? `<p class="pa-eyebrow">${txt(b.eyebrow, rc.t)}</p>` : '') +
      `<h1 class="pa-title pa-title--xl">${headline(b.title || '', rc.t)}</h1>` +
      (b.text ? `<p class="pa-lead">${txt(b.text, rc.t)}</p>` : '') +
      buttons(b.buttons, rc) +
      '</div></div>'
    );
  },
  text(b, rc) {
    return `<div class="pa-wrap ${b.width === 'wide' ? '' : 'pa-narrow'}${b.align === 'center' ? ' pa-center' : ''}">${headBlock(b, rc, { center: b.align === 'center' })}<div class="pa-rich">${rich(b.body, rc.kit.links, rc.t)}</div>${buttons(b.buttons, rc)}</div>`;
  },
  split(b, rc) {
    const pic = img(b.image);
    return (
      `<div class="pa-wrap pa-split${b.imageSide === 'left' ? ' pa-split--left' : ''}">` +
      `<div class="pa-split-text">${headBlock(b, rc)}<div class="pa-rich">${rich(b.body, rc.kit.links, rc.t)}</div>${buttons(b.buttons, rc)}</div>` +
      `<div class="pa-split-media">${pic ? `<img src="${h(pic)}" alt="${txt(b.imageAlt || b.title || '', rc.t)}" loading="lazy">` : '<div class="pa-ph"></div>'}</div></div>`
    );
  },
  cards(b, rc) {
    const cols = Math.min(4, Math.max(2, Number(b.columns) || 3));
    return (
      `<div class="pa-wrap">${headBlock(b, rc, { center: b.align === 'center' })}<div class="pa-grid pa-cols-${cols}">` +
      items(b)
        .map((it) => {
          const href = it.link ? link(it.link, rc.kit.links, rc.t) : '';
          const inner =
            (it.icon ? `<span class="pa-card-icon">${txt(it.icon, rc.t)}</span>` : '') +
            (img(it.image) ? `<img class="pa-card-img" src="${h(img(it.image))}" alt="" loading="lazy">` : '') +
            `<h3>${txt(it.title, rc.t)}</h3>${it.text ? `<p>${txt(it.text, rc.t)}</p>` : ''}` +
            (href ? `<span class="pa-more">${txt(it.linkLabel || 'Learn more', rc.t)} ${ARROW}</span>` : '');
          return href ? `<a class="pa-card" href="${h(href)}">${inner}</a>` : `<div class="pa-card">${inner}</div>`;
        })
        .join('') +
      '</div></div>'
    );
  },
  inventory(b, rc) {
    const list = pickVehicles(rc.vehicles, b);
    const cols = Math.min(4, Math.max(2, Number(b.columns) || 3));
    const f = (b.filter || {}) as Record<string, any>;
    const all = f.category && CAT_MATCH[f.category] ? rc.kit.links.category(f.category) : f.make && rc.kit.links.make ? rc.kit.links.make(f.make) : rc.kit.links.inventory;
    const btn = b.showButton === false ? '' : `<div class="pa-btns pa-center"><a class="pa-btn" href="${h(all)}">${txt(b.buttonLabel || 'View all inventory', rc.t)}${ARROW}</a></div>`;
    const empty = `<div class="pa-empty">${txt(b.emptyText || 'New vehicles are being added. Please check back soon or contact us — we will help you find the right one.', rc.t)}</div>`;
    return `<div class="pa-wrap">${headBlock(b, rc, { center: b.align === 'center' })}${list.length ? `<div class="pa-grid pa-cols-${cols} pa-cars">${list.map((v) => vehicleCard(v, rc)).join('')}</div>` : empty}${btn}</div>`;
  },
  cta(b, rc) {
    return `<div class="pa-wrap"><div class="pa-cta">${headBlock({ ...b, intro: undefined } as Block, rc)}${b.text ? `<p class="pa-lead">${txt(b.text, rc.t)}</p>` : ''}${buttons(b.buttons, rc)}</div></div>`;
  },
  stats(b, rc) {
    return (
      `<div class="pa-wrap">${headBlock(b, rc, { center: true })}<div class="pa-stats">` +
      items(b).map((it) => `<div class="pa-stat"><b>${txt(it.value, rc.t)}</b><span>${txt(it.label, rc.t)}</span></div>`).join('') +
      '</div></div>'
    );
  },
  testimonials(b, rc) {
    return (
      `<div class="pa-wrap">${headBlock(b, rc, { center: true })}<div class="pa-grid pa-cols-${Math.min(3, Math.max(1, items(b).length))}">` +
      items(b)
        .map(
          (it) =>
            `<figure class="pa-card pa-quote"><span class="pa-stars" aria-label="5 stars">★★★★★</span><blockquote>${txt(it.quote, rc.t)}</blockquote>` +
            `<figcaption><b>${txt(it.name, rc.t)}</b>${it.detail ? `<span>${txt(it.detail, rc.t)}</span>` : ''}</figcaption></figure>`,
        )
        .join('') +
      '</div></div>'
    );
  },
  faq(b, rc) {
    return (
      `<div class="pa-wrap pa-narrow">${headBlock(b, rc, { center: true })}<div class="pa-faq">` +
      items(b)
        .map((it, i) => `<details${i === 0 ? ' open' : ''}><summary>${txt(it.q, rc.t)}</summary><div class="pa-rich">${rich(it.a, rc.kit.links, rc.t)}</div></details>`)
        .join('') +
      '</div></div>'
    );
  },
  gallery(b, rc) {
    const pics = (Array.isArray(b.images) ? b.images : []).map(img).filter(Boolean);
    const cols = Math.min(4, Math.max(2, Number(b.columns) || 3));
    return `<div class="pa-wrap">${headBlock(b, rc, { center: true })}<div class="pa-gallery pa-cols-${cols}">${pics.map((p) => `<a href="${h(p)}" target="_blank" rel="noopener"><img src="${h(p)}" alt="" loading="lazy"></a>`).join('')}</div></div>`;
  },
  form(b, rc) {
    const id = 'paf' + Math.random().toString(36).slice(2, 8);
    const phone = b.showPhone !== false;
    return (
      `<div class="pa-wrap pa-split pa-split--form"><div class="pa-split-text">${headBlock(b, rc)}${b.text ? `<div class="pa-rich">${rich(b.text, rc.kit.links, rc.t)}</div>` : ''}` +
      `<ul class="pa-contact">${rc.t._missing?.phone ? '' : `<li><a href="${h(rc.t.tel_link)}">${h(rc.t.phone)}</a></li>`}${rc.t._missing?.email ? '' : `<li><a href="${h(rc.t.email_link)}">${h(rc.t.email)}</a></li>`}${rc.t._missing?.address ? '' : `<li>${h(rc.t.address)}</li>`}</ul></div>` +
      `<form class="pa-form" id="${id}" data-topic="${txt(b.topic || 'Website inquiry', rc.t)}" novalidate>` +
      `<label><span>Your name</span><input name="name" required autocomplete="name"></label>` +
      `<label><span>Email</span><input name="email" type="email" autocomplete="email"></label>` +
      (phone ? `<label><span>Phone</span><input name="phone" type="tel" autocomplete="tel"></label>` : '') +
      `<label class="pa-full"><span>Message</span><textarea name="message" rows="5" required>${txt(b.messagePlaceholder || '', rc.t)}</textarea></label>` +
      `<input name="_honey" tabindex="-1" autocomplete="off" class="pa-hp" aria-hidden="true">` +
      `<button class="pa-btn" type="submit">${txt(b.buttonLabel || 'Send message', rc.t)}${ARROW}</button><p class="pa-form-msg" role="status"></p></form></div>`
    );
  },
  map(b, rc) {
    const t = rc.t;
    const rows = [
      !t._missing?.address && `<li><small>Address</small><a href="${h(t.maps_dir)}" target="_blank" rel="noopener">${h(t.address)}</a></li>`,
      !t._missing?.phone && `<li><small>Phone</small><a href="${h(t.tel_link)}">${h(t.phone)}</a></li>`,
      !t._missing?.email && `<li><small>Email</small><a href="${h(t.email_link)}">${h(t.email)}</a></li>`,
      t.hours_week && !t._missing?.hours_week && `<li><small>Hours</small><span>${h(t.hours_week)}${t.hours_weekend ? '<br>' + h(t.hours_weekend) : ''}</span></li>`,
    ].filter(Boolean);
    const map = t._missing?.address ? '<div class="pa-ph pa-map"></div>' : `<iframe class="pa-map" src="${h(t.maps_embed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map"></iframe>`;
    return `<div class="pa-wrap pa-split pa-split--map"><div class="pa-split-text">${headBlock(b, rc)}${b.text ? `<div class="pa-rich">${rich(b.text, rc.kit.links, rc.t)}</div>` : ''}<ul class="pa-info">${rows.join('')}</ul>${buttons(b.buttons, rc)}</div><div class="pa-split-media">${map}</div></div>`;
  },
  html(b) {
    // trusted: only platform owners can create pages
    return `<div class="pa-wrap">${String(b.html || '')}</div>`;
  },
  spacer(b) {
    return `<div class="pa-spacer pa-spacer--${['s', 'm', 'l'].includes(b.size) ? b.size : 'm'}"${b.line ? ' data-line' : ''}></div>`;
  },
};

export const SECTION_TYPES = Object.keys(SECTIONS);

const TONES = ['page', 'alt', 'dark', 'brand'];

export function renderSections(sections: Block[], rc: Rc): string {
  const list = (Array.isArray(sections) ? sections : []).filter((b) => b && SECTIONS[b.type]);
  if (!list.length) return '<section class="pa-sec" data-tone="page"><div class="pa-wrap pa-narrow pa-center"><p class="pa-muted">This page has no sections yet.</p></div></section>';
  return list
    .map((b, i) => {
      let tone = b.tone && TONES.includes(b.tone) ? b.tone : b.type === 'hero' ? 'dark' : b.type === 'cta' ? 'brand' : 'page';
      if (b.type === 'hero' && img(b.image)) tone = 'dark';
      const pad = b.pad && ['s', 'm', 'l', 'none'].includes(b.pad) ? b.pad : 'm';
      const anchor = ` id="${b.anchor ? h(slugOf(b.anchor)) : `pa-s-${i}`}"`;
      return `<section class="pa-sec pa-sec--${h(b.type)}" data-tone="${tone}" data-pad="${pad}" data-i="${i}"${anchor}>${SECTIONS[b.type](b, rc)}</section>`;
    })
    .join('');
}

/* ============================================================================ styles */

const BASE_CSS = `
.pa-page{background:var(--pa-bg);color:var(--pa-text);font-family:var(--pa-fb);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased;overflow:hidden}
.pa-page *,.pa-page *::before,.pa-page *::after{box-sizing:border-box}
.pa-page img{max-width:100%;display:block}
.pa-page a{color:inherit}
.pa-sec{scroll-margin-top:calc(var(--pa-top) + 12px);--pa-sec-bg:var(--pa-bg);background:var(--pa-sec-bg);position:relative;padding:clamp(48px,7vw,96px) 0}
.pa-sec[data-pad="s"]{padding:clamp(28px,4vw,48px) 0}.pa-sec[data-pad="l"]{padding:clamp(72px,10vw,140px) 0}.pa-sec[data-pad="none"]{padding:0}
.pa-sec[data-tone="alt"]{--pa-sec-bg:var(--pa-alt)}
.pa-sec[data-tone="dark"]{--pa-sec-bg:var(--pa-dark);--pa-text:#E9EEF6;--pa-head:#FFFFFF;--pa-muted:rgba(233,238,246,.72);--pa-line:rgba(255,255,255,.14);--pa-card:rgba(255,255,255,.06);color:var(--pa-text)}
.pa-sec[data-tone="brand"]{--pa-sec-bg:var(--pa-primary);--pa-text:var(--pa-on-primary);--pa-head:var(--pa-on-primary);--pa-muted:color-mix(in srgb,var(--pa-on-primary) 80%,transparent);--pa-line:color-mix(in srgb,var(--pa-on-primary) 22%,transparent);--pa-card:color-mix(in srgb,var(--pa-on-primary) 10%,transparent);color:var(--pa-text)}
.pa-sec[data-tone="brand"] .pa-btn{background:var(--pa-on-primary);color:var(--pa-primary)!important;box-shadow:0 10px 26px -14px rgba(0,0,0,.45)}
.pa-sec[data-tone="brand"] .pa-btn--ghost{background:transparent;color:var(--pa-on-primary)!important;border-color:currentColor;box-shadow:none}
.pa-sec[data-tone="brand"] .pa-eyebrow,.pa-sec[data-tone="brand"] .pa-hl{color:inherit}
.pa-sec+.pa-sec[data-tone="page"]:not([data-pad="none"]){}
.pa-wrap{width:min(1200px,100% - 40px);margin:0 auto;position:relative}
.pa-narrow{width:min(820px,100% - 40px)}
.pa-center{text-align:center}.pa-center .pa-btns{justify-content:center}.pa-center.pa-head,.pa-center .pa-head{margin-left:auto;margin-right:auto}
.pa-head{max-width:760px;margin-bottom:clamp(24px,3vw,40px)}
.pa-eyebrow{margin:0 0 12px;font-family:var(--pa-fe);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--pa-accent)}
.pa-title{margin:0;font-family:var(--pa-fh);font-weight:var(--pa-head-weight);text-transform:var(--pa-head-case);color:var(--pa-head);font-size:clamp(28px,3.6vw,46px);line-height:1.08;letter-spacing:-.02em}
.pa-title--xl{font-size:clamp(38px,6vw,76px);line-height:1.02}
.pa-page .pa-hl{color:var(--pa-accent);display:inline}.pa-page .pa-sec[data-tone="dark"] .pa-hl{color:var(--pa-accent-dark,var(--pa-accent))}
.pa-intro,.pa-lead{margin:14px 0 0;color:var(--pa-muted);font-size:clamp(16px,1.4vw,19px);max-width:680px}
.pa-center .pa-intro,.pa-center .pa-lead{margin-left:auto;margin-right:auto}
.pa-muted{color:var(--pa-muted)}
.pa-rich{color:var(--pa-text)}.pa-rich p,.pa-rich ul,.pa-rich ol{margin:0 0 1em}.pa-rich h3{font-family:var(--pa-fh);color:var(--pa-head);font-size:22px;margin:1.4em 0 .5em;text-transform:var(--pa-head-case)}
.pa-rich ul,.pa-rich ol{padding-left:1.3em}.pa-page .pa-rich ul{list-style:disc}.pa-page .pa-rich ol{list-style:decimal}.pa-rich li{margin:.3em 0}.pa-rich a{color:var(--pa-primary);font-weight:600}.pa-rich strong{color:var(--pa-head)}
.pa-btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
.pa-btn{display:inline-flex;align-items:center;gap:8px;padding:14px 24px;border-radius:var(--pa-btn-radius);background:var(--pa-primary);color:var(--pa-on-primary)!important;font-family:var(--pa-fb);font-weight:700;font-size:15px;line-height:1;text-decoration:none;border:2px solid transparent;cursor:pointer;transition:transform .2s,box-shadow .2s,filter .2s;box-shadow:0 10px 26px -12px var(--pa-primary)}
.pa-btn:hover{transform:translateY(-2px);background:var(--pa-primary-hover,var(--pa-primary))}
.pa-btn svg{transition:transform .2s}.pa-btn:hover svg{transform:translateX(3px)}
.pa-btn--ghost{background:transparent;color:var(--pa-head)!important;border-color:var(--pa-line);box-shadow:none}
.pa-sec[data-tone="dark"] .pa-btn--ghost{color:#fff!important;border-color:rgba(255,255,255,.35)}
.pa-hero{position:relative;padding:clamp(56px,8vw,120px) 0}
.pa-sec--hero{padding:0}
.pa-hero--s{padding:clamp(40px,5vw,72px) 0}.pa-hero--l{padding:clamp(96px,13vw,190px) 0}
.pa-hero--img{background:linear-gradient(90deg,rgba(0,0,0,calc(var(--pa-overlay) + .15)),rgba(0,0,0,var(--pa-overlay))),var(--pa-hero-img) center/cover no-repeat}
.pa-hero:not(.pa-hero--img)::before{content:"";position:absolute;inset:0;background:radial-gradient(60% 80% at 85% 10%,color-mix(in srgb,var(--pa-primary) 38%,transparent),transparent 70%),radial-gradient(40% 60% at 5% 100%,color-mix(in srgb,var(--pa-accent) 22%,transparent),transparent 70%);pointer-events:none}
.pa-hero .pa-title{max-width:900px}.pa-hero.pa-center .pa-title{margin-left:auto;margin-right:auto}
.pa-hero .pa-lead{color:rgba(255,255,255,.82)}
.pa-split{display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(28px,5vw,72px);align-items:center}
.pa-split--left .pa-split-media{order:-1}
.pa-split-media img,.pa-ph{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--pa-radius);box-shadow:0 30px 60px -30px rgba(0,0,0,.45)}
.pa-ph{background:linear-gradient(135deg,color-mix(in srgb,var(--pa-primary) 30%,var(--pa-card)),var(--pa-card));border:1px solid var(--pa-line)}
.pa-grid{display:grid;gap:clamp(16px,2vw,24px)}
.pa-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.pa-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.pa-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.pa-card{display:block;padding:26px;border-radius:var(--pa-radius);background:var(--pa-card);border:1px solid var(--pa-line);text-decoration:none;color:var(--pa-text);transition:transform .25s,box-shadow .25s,border-color .25s}
a.pa-card:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--pa-primary) 50%,var(--pa-line));box-shadow:0 22px 44px -26px rgba(0,0,0,.45)}
.pa-card h3{margin:0 0 8px;font-family:var(--pa-fh);font-size:20px;color:var(--pa-head);text-transform:var(--pa-head-case)}
.pa-card p{margin:0;color:var(--pa-muted);font-size:15px}
.pa-card-icon{display:inline-grid;place-items:center;width:52px;height:52px;margin-bottom:18px;border-radius:14px;font-size:26px;background:color-mix(in srgb,var(--pa-primary) 14%,transparent);color:var(--pa-primary)}
.pa-card-img{width:calc(100% + 52px);max-width:none;margin:-26px -26px 18px;aspect-ratio:16/10;object-fit:cover;border-radius:var(--pa-radius) var(--pa-radius) 0 0}
.pa-more{display:inline-flex;align-items:center;gap:6px;margin-top:14px;font-weight:700;font-size:14px;color:var(--pa-primary)}
.pa-car{display:flex;flex-direction:column;border-radius:var(--pa-radius);overflow:hidden;background:var(--pa-card);border:1px solid var(--pa-line);text-decoration:none;color:var(--pa-text);transition:transform .25s,box-shadow .25s}
.pa-car:hover{transform:translateY(-5px);box-shadow:0 26px 50px -28px rgba(0,0,0,.5)}
.pa-car-media{position:relative;display:block;aspect-ratio:4/3;background:color-mix(in srgb,var(--pa-line) 60%,transparent);overflow:hidden}
.pa-car-media img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.pa-car:hover .pa-car-media img{transform:scale(1.05)}
.pa-car-noimg{display:grid;place-items:center;height:100%;color:var(--pa-muted);font-size:14px}
.pa-badge{position:absolute;top:12px;left:12px;z-index:1;padding:5px 11px;border-radius:999px;background:var(--pa-primary);color:var(--pa-on-primary);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.pa-car-body{display:flex;flex-direction:column;gap:6px;padding:18px 20px 20px;flex:1}
.pa-car-body small{color:var(--pa-muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.pa-car-body strong{font-family:var(--pa-fh);font-size:19px;line-height:1.25;color:var(--pa-head)}
.pa-car-specs{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.pa-car-specs span{padding:4px 10px;border-radius:999px;font-size:12px;background:color-mix(in srgb,var(--pa-line) 70%,transparent);color:var(--pa-text)}
.pa-car-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;padding-top:14px;border-top:1px solid var(--pa-line)}
.pa-car-foot b{font-family:var(--pa-fh);font-size:22px;color:var(--pa-head)}
.pa-car-go{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--pa-primary)}
.pa-empty{padding:40px;border-radius:var(--pa-radius);border:1px dashed var(--pa-line);text-align:center;color:var(--pa-muted)}
.pa-cta{padding:clamp(32px,5vw,64px);border-radius:calc(var(--pa-radius) * 1.4);background:linear-gradient(135deg,color-mix(in srgb,var(--pa-card) 100%,transparent),transparent);border:1px solid var(--pa-line);text-align:center}
.pa-cta .pa-head{margin-left:auto;margin-right:auto;margin-bottom:0}.pa-cta .pa-lead{margin-left:auto;margin-right:auto}.pa-cta .pa-btns{justify-content:center}
.pa-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:20px}
.pa-stat{padding:26px;border-radius:var(--pa-radius);background:var(--pa-card);border:1px solid var(--pa-line);text-align:center}
.pa-stat b{display:block;font-family:var(--pa-fh);font-size:clamp(34px,4vw,52px);line-height:1;color:var(--pa-primary)}
.pa-stat span{display:block;margin-top:10px;color:var(--pa-muted);font-size:14px}
.pa-sec[data-tone="dark"] .pa-stat b{color:var(--pa-accent-dark,var(--pa-primary))}.pa-sec[data-tone="brand"] .pa-stat b{color:inherit}
.pa-quote{margin:0}.pa-quote blockquote{margin:12px 0 18px;font-size:17px;color:var(--pa-text)}
.pa-stars{color:#F5B301;letter-spacing:2px}.pa-quote figcaption b{display:block;color:var(--pa-head)}.pa-quote figcaption span{color:var(--pa-muted);font-size:14px}
.pa-faq details{border:1px solid var(--pa-line);border-radius:var(--pa-radius);background:var(--pa-card);margin-bottom:12px;padding:0 22px;text-align:left}
.pa-faq summary{cursor:pointer;list-style:none;padding:20px 32px 20px 0;font-weight:700;color:var(--pa-head);position:relative}
.pa-faq summary::-webkit-details-marker{display:none}
.pa-faq summary::after{content:"+";position:absolute;right:0;top:50%;transform:translateY(-50%);font-size:24px;color:var(--pa-primary);transition:transform .2s}
.pa-faq details[open] summary::after{transform:translateY(-50%) rotate(45deg)}
.pa-faq .pa-rich{padding-bottom:18px;color:var(--pa-muted)}
.pa-gallery{display:grid;gap:14px}.pa-gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--pa-radius);transition:transform .3s}.pa-gallery a:hover img{transform:scale(1.02)}
.pa-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:clamp(22px,3vw,34px);border-radius:var(--pa-radius);background:var(--pa-card);border:1px solid var(--pa-line)}
.pa-form label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:var(--pa-head)}
.pa-form .pa-full,.pa-form button,.pa-form .pa-form-msg{grid-column:1/-1}
.pa-form input,.pa-form textarea{width:100%;padding:13px 14px;border-radius:calc(var(--pa-radius) * .55);border:1px solid var(--pa-line);background:var(--pa-bg);color:var(--pa-text);font:inherit;font-weight:400}
.pa-sec[data-tone="dark"] .pa-form input,.pa-sec[data-tone="dark"] .pa-form textarea{background:rgba(255,255,255,.06)}
.pa-form input:focus,.pa-form textarea:focus{outline:2px solid var(--pa-primary);outline-offset:1px}
.pa-form button{justify-content:center}
.pa-form-msg{margin:0;font-size:14px;color:var(--pa-muted)}.pa-form-msg.ok{color:#16a34a}.pa-form-msg.err{color:#dc2626}
.pa-hp{position:absolute!important;left:-9999px!important;opacity:0}
.pa-contact,.pa-info{list-style:none;padding:0;margin:20px 0 0;display:grid;gap:10px}
.pa-contact a,.pa-info a{color:var(--pa-primary);font-weight:700;text-decoration:none}
.pa-info li{display:grid;gap:2px}.pa-info small{color:var(--pa-muted);font-size:12px;text-transform:uppercase;letter-spacing:.1em}
.pa-map{width:100%;aspect-ratio:4/3;border:0;border-radius:var(--pa-radius);display:block}
.pa-spacer--s{height:16px}.pa-spacer--m{height:40px}.pa-spacer--l{height:80px}.pa-sec--spacer{padding:0!important}
.pa-spacer[data-line]{border-top:1px solid var(--pa-line);width:min(1200px,100% - 40px);margin:0 auto}
.pa-reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}.pa-reveal.pa-in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.pa-reveal{opacity:1;transform:none;transition:none}}
@media (max-width:980px){.pa-cols-4{grid-template-columns:repeat(2,minmax(0,1fr))}.pa-cols-3{grid-template-columns:repeat(2,minmax(0,1fr))}.pa-split{grid-template-columns:1fr}.pa-split--left .pa-split-media{order:0}}
@media (max-width:620px){.pa-cols-2,.pa-cols-3,.pa-cols-4{grid-template-columns:1fr}.pa-form{grid-template-columns:1fr}.pa-btn{width:100%;justify-content:center}}
`;

/**
 * Themes whose header floats over the page (fixed / absolute): the first section gets room for it
 * (--pa-top, measured in the browser; the theme's typical height is the fallback) and, when that section
 * is light, a dark band behind the header so the white menu stays readable.
 */
const TOP_CSS =
  '.pa-page>.pa-sec:first-child{padding-top:calc(var(--pa-top) + clamp(40px,6vw,80px))}' +
  '.pa-page>.pa-sec:first-child:not([data-tone="dark"]):not(.pa-sec--hero){box-shadow:inset 0 var(--pa-top) 0 var(--pa-dark)}' +
  '.pa-page>.pa-sec--hero:first-child{padding-top:var(--pa-top)}.pa-page>.pa-sec--spacer:first-child{padding-top:var(--pa-top)!important}';

/** buttons on a brand-coloured section stay readable whatever the theme skin does */
const BRAND_CSS =
  '.pa-page .pa-sec[data-tone="brand"] .pa-btn,.pa-page .pa-sec[data-tone="brand"] .pa-btn:hover{background:var(--pa-on-primary);color:var(--pa-primary)!important;border-color:transparent}' +
  '.pa-page .pa-sec[data-tone="brand"] .pa-btn--ghost,.pa-page .pa-sec[data-tone="brand"] .pa-btn--ghost:hover{background:transparent;color:var(--pa-on-primary)!important;border:2px solid currentColor;box-shadow:none}' +
  '.pa-page .pa-sec[data-tone="brand"] .pa-eyebrow,.pa-page .pa-sec[data-tone="brand"] .pa-hl{color:inherit;background:none;-webkit-text-fill-color:currentColor}';

const SCRIPT = `<script>(function(){
var page=document.getElementById('pa-page');if(!page)return;
/* a header that floats over the page (fixed / absolute): measure it so the first section starts below it */
function topH(){var x=innerWidth/2,best=0;[4,30].forEach(function(y){(document.elementsFromPoint(x,y)||[]).forEach(function(el){if(page.contains(el))return;for(var e=el;e&&e!==document.body&&e!==document.documentElement;e=e.parentElement){var cs=getComputedStyle(e);if(cs.position==='fixed'||cs.position==='absolute'){var r=e.getBoundingClientRect();if(r.top<=2&&r.height>20&&r.height<320&&r.width>innerWidth*.6)best=Math.max(best,r.bottom);}}});});return Math.round(best);}
var maxTop=-1;function setTop(){if(scrollY>40)return;var h=topH();if(h>maxTop){maxTop=h;page.style.setProperty('--pa-top',h+'px');}}
/* headers often slide in: measure a few times and keep the full height */
setTop();addEventListener('load',setTop);[300,1000,2200].forEach(function(t){setTimeout(setTop,t);});addEventListener('resize',function(){maxTop=-1;setTop();});
/* sections fade in as they scroll into view */
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('pa-in');io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});
page.querySelectorAll('.pa-sec .pa-wrap').forEach(function(el,i){if(i===0)return;el.classList.add('pa-reveal');io.observe(el);});}
/* contact forms → the dealer's inquiries (api/lead.php, same as the theme forms) */
page.querySelectorAll('form.pa-form').forEach(function(f){f.addEventListener('submit',function(ev){ev.preventDefault();
var m=f.querySelector('.pa-form-msg'),d={};new FormData(f).forEach(function(v,k){d[k]=String(v).trim();});
if(!d.name||(!d.email&&!d.phone)||!d.message){m.className='pa-form-msg err';m.textContent='Please add your name, an email or phone number, and a message.';return;}
var b=f.querySelector('button');b.disabled=true;m.className='pa-form-msg';m.textContent='Sending…';
fetch('api/lead.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:d.name,email:d.email,phone:d.phone||'',message:d.message,topic:f.getAttribute('data-topic')||'Website inquiry',page:location.href,_honey:d._honey||''})})
.then(function(r){return r.json().catch(function(){return{};});}).then(function(j){b.disabled=false;if(j&&j.ok){f.reset();m.className='pa-form-msg ok';m.textContent='Thank you! We received your message and will get back to you shortly.';}else{m.className='pa-form-msg err';m.textContent=(j&&j.message)||'Sorry, the message could not be sent. Please call us instead.';}})
.catch(function(){b.disabled=false;m.className='pa-form-msg err';m.textContent='Sorry, the message could not be sent. Please call us instead.';});});});
})();</script>`;

/**
 * {c:--var} → var(--var, the design's default colour). The dealer's own colours (Design & colours) set those
 * variables on the page, so the sections always use the dealer's current colours — and the defaults of the
 * theme they use right now when they kept the theme's colours.
 */
function colourRefs(theme: Theme, css: string): string {
  const defs: Record<string, string> = {};
  for (const c of theme.manifest.design?.colors || []) {
    if (!c?.var || !c.default) continue;
    defs[c.var] = c.default;
    for (const a of Array.isArray(c.also) ? c.also : []) defs[a] = defs[a] || c.default;
  }
  return css.replace(/\{c:(--[a-z0-9-]+)\}/gi, (_m, v: string) => (defs[v] ? `var(${v}, ${defs[v]})` : `var(${v})`));
}

export function pageCss(theme: Theme): string {
  const kit = kitFor(theme);
  const vars = Object.entries(kit.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  const fonts = kit.fonts ? `<link rel="stylesheet" href="${h(kit.fonts)}">` : '';
  return `${fonts}<style id="pa-page-style">${colourRefs(theme, `.pa-page{${vars}}${BASE_CSS.replace(/\n/g, '')}${TOP_CSS}${kit.css || ''}${BRAND_CSS}`)}</style>`;
}

/* ============================================================================ the page */

export interface RenderOptions {
  vehicles: InvVehicle[];
  navPages: NavItem[];
  themePreview?: boolean;
  /** draft preview from Platform Admin: never indexed */
  preview?: boolean;
}

export function renderCustomPage(ctx: ThemeContext, theme: Theme, page: CustomPage, origin: string, opts: RenderOptions): string {
  const kit = kitFor(theme);
  const t = siteTokensDisplay(siteTokens(ctx.settings, origin), ctx.settings);
  const rc: Rc = { theme, kit, t, vehicles: opts.vehicles || [] };
  const body = renderSections(page.sections, rc);
  const tag = kit.shell.wrapMain ? 'main' : 'div';
  const seo = page.seo || {};
  const firstText = (page.sections || []).map((b) => b.text || b.intro || b.body || '').find((x) => String(x).trim()) || '';
  const title = sub(seo.title || `${page.title} | {name}`, t).trim();
  const desc = sub(seo.description || String(firstText).replace(/[*#\[\]()]/g, '').slice(0, 158), t).replace(/\s+/g, ' ').trim();
  const raw: Record<string, string> = {
    PA_PAGE: `<${tag} class="pa-page" id="pa-page" data-pa-theme="${h(theme.id)}">${body}</${tag}>${SCRIPT}`,
    PA_TITLE: h(title),
    PA_DESC: h(desc),
    PA_STYLE: pageCss(theme),
  };
  if (seo.noindex || opts.preview) raw.ROBOTS = '<meta name="robots" content="noindex, nofollow">';
  if (seo.image) {
    const abs = absSiteUrl(img(seo.image).replace(/^\//, ''), t.site_url);
    if (abs) raw.OG_IMAGE = h(abs);
  }
  if (opts.preview && !opts.themePreview) {
    raw.PREVIEW_BAR =
      '<div style="position:fixed;left:12px;bottom:12px;z-index:99999;background:#1d4ed8;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:9px 12px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none">Draft preview — not published</div>';
  }
  const html = renderPage(ctx, theme, 'index.html', origin, !!opts.themePreview, false, { source: shellSource(theme, kit), path: page.slug, raw });
  return injectNav(html, theme, opts.navPages, page.slug);
}
