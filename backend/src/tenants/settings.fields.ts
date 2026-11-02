import { clean, isColor, isEmail, safeUrl } from '../common/util.js';

type Kind = 'text' | 'email' | 'url' | 'image' | 'color' | 'int' | 'bool' | 'secret' | 'hours' | 'enum';
interface FieldDef {
  kind: Kind;
  max?: number;
  values?: string[];
  /** business = Business details permission, settings = Email & advanced settings permission */
  group: 'business' | 'settings';
}

/** Every dealership setting a dealer can change, with its type (ported from pa_settings_schema). */
export const SETTINGS_FIELDS: Record<string, FieldDef> = {
  name: { kind: 'text', max: 120, group: 'business' },
  legalName: { kind: 'text', max: 160, group: 'business' },
  tagline: { kind: 'text', max: 240, group: 'business' },
  logo: { kind: 'image', max: 400, group: 'business' },
  phone: { kind: 'text', max: 40, group: 'business' },
  email: { kind: 'email', max: 160, group: 'business' },
  street: { kind: 'text', max: 160, group: 'business' },
  city: { kind: 'text', max: 80, group: 'business' },
  state: { kind: 'text', max: 40, group: 'business' },
  stateName: { kind: 'text', max: 80, group: 'business' },
  zip: { kind: 'text', max: 20, group: 'business' },
  country: { kind: 'text', max: 80, group: 'business' },
  lat: { kind: 'text', max: 20, group: 'business' },
  lng: { kind: 'text', max: 20, group: 'business' },
  hours: { kind: 'hours', group: 'business' },
  hoursWeek: { kind: 'text', max: 240, group: 'business' },
  hoursWeekend: { kind: 'text', max: 240, group: 'business' },
  hoursShort: { kind: 'text', max: 200, group: 'business' },
  facebook: { kind: 'url', max: 300, group: 'business' },
  instagram: { kind: 'url', max: 300, group: 'business' },
  google: { kind: 'url', max: 300, group: 'business' },
  googleReviews: { kind: 'url', max: 400, group: 'business' },
  youtube: { kind: 'url', max: 300, group: 'business' },
  tiktok: { kind: 'url', max: 300, group: 'business' },
  messenger: { kind: 'url', max: 300, group: 'business' },
  siteUrl: { kind: 'url', max: 200, group: 'business' },
  themeColor: { kind: 'color', group: 'business' },

  leadTo: { kind: 'email', max: 160, group: 'settings' },
  smtpHost: { kind: 'text', max: 120, group: 'settings' },
  smtpPort: { kind: 'int', max: 65535, group: 'settings' },
  smtpSecure: { kind: 'enum', values: ['SSL', 'TLS', 'NONE'], group: 'settings' },
  smtpUser: { kind: 'text', max: 160, group: 'settings' },
  smtpPass: { kind: 'secret', max: 200, group: 'settings' },
  smtpFrom: { kind: 'email', max: 160, group: 'settings' },
  smtpFromName: { kind: 'text', max: 120, group: 'settings' },
  maxUploadMb: { kind: 'int', max: 50, group: 'settings' },
  brandImages: { kind: 'bool', group: 'settings' },
  brandBandColor: { kind: 'color', group: 'settings' },
  dealerCrmEmail: { kind: 'email', max: 160, group: 'settings' },
  dealerCrmFormat: { kind: 'enum', values: ['text', 'adf'], group: 'settings' },
  dealerRadius: { kind: 'text', max: 10, group: 'settings' },
  feedOperation: { kind: 'text', max: 40, group: 'settings' },
  feedCompleteBatch: { kind: 'enum', values: ['Y', 'N'], group: 'settings' },
  feedToken: { kind: 'secret', max: 120, group: 'settings' },
  cargurusFtpHost: { kind: 'text', max: 120, group: 'settings' },
  cargurusFtpUser: { kind: 'text', max: 120, group: 'settings' },
  cargurusFtpPass: { kind: 'secret', max: 200, group: 'settings' },
  cargurusFtpPort: { kind: 'int', max: 65535, group: 'settings' },
  cargurusFtpSsl: { kind: 'bool', group: 'settings' },
  cargurusRemoteDir: { kind: 'text', max: 200, group: 'settings' },
  cargurusRemoteName: { kind: 'text', max: 120, group: 'settings' },
};

export const SECRET_FIELDS = Object.entries(SETTINGS_FIELDS)
  .filter(([, f]) => f.kind === 'secret')
  .map(([k]) => k);

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
type Day = (typeof DAYS)[number];
export type Hours = Partial<Record<Day, { s: 'open' | 'closed'; o: string; c: string }>>;

function cleanHours(v: unknown): Hours {
  let src = v;
  if (typeof v === 'string') {
    try {
      src = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!src || typeof src !== 'object') return {};
  const out: Hours = {};
  for (const d of DAYS) {
    const x = (src as Record<string, unknown>)[d] as Record<string, unknown> | undefined;
    if (!x) continue;
    const t = (s: unknown) => (typeof s === 'string' && /^\d{2}:\d{2}$/.test(s) ? s : '');
    out[d] = { s: x.s === 'closed' ? 'closed' : 'open', o: t(x.o) || '09:00', c: t(x.c) || '18:00' };
  }
  return out;
}

function fmtTime(t: string, short = false): string {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? (short ? 'pm' : 'PM') : short ? 'am' : 'AM';
  const hh = h % 12 || 12;
  if (short) return m ? `${hh}:${String(m).padStart(2, '0')}${ap}` : `${hh}${ap}`;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

const DAY_LABEL: Record<Day, [string, string]> = {
  mon: ['Monday', 'Mon'],
  tue: ['Tuesday', 'Tue'],
  wed: ['Wednesday', 'Wed'],
  thu: ['Thursday', 'Thu'],
  fri: ['Friday', 'Fri'],
  sat: ['Saturday', 'Sat'],
  sun: ['Sunday', 'Sun'],
};

/** Opening-hours texts used by the designs ("Mon – Fri: 7:30 AM – 6:00 PM", "Mon–Fri 7:30am–6pm · Sat …"). */
export function hoursTexts(h: Hours): { hoursWeek: string; hoursWeekend: string; hoursShort: string } {
  const groups: { from: Day; to: Day; key: string; d: Hours[Day] }[] = [];
  for (const d of DAYS) {
    const x = h[d];
    if (!x) continue;
    const key = x.s === 'closed' ? 'closed' : `${x.o}-${x.c}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key && DAYS.indexOf(d) === DAYS.indexOf(last.to) + 1 && d !== 'sat' && d !== 'sun') last.to = d;
    else groups.push({ from: d, to: d, key, d: x });
  }
  const label = (g: (typeof groups)[number], short: boolean) =>
    g.from === g.to
      ? DAY_LABEL[g.from][short ? 1 : 0]
      : `${DAY_LABEL[g.from][1]}${short ? '–' : ' – '}${DAY_LABEL[g.to][1]}`;
  const line = (g: (typeof groups)[number], short: boolean) =>
    g.key === 'closed'
      ? `${label(g, short)}${short ? ' closed' : ': Closed'}`
      : short
        ? `${label(g, true)} ${fmtTime(g.d!.o, true)}–${fmtTime(g.d!.c, true)}`
        : `${label(g, false)}: ${fmtTime(g.d!.o)} – ${fmtTime(g.d!.c)}`;
  const week = groups.filter((g) => g.from !== 'sun');
  const weekend = groups.filter((g) => g.from === 'sun');
  return {
    hoursWeek: week.map((g) => line(g, false)).join(' · '),
    hoursWeekend: weekend.map((g) => line(g, false)).join(' · '),
    hoursShort: groups.map((g) => line(g, true)).join(' · '),
  };
}

/**
 * Validates a settings patch. Returns the clean data and the list of rejected keys.
 * `allowed` = which groups the caller may change (from their permissions).
 */
export function cleanSettingsPatch(
  patch: Record<string, unknown>,
  allowed: { business: boolean; settings: boolean },
): { data: Record<string, unknown>; denied: string[]; invalid: string[] } {
  const data: Record<string, unknown> = {};
  const denied: string[] = [];
  const invalid: string[] = [];
  for (const [k, v] of Object.entries(patch || {})) {
    const f = SETTINGS_FIELDS[k];
    if (!f) continue;
    if (!allowed[f.group]) {
      denied.push(k);
      continue;
    }
    switch (f.kind) {
      case 'text':
        data[k] = clean(v, f.max);
        break;
      case 'email': {
        const e = clean(v, f.max).toLowerCase();
        if (e && !isEmail(e)) invalid.push(k);
        else data[k] = e;
        break;
      }
      case 'url':
        data[k] = safeUrl(v).slice(0, f.max);
        break;
      case 'image': {
        const s = clean(v, f.max);
        data[k] = s === '' || s.startsWith('/uploads/') || /^https?:\/\//.test(s) ? s : '';
        break;
      }
      case 'color':
        if (v === '' || isColor(v)) data[k] = v || '';
        else invalid.push(k);
        break;
      case 'int': {
        const n = parseInt(String(v), 10);
        if (Number.isFinite(n) && n >= 0 && n <= (f.max ?? 99999)) data[k] = n;
        else invalid.push(k);
        break;
      }
      case 'bool':
        data[k] = v === true || v === 'true' || v === 1 || v === '1';
        break;
      case 'enum':
        if (f.values!.includes(String(v))) data[k] = String(v);
        else invalid.push(k);
        break;
      case 'secret': {
        // empty = keep the stored secret; null = clear it
        if (v === null) data[k] = '';
        else {
          const s = clean(v, f.max);
          if (s) data[k] = s;
        }
        break;
      }
      case 'hours': {
        const h = cleanHours(v);
        data.hours = h;
        Object.assign(data, hoursTexts(h));
        break;
      }
    }
  }
  return { data, denied, invalid };
}
