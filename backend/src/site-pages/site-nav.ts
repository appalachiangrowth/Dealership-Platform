/**
 * Pages & SEO › Header menu & Footer: the website's standard (design) pages, and the footer builder.
 *
 * Standard pages (Home, Inventory, About Us …) are menu / footer entries of type "default": their address is fixed
 * (a quick link that follows each design — e.g. Inventory is inventory.html in Apex Drift and #/inventory in Classic),
 * only their menu text, position, dropdown and visibility can change. A header menu that contains them replaces the
 * design's own menu links on the website; one without them (saved before) is still added after the design's links.
 */
import { BadRequestException } from '@nestjs/common';
import { clean, randomHex } from '../common/util.js';

/** key → menu text + the quick link the website turns into the design's own address (frontend/lib/custom-pages.ts) */
export const DEFAULT_PAGES = [
  { key: 'home', label: 'Home', url: 'home', menu: true },
  { key: 'inventory', label: 'Inventory', url: 'inventory', menu: true },
  { key: 'used-cars', label: 'Used Cars', url: 'category:cars', menu: false },
  { key: 'used-suvs', label: 'Used SUVs', url: 'category:suvs', menu: false },
  { key: 'used-trucks', label: 'Used Trucks', url: 'category:trucks', menu: false },
  { key: 'used-sedans', label: 'Used Sedans', url: 'category:sedans', menu: false },
  { key: 'used-wagons', label: 'Used Wagons', url: 'category:wagons', menu: false },
  { key: 'about', label: 'About Us', url: 'about', menu: true },
  { key: 'financing', label: 'Financing', url: 'financing', menu: false },
  { key: 'trade-in', label: 'Trade-In', url: 'trade-in', menu: false },
  { key: 'blog', label: 'Blog', url: 'blog', menu: true },
  { key: 'contact', label: 'Contact Us', url: 'contact', menu: true },
] as const;
export type DefaultKey = (typeof DEFAULT_PAGES)[number]['key'];
export const DEFAULT_BY_KEY = new Map<string, (typeof DEFAULT_PAGES)[number]>(DEFAULT_PAGES.map((d) => [d.key, d]));

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
/** inventory, contact, about, home, blog, financing, trade-in, category:suvs, /path, #anchor, https://…, tel:, mailto: */
export const LINK_URL = /^(inventory|contact|about|home|blog|financing|trade-in|category:[a-z]{2,20}|\/[^\s"'<>]{0,300}|#[A-Za-z0-9_-]{1,60}|https?:\/\/[^\s"'<>]{3,500}|tel:[+0-9 ()-]{3,30}|mailto:[^\s"'<>]{3,200})$/;

const cleanId = (v: unknown) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || randomHex(6);

/* ───────────────────────── footer ───────────────────────── */

/** one footer link, as stored */
export type FooterLink = {
  id: string;
  /** page = a Pages & SEO page · default = a standard page (Inventory, Used SUVs …) · link = any address */
  type: 'page' | 'default' | 'link';
  slug?: string;
  key?: string;
  url?: string;
  /** link text; empty = the page's own name */
  label: string;
  newTab: boolean;
};
/** one footer column (heading + links), as stored */
export type FooterColumn = { id: string; heading: string; hidden: boolean; links: FooterLink[] };

export const MAX_FOOTER_COLUMNS = 8;
export const MAX_FOOTER_LINKS = 25;

function cleanFooterLink(v: unknown): FooterLink | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const type = o.type === 'page' || o.type === 'default' || o.type === 'link' ? o.type : null;
  if (!type) return null;
  const out: FooterLink = { id: cleanId(o.id), type, label: clean(o.label, 60), newTab: !!o.newTab };
  if (type === 'page') {
    const slug = String(o.slug || '').trim().toLowerCase();
    if (!SLUG.test(slug)) return null;
    out.slug = slug;
  } else if (type === 'default') {
    const key = String(o.key || '');
    if (!DEFAULT_BY_KEY.has(key)) return null;
    out.key = key;
  } else {
    const url = String(o.url || '').trim();
    if (!LINK_URL.test(url)) throw new BadRequestException(`"${url || '(empty)'}" is not a link the footer can use. Use a page of the website (/financing), https://…, tel:… or mailto:….`);
    if (!out.label) throw new BadRequestException('Every footer link to an address needs a link text.');
    out.url = url;
  }
  return out;
}

/** the stored footer: columns with a heading and their links */
export function cleanFooter(v: unknown): FooterColumn[] {
  if (!Array.isArray(v)) throw new BadRequestException('The footer must be a list of columns');
  if (v.length > MAX_FOOTER_COLUMNS) throw new BadRequestException(`The footer can have at most ${MAX_FOOTER_COLUMNS} columns.`);
  return v
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const o = c as Record<string, unknown>;
      const links = Array.isArray(o.links) ? o.links : [];
      if (links.length > MAX_FOOTER_LINKS) throw new BadRequestException(`A footer column can hold at most ${MAX_FOOTER_LINKS} links.`);
      return {
        id: cleanId(o.id),
        heading: clean(o.heading, 60),
        hidden: !!o.hidden,
        links: links.map(cleanFooterLink).filter((l): l is FooterLink => !!l),
      };
    });
}

/** what the website draws: visible columns, links resolved (unpublished / deleted pages left out) */
export type FooterEntry = { heading: string; links: { label: string; slug?: string; url?: string; key?: string; newTab?: boolean }[] };

export function resolveFooter(cols: FooterColumn[] | null, pages: { slug: string; title: string; navLabel: string }[]): FooterEntry[] | null {
  if (!cols) return null;
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  return cols
    .filter((c) => !c.hidden)
    .map((c) => ({
      heading: c.heading,
      links: c.links
        .map((l) => {
          if (l.type === 'page') {
            const p = bySlug.get(l.slug || '');
            return p ? { label: l.label || p.title, slug: p.slug, ...(l.newTab ? { newTab: true } : {}) } : null;
          }
          if (l.type === 'default') {
            const d = DEFAULT_BY_KEY.get(l.key || '');
            return d ? { label: l.label || d.label, url: d.url, key: d.key, ...(l.newTab ? { newTab: true } : {}) } : null;
          }
          return l.url ? { label: l.label, url: l.url, ...(l.newTab ? { newTab: true } : {}) } : null;
        })
        .filter((l): l is NonNullable<typeof l> => !!l),
    }))
    .filter((c) => c.heading || c.links.length);
}

/**
 * The footer an admin starts from (nothing saved yet): the links most designs show — fully editable and deletable
 * once saved. Legal pages (privacy, terms …) and Financing / Trade-In pages of Pages & SEO are added when they exist.
 */
export function starterFooter(pages: { slug: string; title: string }[]): FooterColumn[] {
  const d = (key: DefaultKey): FooterLink => ({ id: randomHex(6), type: 'default', key, label: '', newTab: false });
  const page = (slug: string): FooterLink => ({ id: randomHex(6), type: 'page', slug, label: '', newTab: false });
  const has = (re: RegExp) => pages.filter((p) => re.test(p.slug));
  const company: FooterLink[] = [d('about'), d('contact'), d('blog')];
  const fin = has(/^(financing|finance|get-approved|credit-application)$/)[0];
  const trade = has(/^(trade-in|value-your-trade|trade)$/)[0];
  if (fin) company.push(page(fin.slug));
  if (trade) company.push(page(trade.slug));
  const cols: FooterColumn[] = [
    { id: randomHex(6), heading: 'Quick Links', hidden: false, links: [d('home'), d('inventory'), d('used-cars'), d('used-suvs'), d('used-trucks'), d('used-sedans')] },
    { id: randomHex(6), heading: 'Company', hidden: false, links: company },
  ];
  const legal = has(/(privacy|terms|policy|disclaimer|accessibility|cookie|legal)/).map((p) => page(p.slug));
  if (legal.length) cols.push({ id: randomHex(6), heading: 'Legal', hidden: false, links: legal });
  return cols;
}
