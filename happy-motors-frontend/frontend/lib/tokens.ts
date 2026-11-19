import { safeUrl } from './php';

export type Settings = Record<string, any>;
export type Tokens = Record<string, any>;

/** PHP rawurlencode */
export const rawurlencode = (x: string) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

const isColor = (c: unknown) => typeof c === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c);

/** pa_tel */
export function tel(phone: string): string {
  let d = String(phone || '').replace(/[^0-9+]/g, '');
  if (d === '') return '';
  if (d[0] !== '+') d = (d.length === 10 ? '+1' : d.length === 11 && d[0] === '1' ? '+' : '+') + d;
  return d;
}

/** "/uploads/<dealer>/…" (new storage) → "uploads/<dealer>/…" (relative, like the old platform) */
export const rel = (u: string) => (String(u || '').startsWith('/uploads/') ? String(u).slice(1) : String(u || ''));

/** pa_site_tokens — the dealer's real business details. */
export function siteTokens(s: Settings, origin: string): Tokens {
  const v = (k: string) => String(s?.[k] ?? '').trim();
  const city = v('city');
  const state = v('state');
  const cityState = (city + (city !== '' && state !== '' ? ', ' : '') + state).trim();
  const street = v('street');
  const zip = v('zip');
  const addr = (street + (street !== '' ? ', ' : '') + cityState + (zip !== '' ? ' ' + zip : '')).trim();
  const name = v('name');
  const q = rawurlencode(addr !== '' ? addr : name);
  const t = tel(v('phone'));
  let site = v('siteUrl').replace(/\/+$/, '');
  if (site === '') site = origin;
  const logo = rel(v('logo'));
  const country = v('country');
  return {
    name,
    legal_name: v('legalName') !== '' ? v('legalName') : name,
    tagline: v('tagline'),
    phone: v('phone'),
    tel: t,
    tel_link: t !== '' ? 'tel:' + t : '#',
    email: v('email'),
    email_link: v('email') !== '' ? 'mailto:' + v('email') : '#',
    street,
    city,
    state,
    state_name: v('stateName') !== '' ? v('stateName') : state,
    zip,
    country,
    city_state: cityState,
    address: addr,
    address_full: addr + (country !== '' ? ', ' + country : ''),
    hours_week: v('hoursWeek'),
    hours_weekend: v('hoursWeekend'),
    hours_short: v('hoursShort'),
    maps_dir: 'https://www.google.com/maps/dir/?api=1&destination=' + q,
    maps_embed: 'https://maps.google.com/maps?q=' + q + '&z=15&output=embed',
    maps_search: 'https://www.google.com/maps/search/' + q,
    facebook: v('facebook'),
    instagram: v('instagram'),
    google: v('google'),
    youtube: v('youtube'),
    tiktok: v('tiktok'),
    google_reviews: v('googleReviews') !== '' ? v('googleReviews') : 'https://www.google.com/search?q=' + rawurlencode(name + ' ' + cityState + ' reviews'),
    lat: v('lat'),
    lng: v('lng'),
    site_url: site,
    logo: logo !== '' ? logo : 'images/logo.png',
    theme_color: isColor(v('themeColor')) ? v('themeColor') : '#062B49',
    year: String(new Date().getUTCFullYear()),
  };
}

const PLACEHOLDERS: Record<string, string> = {
  name: 'Your Dealership',
  tagline: 'Quality pre-owned vehicles',
  phone: 'Add phone number',
  email: 'Add email address',
  street: 'Add street address',
  city: 'Your City',
  state: 'ST',
  state_name: 'Your State',
  city_state: 'Your City, ST',
  address: 'Add your address',
  address_full: 'Add your address',
  hours_week: 'Add business hours',
  hours_short: 'Add business hours',
};

/** pa_site_tokens_display — empty details become visible placeholders on the public site. */
export function siteTokensDisplay(real: Tokens, s: Settings): Tokens {
  const t: Tokens = { ...real, _missing: {} as Record<string, boolean> };
  for (const [k, v] of Object.entries(PLACEHOLDERS)) {
    if (t[k] === undefined || String(t[k]).trim() === '') {
      t[k] = v;
      t._missing[k] = true;
    }
  }
  if (String(s?.legalName ?? '').trim() === '') t.legal_name = t.name;
  if (t._missing.address) {
    t.maps_dir = '#';
    t.maps_search = '#';
  }
  if (t._missing.name && t._missing.city_state) t.google_reviews = '#';
  t.logo_missing = String(s?.logo ?? '').trim() === '';
  return t;
}

/** pa_abs_site_url */
export function absSiteUrl(u: string, site: string): string {
  const local = /^(uploads|themes|images)\/[A-Za-z0-9_\-./]+$/.test(u) && !u.includes('..');
  const s = safeUrl(u, !local);
  if (s === '' || s === '#') return '';
  return /^https?:\/\//i.test(s) ? s : site.replace(/\/+$/, '') + '/' + s.replace(/^\/+/, '');
}
