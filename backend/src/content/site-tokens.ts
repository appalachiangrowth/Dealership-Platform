import type { TenantSettings } from '../generated/prisma/client.js';

/** Business details as {tokens} for website text (ported from pa_site_tokens). */
export function siteTokens(s: Partial<TenantSettings> | null, fallbackName = '') {
  const v = (k: keyof TenantSettings) => String((s?.[k] as string | undefined) ?? '').trim();
  const name = v('name') || fallbackName;
  const city = v('city');
  const state = v('state');
  const cityState = [city, state].filter(Boolean).join(', ');
  const street = v('street');
  const zip = v('zip');
  const address = [street, [cityState, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const tel = v('phone').replace(/[^\d+]/g, '');
  const q = encodeURIComponent(address || name);
  return {
    name,
    legal_name: v('legalName') || name,
    tagline: v('tagline'),
    phone: v('phone'),
    tel,
    email: v('email'),
    street,
    city,
    state,
    state_name: v('stateName') || state,
    zip,
    country: v('country'),
    city_state: cityState,
    address,
    hours_week: v('hoursWeek'),
    hours_weekend: v('hoursWeekend'),
    hours_short: v('hoursShort'),
    maps_dir: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    maps_embed: `https://maps.google.com/maps?q=${q}&z=15&output=embed`,
    google_reviews: v('googleReviews') || `https://www.google.com/search?q=${encodeURIComponent(`${name} ${cityState} reviews`)}`,
    year: String(new Date().getFullYear()),
  };
}

export type SiteTokens = ReturnType<typeof siteTokens>;

/** Visible placeholders for the public site while business details are empty. */
export const TOKEN_PLACEHOLDERS: Partial<Record<keyof SiteTokens, string>> = {
  name: 'Your Dealership',
  phone: 'Add phone number',
  email: 'Add email address',
  street: 'Add street address',
  city: 'Your City',
  state: 'ST',
  city_state: 'Your City, ST',
  address: 'Add your address',
  hours_week: 'Add business hours',
  hours_short: 'Add business hours',
};

export function withPlaceholders(t: SiteTokens): SiteTokens & { _missing: string[] } {
  const out = { ...t, _missing: [] as string[] };
  for (const [k, p] of Object.entries(TOKEN_PLACEHOLDERS)) {
    if (!out[k as keyof SiteTokens]) {
      (out as Record<string, unknown>)[k] = p;
      out._missing.push(k);
    }
  }
  return out;
}

export function substitute(text: string, tokens: Record<string, unknown>): string {
  return text.replace(/\{([a-z_]+)\}/g, (m, k) => (k in tokens ? String(tokens[k] ?? '') : m));
}
