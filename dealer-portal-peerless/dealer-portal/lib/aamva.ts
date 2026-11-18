/**
 * US / Canadian driver's license and ID barcode (AAMVA PDF417) → buyer fields.
 * The barcode text is a list of 3-letter element IDs followed by their value, one per line, e.g.
 * DCS (last name), DAC (first name), DAD (middle name), DAG (street), DAI (city), DAJ (state), DAK (ZIP),
 * DBB (date of birth), DAQ (license number), DBA (expiry date). Older cards use DCT / DAA for names.
 */
export interface LicenseData {
  firstName: string;
  middleName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  /** YYYY-MM-DD */
  dob: string;
  licenseNumber: string;
  licenseState: string;
  /** YYYY-MM-DD */
  expiry: string;
}

/** element IDs used to split a barcode that a scanner returned as one long line */
const KNOWN =
  /(?=(?:DAQ|DCS|DAC|DAD|DAG|DAH|DAI|DAJ|DAK|DBB|DBA|DBC|DBD|DAY|DAU|DAW|DAZ|DCG|DCT|DAA|DAB|DCF|DCA|DCB|DCD|DDE|DDF|DDG|DCK)[A-Z0-9 ,/-])/;

/** element ID → value */
export function aamvaElements(raw: string): Record<string, string> {
  const text = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u001c\u001d\u001e]/g, '\n');
  let lines = text.split('\n');
  // header line: "@ … ANSI 6360…DL00410278ZV…DLDAQ123…" → keep what follows the last "DL"/"ID" before the first element
  lines = lines.map((l) => {
    if (!/ANSI|AAMVA/.test(l)) return l;
    const m = /(?:DL|ID)(?=DA[A-Z]|DC[A-Z]|DB[A-Z])(?!.*(?:DL|ID)(?=DA[A-Z]|DC[A-Z]|DB[A-Z]))/.exec(l);
    return m ? l.slice(m.index + 2) : '';
  });
  if (lines.filter((l) => /^D[A-Z]{2}/.test(l.trim())).length < 3) lines = lines.flatMap((l) => l.split(KNOWN));
  const out: Record<string, string> = {};
  for (const lineRaw of lines) {
    const m = /^(D[A-Z]{2}|Z[A-Z]{2})(.*)$/.exec(lineRaw.trim());
    if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
  }
  return out;
}

/** MMDDYYYY (US) or YYYYMMDD (Canada) → YYYY-MM-DD */
function aamvaDate(v: string, canada: boolean): string {
  const d = (v || '').replace(/\D/g, '');
  if (d.length !== 8) return '';
  const ymd = canada || /^(19|20)\d{2}(0[1-9]|1[0-2])/.test(d) ? [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)] : [d.slice(4, 8), d.slice(0, 2), d.slice(2, 4)];
  const [y, m, dd] = ymd.map(Number);
  if (!y || m < 1 || m > 12 || dd < 1 || dd > 31) return '';
  return `${ymd[0]}-${ymd[1]}-${ymd[2]}`;
}

const cap = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (_m, c: string) => 'Mc' + c.toUpperCase());

const clean = (s: string | undefined) => (s || '').replace(/\s+/g, ' ').trim();
const none = (s: string) => (/^(NONE|UNAVL|N\/A)$/i.test(s) ? '' : s);

/** is this text an AAMVA license barcode? */
export function looksLikeAamva(raw: string) {
  const e = aamvaElements(raw);
  return !!(e.DAQ || e.DCS || e.DAC || e.DCT || e.DAA);
}

export function parseAamva(raw: string): LicenseData | null {
  const e = aamvaElements(raw);
  if (!looksLikeAamva(raw)) return null;
  const canada = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test(clean(e.DAJ).toUpperCase()) || clean(e.DCG).toUpperCase() === 'CAN';
  let first = none(clean(e.DAC));
  let middle = none(clean(e.DAD));
  let last = none(clean(e.DCS || e.DAB));
  // version 1 cards: DCT = "FIRST,MIDDLE" or "FIRST MIDDLE"; DAA = "LAST,FIRST,MIDDLE"
  if (!first && e.DCT) [first, middle = ''] = clean(e.DCT).split(/[,$ ]+/);
  if ((!first || !last) && e.DAA) {
    const p = clean(e.DAA).split(/[,$]/).map((x) => x.trim());
    last = last || p[0] || '';
    first = first || p[1] || '';
    middle = middle || p[2] || '';
  }
  const zip = clean(e.DAK).replace(/[^0-9A-Z]/gi, '');
  const state = clean(e.DAJ).toUpperCase().slice(0, 2);
  return {
    firstName: cap(first),
    middleName: cap(middle),
    lastName: cap(last),
    address: cap([clean(e.DAG), clean(e.DAH)].filter(Boolean).join(' ')),
    city: cap(clean(e.DAI)),
    state,
    zip: /^\d{9}$/.test(zip) ? (zip.slice(5) === '0000' ? zip.slice(0, 5) : `${zip.slice(0, 5)}-${zip.slice(5)}`) : zip.replace(/0000$/, '').slice(0, 10),
    dob: aamvaDate(clean(e.DBB), canada),
    licenseNumber: clean(e.DAQ).toUpperCase(),
    licenseState: state,
    expiry: aamvaDate(clean(e.DBA), canada),
  };
}

