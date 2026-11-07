/**
 * CarGurus ingestion — validation + dealer-data enrichment (ported 1:1 from CarGurusIngestionService.php).
 *  1. parse()        CSV / TSV / TXT text → header row + rows (delimiter auto-detected)
 *  2. mapHeaders()   pre-flight: the 12 mandatory vehicle columns must exist in the file
 *  3. ingestRows()   every row → record with normalized values, _raw, _issues, _warn
 *  4. dealerMeta()   dealership identity merged into every row (columns 14-20)
 *  5. csv()          the 20 CarGurus columns in the exact CarGurus order
 *  6. audit()        summary for the Platform Admin banner
 */

export type ColumnKey =
  | 'vin' | 'make' | 'model' | 'year' | 'trim' | 'price' | 'mileage' | 'images' | 'ext' | 'comments' | 'stock' | 'trans' | 'options' | 'processing_fee'
  | 'dealer_id' | 'dealer_name' | 'dealer_street' | 'dealer_city' | 'dealer_state' | 'dealer_zip' | 'dealer_crm_email';

export const COLUMNS: [ColumnKey, string, boolean, 'vehicle' | 'dealer'][] = [
  ['vin', 'VIN', true, 'vehicle'],
  ['make', 'Make', true, 'vehicle'],
  ['model', 'Model', true, 'vehicle'],
  ['year', 'Year', true, 'vehicle'],
  ['trim', 'Trim', true, 'vehicle'],
  ['price', 'Price', true, 'vehicle'],
  ['processing_fee', 'Processing Fee', false, 'vehicle'],
  ['mileage', 'Mileage', true, 'vehicle'],
  ['images', 'Image URLs', true, 'vehicle'],
  ['ext', 'Exterior Color', true, 'vehicle'],
  ['comments', 'Dealer comments on vehicle', true, 'vehicle'],
  ['stock', 'Stock Number', true, 'vehicle'],
  ['trans', 'Transmission Type', true, 'vehicle'],
  ['options', 'Installed Options', false, 'vehicle'],
  ['dealer_id', 'Dealer ID', true, 'dealer'],
  ['dealer_name', 'Dealer Name', true, 'dealer'],
  ['dealer_street', 'Dealer Street Address', true, 'dealer'],
  ['dealer_city', 'Dealer City', true, 'dealer'],
  ['dealer_state', 'Dealer State', true, 'dealer'],
  ['dealer_zip', 'Dealer ZIP', true, 'dealer'],
  ['dealer_crm_email', 'Dealer CRM Email', true, 'dealer'],
];

const LABEL = Object.fromEntries(COLUMNS.map((c) => [c[0], c[1]])) as Record<ColumnKey, string>;
export const label = (k: ColumnKey) => LABEL[k];

type VehicleKey = 'vin' | 'make' | 'model' | 'year' | 'trim' | 'price' | 'mileage' | 'images' | 'ext' | 'comments' | 'stock' | 'trans' | 'options' | 'processing_fee';

export const ALIASES: Record<VehicleKey, string[]> = {
  vin: ['vin', 'vinnumber', 'vehiclevin'],
  make: ['make', 'manufacturer'],
  model: ['model', 'modelname'],
  year: ['year', 'modelyear'],
  trim: ['trim', 'trimlevel', 'series'],
  price: ['price', 'sellingprice', 'saleprice', 'internetprice', 'askingprice', 'listprice'],
  processing_fee: ['processingfee', 'processing_fee', 'profee', 'docfee', 'documentationfee', 'dealerfee', 'adminfee'],
  mileage: ['mileage', 'miles', 'odometer'],
  images: ['imageurls', 'imageurl', 'images', 'photourls', 'photos', 'pictures'],
  ext: ['exteriorcolor', 'extcolor', 'exteriorcolour', 'color', 'colour'],
  comments: ['dealercommentsonvehicle', 'dealercomments', 'comments', 'description', 'vehiclecomments'],
  stock: ['stocknumber', 'stock', 'stockno', 'stocknum', 'stock#'],
  trans: ['transmissiontype', 'transmission', 'trans'],
  options: ['installedoptions', 'options', 'features'],
};

export const VEHICLE_MANDATORY: VehicleKey[] = ['vin', 'make', 'model', 'year', 'trim', 'price', 'mileage', 'images', 'ext', 'comments', 'stock', 'trans'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif'];
export const MAX_ROWS = 5000;

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};

export interface CgRecord {
  _row: number;
  vin: string;
  make: string;
  model: string;
  year: number;
  trim: string;
  price: number;
  mileage: number;
  images: string[];
  ext: string;
  comments: string;
  stock: string;
  trans: string;
  options: string;
  _raw: Record<string, string>;
  _issues: Partial<Record<ColumnKey, string[]>>;
  _warn: Partial<Record<ColumnKey, string[]>>;
  /** additional columns of the dealer's file (header → value) — not checked, added at the end of the master CSV */
  _extra?: Record<string, string>;
}

export interface DealerMeta {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  stateRaw: string;
  zip: string;
  zipRaw: string;
  crmEmail: string;
  crmFormat: string;
  phone: string;
  site: string;
}

export const headerRow = () => COLUMNS.map((c) => c[1]);
export const vehicleTemplate = () => COLUMNS.filter((c) => c[3] === 'vehicle').map((c) => c[1]);
export const columnsInfo = () => COLUMNS.map(([key, lab, mandatory, source]) => ({ key, label: lab, mandatory, source }));
export const norm = (h: string) => String(h).trim().toLowerCase().replace(/[^a-z0-9#]/g, '');

/** RFC-4180 style CSV line splitter for one delimiter (handles quotes and new lines inside quotes). */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function parse(text: string): [string[], string[][]] {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n', 1)[0];
  let best = ',';
  let bestN = 0;
  for (const d of [',', '\t', ';', '|']) {
    const n = parseDelimited(first, d)[0]?.length ?? 0;
    if (n > bestN) {
      bestN = n;
      best = d;
    }
  }
  const rows = parseDelimited(t, best)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (!rows.length) return [[], []];
  return [rows[0], rows.slice(1)];
}

export function mapHeaders(headers: string[]) {
  const map: Partial<Record<VehicleKey, number>> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [k, al] of Object.entries(ALIASES) as [VehicleKey, string[]][]) if (map[k] === undefined && al.includes(n)) map[k] = i;
  });
  const missing: string[] = [];
  const found: { field: string; level: string; found: string }[] = [];
  for (const k of Object.keys(ALIASES) as VehicleKey[]) {
    const mand = VEHICLE_MANDATORY.includes(k);
    if (mand && map[k] === undefined) missing.push(label(k));
    found.push({ field: label(k), level: mand ? 'required' : 'optional', found: map[k] !== undefined ? headers[map[k]!] : '' });
  }
  return { map, missing, found };
}

const short = (u: string) => (u.length > 70 ? u.slice(0, 67) + '...' : u);

export function vinCheckDigitOk(vin: string): boolean {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 7, 9, 2, 3, 4, 5, 6, 7, 8, 9];
  const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : vals[letters.indexOf(c)]) * w[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

/**
 * headers === null: rows are objects with canonical keys (website inventory), numbered 1..n.
 * Otherwise line numbers match the file (header = line 1).
 */
export function ingestRows(headers: string[] | null, rows: (string[] | Record<string, unknown>)[], map?: Partial<Record<VehicleKey, number>>): CgRecord[] {
  if (headers && !map) map = mapHeaders(headers).map;
  const out: CgRecord[] = [];
  const seenVin: Record<string, number> = {};
  const seenStock: Record<string, number> = {};
  const maxYear = new Date().getUTCFullYear() + 1;
  rows.forEach((r, i) => {
    const line = headers === null ? i + 1 : i + 2;
    const raw: Record<string, string> = {};
    for (const k of Object.keys(ALIASES) as VehicleKey[]) {
      let v: unknown;
      if (headers === null) {
        v = (r as Record<string, unknown>)[k] ?? '';
        if (Array.isArray(v)) v = v.join('|');
      } else v = map![k] !== undefined ? (r as string[])[map![k]!] ?? '' : '';
      raw[k] = String(v ?? '').trim();
    }
    const iss: Partial<Record<ColumnKey, string[]>> = {};
    const wrn: Partial<Record<ColumnKey, string[]>> = {};
    const add = (k: ColumnKey, m: string) => (iss[k] ||= []).push(m);
    const warn = (k: ColumnKey, m: string) => (wrn[k] ||= []).push(m);

    const vin = raw.vin.replace(/[\s-]+/g, '').toUpperCase();
    if (vin === '') add('vin', 'Missing VIN');
    else if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) add('vin', `Invalid VIN "${vin}": must be exactly 17 letters/digits, without I, O or Q`);
    else if (!vinCheckDigitOk(vin)) warn('vin', 'VIN fails the check-digit test (normal for some imported vehicles): please double-check it');
    if (vin !== '' && seenVin[vin]) add('vin', `Duplicate VIN (also on row ${seenVin[vin]})`);
    else if (vin !== '') seenVin[vin] = line;

    const make = raw.make.replace(/\s+/g, ' ');
    const model = raw.model.replace(/\s+/g, ' ');
    if (!make) add('make', 'Missing Make');
    if (!model) add('model', 'Missing Model');

    const y = raw.year;
    if (y === '') add('year', 'Missing Year');
    else if (!/^\d{4}$/.test(y) || +y < 1980 || +y > maxYear) add('year', `Invalid Year "${y}": use a 4-digit year between 1980 and ${maxYear}`);

    const pRaw = raw.price.replace(/,/g, '').replace(/[^0-9.]/g, '');
    const feeRaw = (raw.processing_fee || '').replace(/,/g, '').replace(/[^0-9.]/g, '');
    const basePrice = pRaw !== '' && !isNaN(+pRaw) ? +pRaw : 0;
    const fee = feeRaw !== '' && !isNaN(+feeRaw) ? +feeRaw : 0;
    const combinedPrice = basePrice + fee;

    if (raw.price === '') add('price', 'Missing Price');
    else if (pRaw === '' || isNaN(+pRaw) || combinedPrice <= 0) add('price', `Invalid Price "${raw.price}": must be a number greater than 0`);

    const mRaw = raw.mileage;
    const m = mRaw.replace(/\s*(mi|miles|km)\.?$/i, '').replace(/,/g, '').replace(/[^0-9.]/g, '');
    if (mRaw === '') add('mileage', 'Missing Mileage');
    else if (m === '' || isNaN(+m) || Math.floor(+m) !== +m) add('mileage', `Invalid Mileage "${mRaw}": must be a whole number (odometer reading)`);
    else if (+m === 0) warn('mileage', 'Mileage is 0: only correct for brand-new vehicles');

    const st = raw.stock;
    if (st === '') add('stock', 'Missing Stock Number');
    else if (!/^[A-Za-z0-9\-_./#]{1,40}$/.test(st)) add('stock', `Invalid Stock Number "${st}": letters, digits and - _ . / # only (max 40)`);
    if (st !== '' && seenStock[st.toLowerCase()]) add('stock', `Duplicate Stock Number (also on row ${seenStock[st.toLowerCase()]})`);
    else if (st !== '') seenStock[st.toLowerCase()] = line;

    const imgs: string[] = [];
    if (raw.images === '') add('images', 'Missing Image URLs');
    else {
      for (let u of raw.images.split(/\s*[,|;\n]\s*|\s+(?=https?:\/\/)/i)) {
        u = u.trim().replace(/^["']|["']$/g, '');
        if (!u) continue;
        if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(u)) {
          add('images', `Not a valid image URL: "${short(u)}" (must start with http:// or https://)`);
          continue;
        }
        let path = '';
        try {
          path = new URL(u).pathname;
        } catch {
          path = '';
        }
        const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
        if (ext && !IMAGE_EXT.includes(ext) && /^[a-z0-9]{2,5}$/.test(ext)) {
          add('images', `Image URL format not supported (.${ext}): only JPEG, JPG, PNG or GIF - ${short(u)}`);
          continue;
        }
        if (!ext) warn('images', `Format cannot be confirmed from the link (no .jpg/.png/.gif ending): ${short(u)}`);
        if (!imgs.includes(u)) imgs.push(u);
      }
      if (!imgs.length && !iss.images) add('images', 'Missing Image URLs');
    }

    const rec: CgRecord = {
      _row: line,
      vin,
      make,
      model,
      year: /^\d{4}$/.test(y) ? +y : 0,
      trim: raw.trim.replace(/\s+/g, ' '),
      price: combinedPrice > 0 ? Math.round(combinedPrice * 100) / 100 : 0,
      mileage: m !== '' && !isNaN(+m) ? Math.trunc(+m) : 0,
      images: imgs,
      ext: raw.ext.replace(/\s+/g, ' '),
      comments: raw.comments.replace(/\s+/g, ' ').trim(),
      stock: st,
      trans: raw.trans.replace(/\s+/g, ' '),
      options: raw.options
        .split(/\s*[|;,\n]\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', '),
      _raw: raw,
      _issues: iss,
      _warn: wrn,
    };
    for (const k of ['trim', 'ext', 'comments', 'trans'] as const) if (rec[k] === '') add(k, `Missing ${label(k)}`);
    out.push(rec);
  });
  return out;
}

export const recordValid = (r: CgRecord) => !r._issues || Object.keys(r._issues).length === 0;

export function dealerIssues(m: DealerMeta) {
  const i: Partial<Record<ColumnKey, string[]>> = {};
  const add = (k: ColumnKey, s: string) => (i[k] ||= []).push(s);
  if (!m.id) add('dealer_id', 'Missing Dealer ID (set it in Platform Admin > dealership > Settings)');
  else if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/.test(m.id)) add('dealer_id', 'Invalid Dealer ID');
  if (!m.name) add('dealer_name', 'Missing Dealer Name (Business details)');
  if (!m.street) add('dealer_street', 'Missing Dealer Street Address (Business details)');
  if (!m.city) add('dealer_city', 'Missing Dealer City (Business details)');
  if (!m.state) add('dealer_state', 'Missing Dealer State (Business details)');
  else if (!US_STATES[m.state]) add('dealer_state', `Dealer State must be a 2-letter US state code (e.g. VA, WV, NC), not "${m.stateRaw}"`);
  if (!m.zipRaw) add('dealer_zip', 'Missing Dealer ZIP (Business details)');
  else if (!/^\d{5}$/.test(m.zip)) add('dealer_zip', `Dealer ZIP must be a 5-digit ZIP code, not "${m.zipRaw}"`);
  if (!m.crmEmail) add('dealer_crm_email', "Missing Dealer CRM Email (Platform Admin > dealership > Settings, or the dealer's inquiry email)");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.crmEmail)) add('dealer_crm_email', 'Dealer CRM Email is not a valid email address');
  return i;
}

export function profile(m: DealerMeta) {
  const iss = dealerIssues(m);
  const keys: ColumnKey[] = ['dealer_id', 'dealer_name', 'dealer_street', 'dealer_city', 'dealer_state', 'dealer_zip', 'dealer_crm_email'];
  const missing = keys.filter((k) => iss[k]).map((k) => ({ field: label(k), issue: iss[k]![0] }));
  const done = keys.length - missing.length;
  return { complete: missing.length === 0, percent: Math.round((100 * done) / keys.length), done, total: keys.length, missing, issues: iss };
}

export function exportValues(r: CgRecord, m: DealerMeta): string[] {
  const price = Number(r.price);
  return [
    r.vin,
    r.make,
    r.model,
    r.year ? String(r.year) : '',
    r.trim,
    price > 0 ? (Number.isInteger(price) ? String(price) : price.toFixed(2)) : '',
    String(Math.trunc(r.mileage)),
    r.images.map((u) => u.replace(/,/g, '%2C')).join(','),
    r.ext,
    r.comments,
    r.stock,
    r.trans,
    r.options,
    m.id,
    m.name,
    m.street,
    m.city,
    m.state,
    m.zip,
    m.crmEmail,
  ];
}

function csvCell(v: string) {
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/** Additional column names of the records, in the order they first appear (never one of the 20 CarGurus columns). */
export function extraHeaders(records: CgRecord[]): string[] {
  const taken = new Set(headerRow().map(norm));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of records)
    for (const h of Object.keys(r._extra || {})) {
      const n = norm(h);
      if (!h.trim() || taken.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(h);
    }
  return out;
}

/**
 * The 20 CarGurus columns in CarGurus order. withExtra (CarGurus master CSV for the Platform Admin): the dealer's
 * additional file columns are added at the END, so the 20 CarGurus columns keep their exact order and names.
 */
export function csv(records: CgRecord[], m: DealerMeta, onlyValid = false, withExtra = false): string {
  const extra = withExtra ? extraHeaders(records) : [];
  const lines = [[...headerRow(), ...extra].map(csvCell).join(',')];
  for (const r of records) {
    if (onlyValid && !recordValid(r)) continue;
    const ex = r._extra || {};
    const byNorm = new Map(Object.entries(ex).map(([k, v]) => [norm(k), v]));
    lines.push([...exportValues(r, m), ...extra.map((h) => String(ex[h] ?? byNorm.get(norm(h)) ?? ''))].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Dealer columns of the CarGurus file (filled in automatically from the dealership profile, never kept as extra). */
export const DEALER_COLUMN_NORMS = new Set(COLUMNS.filter((c) => c[3] === 'dealer').map((c) => norm(c[1])));

export function audit(records: CgRecord[], m: DealerMeta) {
  const checks = VEHICLE_MANDATORY.map((k) => ({ key: k, label: label(k), failed: 0 }));
  let issues = 0;
  let invalid = 0;
  let warnings = 0;
  for (const r of records) {
    if (!recordValid(r)) invalid++;
    for (const k of Object.keys(r._issues || {})) {
      issues++;
      const c = checks.find((x) => x.key === k);
      if (c) c.failed++;
    }
    for (const list of Object.values(r._warn || {})) warnings += list!.length;
  }
  const pr = profile(m);
  return {
    total: records.length,
    valid: records.length - invalid,
    invalid,
    issues,
    warnings,
    checks,
    passedChecks: checks.filter((c) => c.failed === 0).length,
    allPassed: issues === 0,
    profile: pr,
    ready: issues === 0 && pr.complete,
  };
}

export function issueList(records: CgRecord[], limit = 500) {
  const o: { row: number; field: string; issue: string; vehicle: string }[] = [];
  for (const r of records)
    for (const [k, list] of Object.entries(r._issues || {}))
      for (const msg of list!) {
        o.push({ row: r._row, field: label(k as ColumnKey), issue: msg, vehicle: [r.year || '', r.make, r.model].join(' ').trim() });
        if (o.length >= limit) return o;
      }
  return o;
}

export function warningList(records: CgRecord[], limit = 200) {
  const o: { row: number; field: string; issue: string }[] = [];
  for (const r of records)
    for (const [k, list] of Object.entries(r._warn || {}))
      for (const msg of list!) {
        o.push({ row: r._row, field: label(k as ColumnKey), issue: msg });
        if (o.length >= limit) return o;
      }
  return o;
}

export function buildDealerMeta(p: { dealerCode: string; name: string; street: string; city: string; state: string; zip: string; crmEmail: string; crmFormat: string; phone: string; site: string }): DealerMeta {
  let state = p.state.trim().toUpperCase();
  if (state.length > 2) {
    const hit = Object.entries(US_STATES).find(([, n]) => n.toLowerCase() === p.state.trim().toLowerCase());
    if (hit) state = hit[0];
  }
  const zipRaw = p.zip.trim();
  const zm = zipRaw.match(/^(\d{5})(-\d{4})?$/);
  return {
    id: p.dealerCode,
    name: p.name.trim(),
    street: p.street.trim(),
    city: p.city.trim(),
    state,
    stateRaw: p.state,
    zip: zm ? zm[1] : zipRaw,
    zipRaw,
    crmEmail: p.crmEmail.trim(),
    crmFormat: p.crmFormat === 'adf' ? 'ADF/XML' : 'Plain text',
    phone: p.phone,
    site: p.site,
  };
}
