import { randomBytes } from 'crypto';

export const now = () => new Date();

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/** Single-line text: trims, removes control characters, limits length. */
export function clean(s: unknown, max = 4000): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Multi-line text: keeps new lines. */
export function cleanMl(s: unknown, max = 8000): string {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

export function slugify(s: string, max = 60): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'item'
  );
}

export const VALID_TENANT_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** "Blue-Motors.com:8000" → "blue-motors.com" */
export function normDomain(d: string): string {
  let s = String(d || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').split('/')[0].split('?')[0];
  s = s.replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]{1,253}$/.test(s) ? s : '';
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

export function safeUrl(u: unknown): string {
  const s = clean(u, 500);
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s;
  return '';
}

export function isColor(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c);
}

/** In-memory rate limiter (per process). Returns false when over the limit. */
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowSec: number): boolean {
  const t = Date.now();
  const list = (buckets.get(key) || []).filter((x) => t - x < windowSec * 1000);
  if (list.length >= max) {
    buckets.set(key, list);
    return false;
  }
  list.push(t);
  buckets.set(key, list);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((x) => t - x < 3600_000)) buckets.delete(k);
  return true;
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

export function strArray(v: unknown, maxItems = 200, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => clean(x, maxLen)).filter(Boolean).slice(0, maxItems);
}
