/**
 * SEO & URLs — pure helpers (no database): address rules, clean vehicle slugs and the title / description templates.
 * Used by SeoService (Platform Admin + public resolver).
 */

/** a page address: 1–3 parts of a–z, 0–9 and dashes, e.g. "used-cars" or "financing/get-approved" */
export const PATH_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?){0,2}$/;
/** one address part (inventory base, vehicle slug) */
export const PART_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

/** Addresses the website serves itself — never usable as a page address or inventory base. */
export const RESERVED_PATHS = new Set([
  'index', 'index.html', 'index.php', 'vehicle', 'vehicle.html', 'blog-post', 'blog-post.html', 'sitemap.xml', 'robots.txt',
  'logo', 'images', 'api', 'themes', 'uploads', '_next', 'admin', 'login', 'dealer', 'platform', 'inventory.json',
  'inventory.xml', 'pa-keys.json', 'pa-seo.json', 'feed', 'feeds', 'favicon.ico',
]);

export const DEFAULT_INVENTORY_BASE = 'inventory';
export const DEFAULT_VEHICLE_TITLE = '{year} {make} {model} {trim} for Sale in {city}, {state} | {dealerName}';
export const DEFAULT_VEHICLE_DESCRIPTION =
  'Used {year} {make} {model} {trim} for sale at {dealerName} in {city}, {state}. {mileage} miles, {price}. See photos, features and pricing, then call or visit.';

/** Placeholders the vehicle templates understand (Platform Admin shows them as chips). */
export const VEHICLE_VARS = ['year', 'make', 'model', 'trim', 'price', 'mileage', 'dealerName', 'city', 'state', 'stock', 'vin', 'body', 'condition', 'color'] as const;

/**
 * The standard storefront pages. Each design lists its own pages in theme.json (same ids); single-page designs
 * (Classic, VroomFox) show inventory / about / contact / blog as sections of their home page.
 */
export const STANDARD_PAGES: { key: string; label: string; seo?: string }[] = [
  { key: 'home', label: 'Home', seo: 'seo.home' },
  { key: 'inventory', label: 'Inventory', seo: 'seo.inventory' },
  { key: 'used-cars', label: 'Used Cars', seo: 'seo.inventory' },
  { key: 'used-sedans', label: 'Used Sedans', seo: 'seo.inventory' },
  { key: 'used-trucks', label: 'Used Trucks', seo: 'seo.inventory' },
  { key: 'used-suvs', label: 'Used SUVs', seo: 'seo.inventory' },
  { key: 'used-wagons', label: 'Used Wagons', seo: 'seo.inventory' },
  { key: 'about-us', label: 'About Us', seo: 'seo.about' },
  { key: 'contact-us', label: 'Contact Us', seo: 'seo.contact' },
  { key: 'blog', label: 'Blog', seo: 'seo.blog' },
];
/** design pages that are not standalone (opened with ?id=) — they never get an address of their own */
export const QUERY_PAGES = new Set(['vehicle', 'blog-post']);

export const CUSTOM_PREFIX = 'custom:';

/** The address a page has without any setting: "" (home), "<id>.html" (design page) or "<slug>" (Pages & SEO page). */
export function defaultPathOf(pageKey: string): string {
  if (pageKey === 'home') return '';
  if (pageKey.startsWith(CUSTOM_PREFIX)) return pageKey.slice(CUSTOM_PREFIX.length);
  return `${pageKey}.html`;
}

/** "/Used-Cars/" → "used-cars" ; returns null when it is not a valid address. "" stays "" (home). */
export function normalizePath(raw: unknown): string | null {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  if (s === '') return '';
  return PATH_RE.test(s) ? s : null;
}

/** "2022 Ford F-150 Lariat" → "2022-ford-f-150-lariat" */
export function slugPart(s: unknown, max = 100): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export interface SlugVehicle {
  id: string;
  year: number | null;
  make: string;
  model: string;
  trim: string;
  stockNumber: string;
  vin?: string;
}

/** year-make-model-trim (without any duplicate suffix) */
export function baseVehicleSlug(v: SlugVehicle): string {
  const model = slugPart(v.model);
  let trim = slugPart(v.trim);
  // "F-150" + "F-150 XL" → "f-150-xl" (model repeated at the start of the trim is dropped)
  if (model && (trim === model || trim.startsWith(model + '-'))) trim = trim.slice(model.length).replace(/^-+/, '');
  const parts = [v.year ? String(v.year) : '', slugPart(v.make), model, trim].filter(Boolean);
  const words: string[] = [];
  for (const p of parts) if (!words.length || words[words.length - 1] !== p) words.push(p);
  return slugPart(words.join('-'), 100) || 'vehicle';
}

/**
 * A slug that is unique inside the dealership: the plain year-make-model-trim when free, otherwise
 * "-<stock number>" (or a short id / VIN tail), and a counter only as a last resort.
 */
export function uniqueVehicleSlug(v: SlugVehicle, taken: (slug: string) => boolean): string {
  const base = baseVehicleSlug(v);
  if (!taken(base)) return base;
  const tails = [slugPart(v.stockNumber, 24), slugPart((v.vin || '').slice(-8), 8), slugPart(v.id.replace(/-/g, '').slice(0, 8), 8)].filter(Boolean);
  for (const tail of tails) {
    const s = `${base}-${tail}`;
    if (!taken(s)) return s;
  }
  for (let i = 2; ; i++) {
    const s = `${base}-${tails[0] || 'v'}-${i}`;
    if (!taken(s)) return s;
  }
}

/** true when `slug` was made from this vehicle's current year/make/model/trim (with or without a duplicate tail) */
export function slugMatchesVehicle(slug: string, v: SlugVehicle): boolean {
  const base = baseVehicleSlug(v);
  return slug === base || slug.startsWith(base + '-');
}

export interface TemplateVehicle {
  year: number | null;
  make: string;
  model: string;
  trim: string;
  price: unknown;
  mileage: number | null;
  stockNumber: string;
  vin: string;
  bodyStyle: string;
  condition: string;
  exteriorColor: string;
}

export interface TemplateDealer {
  name: string;
  city: string;
  state: string;
}

export function templateVars(v: TemplateVehicle, d: TemplateDealer): Record<string, string> {
  const price = v.price === null || v.price === undefined || v.price === '' ? NaN : Number(v.price);
  return {
    year: v.year ? String(v.year) : '',
    make: v.make || '',
    model: v.model || '',
    trim: v.trim || '',
    price: Number.isFinite(price) && price > 0 ? '$' + Math.round(price).toLocaleString('en-US') : 'call for price',
    mileage: v.mileage !== null && v.mileage !== undefined ? Math.round(v.mileage).toLocaleString('en-US') : '',
    dealerName: d.name || '',
    city: d.city || '',
    state: d.state || '',
    stock: v.stockNumber || '',
    vin: v.vin || '',
    body: v.bodyStyle || '',
    condition: v.condition || '',
    color: v.exteriorColor || '',
  };
}

/**
 * Fills {year} {make} … and tidies what empty values leave behind ("in , |" → "|", double spaces,
 * ". ," …). Unknown {placeholders} are removed.
 */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  let s = String(tpl || '').replace(/\{([a-zA-Z]+)\}/g, (_m, k: string) => {
    const key = Object.keys(vars).find((x) => x.toLowerCase() === k.toLowerCase());
    return key ? vars[key] : '';
  });
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\s+([,.;:!?])/g, '$1'); // " ," → ","
  s = s.replace(/,(\s*,)+/g, ','); // ",," → ","
  s = s.replace(/\b(in|at|near|from)\s*,\s*/gi, '$1 '); // "in , TX" → "in TX"
  s = s.replace(/\b(in|at|near|from)\s*([|.\-–—]|$)/gi, '$2'); // "in |" → "|"
  s = s.replace(/,\s*([|.\-–—])/g, ' $1'); // ", |" → " |"
  s = s.replace(/([.!?])\s*\1+/g, '$1'); // ". ." → "."
  s = s.replace(/(^|[.!?]\s)\s*(miles|mi)\b,?\s*/gi, '$1'); // ". miles, $9,000" without mileage
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/([,.])(?:\s*[,.])+/g, '$1');
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(/([.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()); // new sentence → capital letter
  s = s.replace(/^[\s|,.\-–—]+|[\s|,\-–—]+$/g, '').trim();
  return s;
}

/** live character-count guide used by the admin and the API */
export const TITLE_RANGE = [50, 60] as const;
export const DESCRIPTION_RANGE = [150, 160] as const;
