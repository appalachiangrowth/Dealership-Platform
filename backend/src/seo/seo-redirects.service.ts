import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { clean } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';

/**
 * Platform Admin › SEO & URLs › URL Redirects: rules a platform owner adds by hand (or imports from a CSV, e.g. old
 * addresses from Google Search Console) for one dealership's website.
 *
 *   301 / 302 / 307 → the website redirects to the destination with exactly that status
 *   410             → the website answers "410 Gone" (noindex) so Google drops the old address
 *
 * They live in SeoRedirect next to the automatic redirects (changed page addresses / vehicle slugs) with manual = true
 * and fromPath = "@m/<normalized source>", so the two kinds never collide. A rule wins over everything else on the
 * website; the source matches path + query first, then the path alone.
 */

export const REDIRECT_CODES = [301, 302, 307, 410] as const;
export type RedirectCode = (typeof REDIRECT_CODES)[number];

/** manual rule key prefix in SeoRedirect.fromPath */
const PREFIX = '@m/';
const MAX_RULES = 20_000;
const MAX_IMPORT = 5_000;
const CACHE_TTL = 30_000;

/** query parameters added by ads / analytics: ignored when matching ("/x?id=5&utm_source=…" still matches "/x?id=5") */
const TRACKING = /^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|msclkid|yclid|mc_cid|mc_eid|_ga|_gl)$/i;

/**
 * "/Vehicle.html?id=123&utm_source=x", "https://dealer.com/vdp/1/" … → "vehicle.html?id=123", "vdp/1".
 * Path: decoded, lower case, no leading / trailing slash. Query: tracking parameters dropped, sorted (so the order a
 * crawler used does not matter). null = not a usable address.
 */
export function redirectKey(raw: unknown): string | null {
  let s = String(raw ?? '').trim();
  if (!s || s.length > 1000) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, ''); // full URL → path
  s = s.split('#')[0];
  const qi = s.indexOf('?');
  let path = qi < 0 ? s : s.slice(0, qi);
  const query = qi < 0 ? '' : s.slice(qi + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep as typed */
  }
  path = path.toLowerCase().replace(/\s+/g, '-').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
  if (/[<>"'`\\]/.test(path)) return null;
  const pairs = [...new URLSearchParams(query).entries()].filter(([k]) => k && !TRACKING.test(k));
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const qs = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const key = path + (qs ? '?' + qs : '');
  return key.length <= 600 ? key : null;
}

/** "/inventory/x", "inventory/x" or "https://…" — null = not usable */
function destinationOf(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 1000 || /[\s<>"'`\\]/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.hostname ? u.toString() : null;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return null; // javascript:, mailto:, protocol-relative
  return '/' + s.replace(/^\/+/, '');
}

function codeOf(raw: unknown): RedirectCode | null {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return (REDIRECT_CODES as readonly number[]).includes(n) ? (n as RedirectCode) : null;
}

function activeOf(raw: unknown, fallback = true): boolean {
  if (typeof raw === 'boolean') return raw;
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallback;
  if (['active', 'true', '1', 'yes', 'on', 'enabled'].includes(s)) return true;
  if (['inactive', 'false', '0', 'no', 'off', 'disabled'].includes(s)) return false;
  return fallback;
}

type Row = { id: string; fromPath: string; sourcePath: string; destinationUrl: string | null; statusCode: number; isActive: boolean; hits: number; lastHitAt: Date | null; createdAt: Date; updatedAt: Date };

function view(r: Row) {
  return {
    id: r.id,
    sourcePath: r.sourcePath || '/' + r.fromPath.slice(PREFIX.length),
    destinationUrl: r.statusCode === 410 ? null : r.destinationUrl || '',
    statusCode: r.statusCode,
    isActive: r.isActive,
    hits: r.hits,
    lastHitAt: r.lastHitAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** one rule checked and normalized: { key, sourcePath, destinationUrl, statusCode, isActive } or an error text */
type Parsed = { key: string; sourcePath: string; destinationUrl: string | null; statusCode: RedirectCode; isActive: boolean };

function parseRule(b: { source?: unknown; destination?: unknown; code?: unknown; active?: unknown }, partial?: Row): Parsed | { error: string } {
  const key = b.source !== undefined ? redirectKey(b.source) : partial ? partial.fromPath.slice(PREFIX.length) : null;
  if (key === null) return { error: 'Enter the old URL, e.g. /vehicle.html?id=123' };
  if (key === '') return { error: 'The home page cannot be redirected' };
  const statusCode = b.code !== undefined ? codeOf(b.code) : ((partial?.statusCode ?? 301) as RedirectCode);
  if (!statusCode) return { error: 'Redirect type must be 301, 302, 307 or 410' };
  let destinationUrl: string | null = null;
  if (statusCode !== 410) {
    const raw = b.destination !== undefined ? b.destination : partial?.destinationUrl;
    destinationUrl = destinationOf(raw);
    if (!destinationUrl) return { error: 'Enter the new URL, e.g. /inventory/chevrolet-express (or choose 410 – Gone)' };
    if (destinationUrl.startsWith('/') && redirectKey(destinationUrl) === key) return { error: 'The new URL is the same as the old one' };
  }
  const isActive = b.active !== undefined ? activeOf(b.active) : (partial?.isActive ?? true);
  return { key, sourcePath: '/' + key, destinationUrl, statusCode, isActive };
}

export type RuleHit = { id: string; to: string | null; status: RedirectCode };

@Injectable()
export class SeoRedirectsService {
  /** active rules per dealership (key → rule), so the website's resolver needs no query for addresses without one */
  private readonly cache = new Map<string, { at: number; rules: Map<string, RuleHit> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ───────────────────────── website ───────────────────────── */

  private async rules(tenantId: string): Promise<Map<string, RuleHit>> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.rules;
    const rows: { id: string; fromPath: string; destinationUrl: string | null; statusCode: number }[] = await this.prisma.seoRedirect.findMany({
      where: { tenantId, manual: true, isActive: true },
      select: { id: true, fromPath: true, destinationUrl: true, statusCode: true },
    });
    const rules = new Map<string, RuleHit>();
    for (const r of rows) {
      const status = codeOf(r.statusCode);
      if (!status || (status !== 410 && !r.destinationUrl)) continue;
      rules.set(r.fromPath.slice(PREFIX.length), { id: r.id, to: status === 410 ? null : r.destinationUrl, status });
    }
    if (this.cache.size > 2000) this.cache.clear();
    this.cache.set(tenantId, { at: Date.now(), rules });
    return rules;
  }

  private invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  /** the active rule for an address: path + query first, then the path alone */
  async match(tenantId: string, path: string, search = ''): Promise<RuleHit | null> {
    const rules = await this.rules(tenantId);
    if (!rules.size) return null;
    const q = String(search || '').replace(/^\?/, '');
    const full = redirectKey('/' + String(path || '').replace(/^\/+/, '') + (q ? '?' + q : ''));
    if (full === null) return null;
    const bare = full.split('?')[0];
    const r = rules.get(full) || (bare !== full ? rules.get(bare) : undefined);
    if (!r || (bare === '' && !full.includes('?'))) return null;
    this.prisma.seoRedirect.update({ where: { id: r.id }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }).catch(() => undefined);
    return r;
  }

  /* ───────────────────────── Platform Admin ───────────────────────── */

  private async tenantOr404(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!t) throw new NotFoundException('Dealership not found');
    return t as { id: string; name: string };
  }

  private async ruleOr404(tenantId: string, id: string): Promise<Row> {
    const r = await this.prisma.seoRedirect.findFirst({ where: { id, tenantId, manual: true } });
    if (!r) throw new NotFoundException('Redirect not found');
    return r as Row;
  }

  /** ?q=&type=301&status=active|inactive&page=&pageSize= */
  async list(dealerId: string, q: { q?: string; type?: string; status?: string; page?: string; pageSize?: string }) {
    const t = await this.tenantOr404(dealerId);
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(10, parseInt(q.pageSize || '50', 10) || 50));
    const base = { tenantId: t.id, manual: true };
    const where: Record<string, unknown> = { ...base };
    const term = clean(q.q, 200);
    if (term) {
      where.OR = [
        { sourcePath: { contains: term, mode: 'insensitive' } },
        { destinationUrl: { contains: term, mode: 'insensitive' } },
      ];
    }
    const code = codeOf(q.type);
    if (code) where.statusCode = code;
    if (q.status === 'active') where.isActive = true;
    if (q.status === 'inactive') where.isActive = false;
    const [rows, total, all, active] = await Promise.all([
      this.prisma.seoRedirect.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.seoRedirect.count({ where }),
      this.prisma.seoRedirect.count({ where: base }),
      this.prisma.seoRedirect.count({ where: { ...base, isActive: true } }),
    ]);
    return { items: (rows as Row[]).map(view), total, page, pageSize, counts: { all, active, inactive: all - active } };
  }

  /** { sourceUrl, destinationUrl?, statusCode, isActive? } */
  async create(dealerId: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(dealerId);
    const r = parseRule({ source: b.sourceUrl ?? b.sourcePath, destination: b.destinationUrl, code: b.statusCode ?? 301, active: b.isActive });
    if ('error' in r) throw new BadRequestException(r.error);
    if ((await this.prisma.seoRedirect.count({ where: { tenantId: t.id, manual: true } })) >= MAX_RULES) {
      throw new BadRequestException(`A dealership can have at most ${MAX_RULES.toLocaleString('en-US')} redirects`);
    }
    const exists = await this.prisma.seoRedirect.findUnique({ where: { tenantId_fromPath: { tenantId: t.id, fromPath: PREFIX + r.key } } });
    if (exists) throw new ConflictException(`There is already a redirect for ${r.sourcePath}`);
    const row = await this.prisma.seoRedirect.create({
      data: { tenantId: t.id, fromPath: PREFIX + r.key, target: '', manual: true, sourcePath: r.sourcePath, destinationUrl: r.destinationUrl, statusCode: r.statusCode, isActive: r.isActive },
    });
    this.invalidate(t.id);
    await this.audit.record('seo.redirect.create', { tenantId: t.id, actor: u.login, detail: { from: r.sourcePath, to: r.destinationUrl, code: r.statusCode } });
    return view(row as Row);
  }

  /** any of { sourceUrl, destinationUrl, statusCode, isActive } */
  async update(dealerId: string, id: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(dealerId);
    const cur = await this.ruleOr404(t.id, id);
    const r = parseRule(
      {
        source: b.sourceUrl ?? b.sourcePath,
        destination: b.destinationUrl === null ? '' : b.destinationUrl,
        code: b.statusCode,
        active: b.isActive,
      },
      cur,
    );
    if ('error' in r) throw new BadRequestException(r.error);
    const fromPath = PREFIX + r.key;
    if (fromPath !== cur.fromPath) {
      const clash = await this.prisma.seoRedirect.findUnique({ where: { tenantId_fromPath: { tenantId: t.id, fromPath } } });
      if (clash) throw new ConflictException(`There is already a redirect for ${r.sourcePath}`);
    }
    const row = await this.prisma.seoRedirect.update({
      where: { id: cur.id },
      data: { fromPath, sourcePath: r.sourcePath, destinationUrl: r.destinationUrl, statusCode: r.statusCode, isActive: r.isActive },
    });
    this.invalidate(t.id);
    await this.audit.record('seo.redirect.update', { tenantId: t.id, actor: u.login, detail: { id, from: r.sourcePath, to: r.destinationUrl, code: r.statusCode, active: r.isActive } });
    return view(row as Row);
  }

  async remove(dealerId: string, id: string, u: AuthUser) {
    const t = await this.tenantOr404(dealerId);
    const cur = await this.ruleOr404(t.id, id);
    await this.prisma.seoRedirect.delete({ where: { id: cur.id } });
    this.invalidate(t.id);
    await this.audit.record('seo.redirect.delete', { tenantId: t.id, actor: u.login, detail: { from: cur.sourcePath } });
    return { ok: true };
  }

  /** { ids: [...], action: 'activate' | 'deactivate' | 'delete' } */
  async bulk(dealerId: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(dealerId);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map((x) => clean(x, 80)).filter(Boolean))].slice(0, 1000) : [];
    if (!ids.length) throw new BadRequestException('Select at least one redirect');
    const where = { tenantId: t.id, manual: true, id: { in: ids } };
    let count = 0;
    if (b.action === 'delete') count = (await this.prisma.seoRedirect.deleteMany({ where })).count;
    else if (b.action === 'activate' || b.action === 'deactivate') count = (await this.prisma.seoRedirect.updateMany({ where, data: { isActive: b.action === 'activate' } })).count;
    else throw new BadRequestException('Unknown action');
    this.invalidate(t.id);
    await this.audit.record('seo.redirect.bulk', { tenantId: t.id, actor: u.login, detail: { action: b.action, count } });
    return { ok: true, count };
  }

  /**
   * { rows: [{ source_url, destination_url, type, status }], missingDestination?: 'skip' | 'gone' }
   * Adds new rules and updates existing ones (same old URL). missingDestination = 'gone': a row with an old URL only
   * (a plain Search Console export) becomes a 410.
   */
  async import(dealerId: string, b: Record<string, unknown>, u: AuthUser) {
    const t = await this.tenantOr404(dealerId);
    const input = Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]) : [];
    if (!input.length) throw new BadRequestException('The file has no rows');
    if (input.length > MAX_IMPORT) throw new BadRequestException(`At most ${MAX_IMPORT.toLocaleString('en-US')} rows per file — split the file and import it in parts`);
    const gone = b.missingDestination === 'gone';

    const errors: { line: number; source: string; error: string }[] = [];
    const parsed = new Map<string, Parsed>();
    input.forEach((row, i) => {
      const source = String(row?.source_url ?? '').trim();
      const dest = String(row?.destination_url ?? '').trim();
      let type = String(row?.type ?? '').trim();
      if (!type) type = !dest && gone ? '410' : '301';
      const r = parseRule({ source, destination: dest, code: type, active: row?.status ?? '' });
      if ('error' in r) errors.push({ line: Number(row?.line) || i + 2, source: source.slice(0, 200), error: r.error });
      else parsed.set(r.key, r); // a later row for the same URL wins
    });

    const keys = [...parsed.keys()];
    const existing = new Map<string, string>();
    for (let i = 0; i < keys.length; i += 1000) {
      const found: { id: string; fromPath: string }[] = await this.prisma.seoRedirect.findMany({
        where: { tenantId: t.id, fromPath: { in: keys.slice(i, i + 1000).map((k) => PREFIX + k) } },
        select: { id: true, fromPath: true },
      });
      for (const f of found) existing.set(f.fromPath, f.id);
    }
    const now = await this.prisma.seoRedirect.count({ where: { tenantId: t.id, manual: true } });
    const fresh = keys.filter((k) => !existing.has(PREFIX + k));
    if (now + fresh.length > MAX_RULES) throw new BadRequestException(`This would go over ${MAX_RULES.toLocaleString('en-US')} redirects for one dealership`);

    await this.prisma.$transaction(
      async (tx) => {
        if (fresh.length) {
          await tx.seoRedirect.createMany({
            data: fresh.map((k) => {
              const r = parsed.get(k)!;
              return { tenantId: t.id, fromPath: PREFIX + k, target: '', manual: true, sourcePath: r.sourcePath, destinationUrl: r.destinationUrl, statusCode: r.statusCode, isActive: r.isActive };
            }),
            skipDuplicates: true,
          });
        }
        for (const k of keys) {
          const id = existing.get(PREFIX + k);
          if (!id) continue;
          const r = parsed.get(k)!;
          await tx.seoRedirect.update({ where: { id }, data: { manual: true, target: '', sourcePath: r.sourcePath, destinationUrl: r.destinationUrl, statusCode: r.statusCode, isActive: r.isActive } });
        }
      },
      { timeout: 120_000 },
    );
    this.invalidate(t.id);
    const result = { created: fresh.length, updated: keys.length - fresh.length, skipped: errors.length, errors: errors.slice(0, 100) };
    await this.audit.record('seo.redirect.import', { tenantId: t.id, actor: u.login, detail: { created: result.created, updated: result.updated, skipped: result.skipped } });
    return result;
  }

  /** every rule of the dealership as CSV: source_url,destination_url,type,status */
  async exportCsv(dealerId: string): Promise<string> {
    const t = await this.tenantOr404(dealerId);
    const rows = (await this.prisma.seoRedirect.findMany({ where: { tenantId: t.id, manual: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })) as Row[];
    const cell = (v: string) => {
      const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; // never a formula in Excel
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['source_url,destination_url,type,status'];
    for (const r of rows.map(view)) lines.push([r.sourcePath, r.destinationUrl || '', String(r.statusCode), r.isActive ? 'active' : 'inactive'].map(cell).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
}
