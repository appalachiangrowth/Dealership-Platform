import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FeedsService, vehicleExtra } from '../feeds/feeds.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import * as cg from './ingestion.js';
import { cleanMl } from '../common/util.js';
import { testSftpConnection, uploadViaSftp, SftpConnectionOptions } from './sftp.util.js';
import type { AuthUser } from '../common/auth.types.js';
import type { CargurusSubmission } from '../generated/prisma/client.js';

/** CarGurus column → field of the vehicle editor in the Dealership Portal (for "Fix" links). */
export const CG_FORM_FIELD: Record<string, string> = {
  vin: 'vin', make: 'make', model: 'model', year: 'year', trim: 'trim', price: 'price', mileage: 'mileage', images: 'images',
  ext: 'exteriorColor', comments: 'description', stock: 'stockNumber', trans: 'transmission', options: 'features',
};

export type CgIssue = { field: string; column: string; label: string; msg: string };

/** One vehicle's CarGurus problems in plain words (empty = CarGurus ready). */
export function issuesOf(r: cg.CgRecord): CgIssue[] {
  const out: CgIssue[] = [];
  for (const [k, msgs] of Object.entries(r._issues || {})) for (const m of msgs || []) out.push({ field: CG_FORM_FIELD[k] || k, column: k, label: cg.label(k as cg.ColumnKey), msg: m });
  return out;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const keyOf = (vin: string, stock: string) => {
  const v = String(vin || '').toUpperCase().replace(/[\s-]+/g, '');
  if (v) return 'vin:' + v;
  const st = String(stock || '').trim().toLowerCase();
  return st ? 'stock:' + st : '';
};

/**
 * CarGurus ingestion, verification & dispatch pipeline (same flow as the old platform, v2.1).
 * Nothing reaches CarGurus without Platform Admin approval:
 *   every inventory save → the vehicles for sale are checked and, when they changed, staged automatically as a
 *   PENDING submission (afterInventoryChange) · vehicles sold / deleted / hidden leave the LIVE feed at once
 *   Platform Admin audits it → Approve & Sync (writes the live feed and uploads by FTP) or Reject with feedback.
 * The dealer sees a read-only monitor (Dealership Portal › CarGurus feed); vehicles are added and fixed in Inventory.
 */
@Injectable()
export class CargurusService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CarGurus');
  private timer?: NodeJS.Timeout;
  private lastCronDay = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly feeds: FeedsService,
    private readonly tenants: TenantsService,
    private readonly platform: PlatformSettingsService,
  ) {}

  // ───────── helpers ─────────

  private async meta(tenantId: string) {
    const { t, s, site } = await this.feeds.context(tenantId);
    return this.feeds.dealerMeta(t, s, site);
  }

  private summaryOf(sub: CargurusSubmission) {
    const sum = sub.summary as ReturnType<typeof cg.audit>;
    return {
      id: sub.id,
      tenantId: sub.tenantId,
      status: sub.status,
      source: sub.source,
      fileName: sub.fileName,
      createdBy: sub.createdBy,
      createdAt: sub.createdAt,
      reviewedBy: sub.reviewedBy,
      reviewNote: sub.reviewNote,
      reviewedAt: sub.reviewedAt,
      dispatchedAt: sub.dispatchedAt,
      dispatchResult: sub.dispatchResult,
      total: sum?.total ?? 0,
      valid: sum?.valid ?? 0,
      invalid: sum?.invalid ?? 0,
      issues: sum?.issues ?? 0,
      ready: !!sum?.ready,
    };
  }

  /**
   * The batch's vehicles with the dealer's additional inventory columns (header → value).
   * Website / inventory batches made before those columns were added (or without them) get them from the
   * matching vehicle (VIN, then stock number), so the audit page and the master CSV always show them.
   */
  private async recordsWithExtra(tenantId: string, sub: CargurusSubmission): Promise<cg.CgRecord[]> {
    const records = sub.records as unknown as cg.CgRecord[];
    if (sub.source === 'upload') return records;
    // Website / inventory batches: every vehicle also gets its details from the editor (Horsepower, Engine …)
    // and its additional inventory columns, matched by VIN, then stock number. Values already in the batch win.
    const vehicles = await this.prisma.vehicle.findMany({ where: { tenantId } });
    const byVin = new Map<string, Record<string, string>>();
    const byStock = new Map<string, Record<string, string>>();
    for (const v of vehicles) {
      const ex = vehicleExtra(v);
      if (!Object.keys(ex).length) continue;
      if (v.vin) byVin.set(v.vin.toUpperCase(), ex);
      if (v.stockNumber) byStock.set(v.stockNumber.toLowerCase(), ex);
    }
    if (!byVin.size && !byStock.size) return records;
    return records.map((r) => {
      const cur = (r.vin && byVin.get(r.vin.toUpperCase())) || (r.stock && byStock.get(r.stock.toLowerCase())) || undefined;
      if (!cur) return r;
      const merged: Record<string, string> = { ...(r._extra || {}) };
      const have = new Set(Object.keys(merged).map((k) => cg.norm(k)));
      for (const [k, val] of Object.entries(cur)) if (!have.has(cg.norm(k))) merged[k] = val;
      return { ...r, _extra: merged };
    });
  }

  private async log2(tenantId: string, event: string, detail: unknown) {
    await this.prisma.cargurusLog.create({ data: { tenantId, event, detail: detail as never } });
  }

  private async create(tenantId: string, records: cg.CgRecord[], source: string, fileName: string, rawText: string, by: string) {
    const meta = await this.meta(tenantId);
    const summary = cg.audit(records, meta);
    await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'PENDING' }, data: { status: 'REPLACED' } });
    const sub = await this.prisma.cargurusSubmission.create({
      data: { tenantId, source, fileName, records: records as never, summary: summary as never, rawText: rawText.slice(0, 5_000_000), createdBy: by },
    });
    await this.log2(tenantId, 'submission.create', { id: sub.id, source, total: summary.total, invalid: summary.invalid });
    return { submission: this.summaryOf(sub), summary, issues: cg.issueList(records), warnings: cg.warningList(records) };
  }

  // ───────── SFTP Connection Test & Pre-Flight Dry Run ─────────

  async testConnection(
    tenantId?: string,
    body?: { host?: string; port?: number; username?: string; password?: string; passphrase?: string; privateKey?: string },
  ) {
    const s = tenantId ? await this.prisma.tenantSettings.findUnique({ where: { tenantId } }) : null;
    const host = body?.host || s?.cargurusFtpHost || 'ftp.cargurus.com';
    const port = Number(body?.port || s?.cargurusFtpPort || 2122);
    const username = body?.username || s?.cargurusFtpUser || '';
    const password = body?.password || s?.cargurusFtpPass || '';
    const passphrase = body?.passphrase || '';
    const privateKey = body?.privateKey || '';

    if (!username) {
      return {
        success: false,
        reason: 'Username is required to test SFTP connection',
        host,
        port,
      };
    }

    const res = await testSftpConnection({
      host,
      port,
      username,
      password,
      passphrase,
      privateKey,
      timeout: 15000,
    });

    if (tenantId) {
      await this.log2(tenantId, res.success ? 'sftp.test_connection.ok' : 'sftp.test_connection.failed', {
        host,
        port,
        username,
        success: res.success,
        reason: res.reason,
        latencyMs: res.latencyMs,
      });
    }

    return {
      ...res,
      host,
      port,
      username,
    };
  }

  async dryRun(tenantId: string, submissionId?: string) {
    let sub = submissionId
      ? await this.prisma.cargurusSubmission.findFirst({ where: { id: submissionId, tenantId } })
      : await this.prisma.cargurusSubmission.findFirst({ where: { tenantId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });

    if (!sub) {
      sub = await this.prisma.cargurusSubmission.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    }

    if (!sub) {
      throw new NotFoundException('No CarGurus inventory submission found for this dealership');
    }

    const meta = await this.meta(tenantId);
    const records = (sub.records || []) as unknown as cg.CgRecord[];
    const profile = cg.profile(meta);

    let feedCsv = '';
    let csvGenerationError: string | null = null;
    try {
      feedCsv = cg.csv(records, meta, false, true);
    } catch (e: any) {
      csvGenerationError = e?.message || 'CSV feed generation stream failure';
    }

    const flaggedList: { row: number; vin: string; stock: string; name: string; reasons: string[] }[] = [];
    let validCount = 0;
    let blockedCount = 0;

    for (const r of records) {
      const issues = r._issues || {};
      const reasons: string[] = [];
      for (const [col, msgs] of Object.entries(issues)) {
        for (const m of msgs || []) {
          reasons.push(m);
        }
      }

      if (reasons.length > 0) {
        blockedCount++;
        const carName = [r.year || '', r.make || '', r.model || '', r.trim || ''].join(' ').replace(/\s+/g, ' ').trim();
        flaggedList.push({
          row: r._row,
          vin: r.vin || '',
          stock: r.stock || '',
          name: carName || `Car #${r._row}`,
          reasons,
        });
      } else {
        validCount++;
      }
    }

    const payloadSizeBytes = Buffer.byteLength(feedCsv || '', 'utf8');
    const isProfileReady = profile.complete;
    const isFeedReady = !csvGenerationError && blockedCount === 0 && isProfileReady;
    const status: 'READY_TO_SYNC' | 'ACTION_REQUIRED' = isFeedReady ? 'READY_TO_SYNC' : 'ACTION_REQUIRED';

    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const sftpStaging = {
      targetHost: s?.cargurusFtpHost || 'ftp.cargurus.com',
      targetPort: s?.cargurusFtpPort || 2122,
      targetFileName: s?.cargurusRemoteName || 'inventory.csv',
      targetDirectory: s?.cargurusRemoteDir || '/',
      simulatedPayloadSizeBytes: payloadSizeBytes,
      configured: !!(s?.cargurusFtpHost && s?.cargurusFtpUser),
    };

    const report = {
      status,
      summary: {
        totalEvaluated: records.length,
        validCount,
        blockedCount,
        allPassed: blockedCount === 0,
        dealershipProfileComplete: isProfileReady,
        profileIssues: profile.missing.map((m) => m.issue),
      },
      fileGeneration: {
        success: !csvGenerationError,
        error: csvGenerationError,
        format: 'CarGurus 20-Column CSV / Master Specification',
        estimatedSizeBytes: payloadSizeBytes,
        rowsCount: records.length,
      },
      sftpStaging,
      flaggedList,
      timestamp: new Date().toISOString(),
    };

    await this.log2(tenantId, 'sftp.dry_run', {
      submissionId: sub.id,
      status,
      validCount,
      blockedCount,
      sizeBytes: payloadSizeBytes,
    });

    return report;
  }

  // ───────── Dealership Portal: readiness, automatic staging, live feed ─────────

  async cargurusOn(tenantId: string) {
    const t = await this.tenants.get(tenantId);
    if (!(await this.tenants.features(t)).cargurus) return false;
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { feedOperation: true } });
    const op = s?.feedOperation;
    if (op && typeof op === 'string') {
      const activePlatforms = op.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
      return activePlatforms.includes('cargurus');
    }
    return true;
  }

  private async liveSub(tenantId: string) {
    return this.prisma.cargurusSubmission.findFirst({ where: { tenantId, status: 'APPROVED' }, orderBy: { reviewedAt: 'desc' } });
  }

  /** VIN / stock keys and row count of a feed CSV. */
  private feedKeys(csvText: string | null | undefined) {
    const vins = new Set<string>();
    if (!csvText) return { vins, rows: 0 };
    const [h, rows] = cg.parse(csvText);
    const iv = h.indexOf('VIN');
    for (const r of rows) if (iv > -1 && r[iv]) vins.add(r[iv].toUpperCase());
    return { vins, rows: rows.length };
  }

  /** Every vehicle for sale checked against the CarGurus rules: vehicle id → issues ([] = ready). */
  async readiness(tenantId: string) {
    const { records, vehicles } = await this.feeds.cargurusFromInventory(tenantId);
    const map = new Map<string, CgIssue[]>();
    records.forEach((r, i) => map.set(vehicles[i].id, issuesOf(r)));
    return map;
  }

  /** Dealership Portal › CarGurus feed (read only): ready / needs attention / live / last feed sent. */
  async monitor(tenantId: string) {
    if (!(await this.cargurusOn(tenantId))) {
      throw new ForbiddenException({ message: 'CarGurus is not switched on for your dealership. Contact the platform team.', code: 'cargurus_off' });
    }
    const { records, vehicles, meta } = await this.feeds.cargurusFromInventory(tenantId);
    const { site } = await this.feeds.context(tenantId);
    const live = await this.liveSub(tenantId);
    const lk = this.feedKeys(live?.feedCsv);
    const ready: unknown[] = [];
    const attention: unknown[] = [];
    records.forEach((r, i) => {
      const v = vehicles[i];
      const base = {
        id: v.id,
        name: [r.year || '', r.make, r.model, r.trim].join(' ').replace(/\s+/g, ' ').trim(),
        vin: r.vin,
        stock: r.stock,
        price: r.price !== null && r.price !== undefined ? Number(r.price) : (v.price !== null ? Number(v.price) : null),
        mileage: v.mileage,
        photos: v.images.length,
        image: v.images[0] || '',
      };
      const iss = issuesOf(r);
      if (!iss.length) ready.push({ ...base, live: !!r.vin && lk.vins.has(r.vin.toUpperCase()) });
      else attention.push({ ...base, issues: iss });
    });
    const pending = await this.prisma.cargurusSubmission.findFirst({ where: { tenantId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    const pr = cg.profile(meta);
    return {
      ready,
      attention,
      liveCount: lk.rows,
      approved: live ? { at: live.reviewedAt, vehicles: lk.rows, by: live.reviewedBy } : null,
      lastSync: live?.dispatchResult ?? null,
      pending: pending ? { id: pending.id, at: pending.createdAt, vehicles: (pending.summary as { total?: number })?.total ?? 0 } : null,
      dealer: meta,
      dealerWarnings: pr.missing.map((m) => m.issue),
      xmlUrl: `${site}/inventory.xml`,
    };
  }

  /**
   * After every inventory change (add / edit / publish / sold / delete / import), like the old inventory.php:
   *  1. vehicles that are no longer for sale leave the LIVE feed at once (only removing, never adding)
   *  2. when the vehicles for sale changed, they are staged automatically for Platform Admin verification.
   * Never throws: a CarGurus problem must not block saving a vehicle.
   */
  async afterInventoryChange(tenantId: string, by: string) {
    try {
      await this.pruneLive(tenantId);
      if (await this.cargurusOn(tenantId)) await this.autosubmit(tenantId, by);
    } catch (e) {
      this.log.warn(`after inventory change ${tenantId}: ${(e as Error).message}`);
    }
  }

  /** pa_cg_autosubmit */
  async autosubmit(tenantId: string, by: string) {
    const { records, meta } = await this.feeds.cargurusFromInventory(tenantId);
    const last = await this.prisma.cargurusLog.findFirst({ where: { tenantId, event: 'auto.hash' }, orderBy: { createdAt: 'desc' } });
    const lastHash = (last?.detail as { hash?: string } | null)?.hash ?? null;
    if (!records.length) {
      // nothing for sale any more: withdraw the waiting batch
      await this.prisma.cargurusSubmission.updateMany({
        where: { tenantId, status: 'PENDING' },
        data: { status: 'REPLACED', reviewedBy: 'system', reviewNote: 'No vehicles for sale any more.', reviewedAt: new Date() },
      });
      if (lastHash) await this.log2(tenantId, 'auto.hash', { hash: '' });
      return null;
    }
    // every vehicle for sale: adding, editing or deleting a car refreshes the waiting batch
    const hash = createHash('md5').update(cg.csv(records, meta, false, true)).digest('hex');
    if (hash === lastHash) return null;
    const res = await this.create(tenantId, records, 'website', 'Website inventory (automatic)', '', by);
    await this.log2(tenantId, 'auto.hash', { hash, id: res.submission.id });
    return res;
  }

  /** pa_cg_prune_live: vehicles deleted, sold, hidden or switched off for CarGurus leave the live CarGurus feed straight away. */
  async pruneLive(tenantId: string) {
    const live = await this.liveSub(tenantId);
    if (!live?.feedCsv) return 0;
    const forSale = await this.prisma.vehicle.findMany({ where: { tenantId, status: 'PUBLISHED', syndicateCargurus: true }, select: { vin: true, stockNumber: true } });
    const keys = new Set<string>();
    for (const v of forSale) for (const k of [keyOf(v.vin, ''), keyOf('', v.stockNumber)]) if (k) keys.add(k);
    const [h, rows] = cg.parse(live.feedCsv);
    const iv = h.indexOf('VIN');
    const is = h.indexOf('Stock Number');
    const keep = rows.filter((r) => {
      const kv = keyOf(iv > -1 ? r[iv] : '', '');
      const ks = keyOf('', is > -1 ? r[is] : '');
      return (kv !== '' && keys.has(kv)) || (ks !== '' && keys.has(ks));
    });
    const gone = rows.length - keep.length;
    if (!gone) return 0;
    const feedCsv = [h, ...keep].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
    await this.prisma.cargurusSubmission.update({ where: { id: live.id }, data: { feedCsv } });
    await this.log2(tenantId, 'live_pruned', { removed: gone, left: keep.length });
    await this.audit.record('cargurus.live_pruned', { tenantId, actor: 'system', detail: { removed: gone, left: keep.length } });
    await this.dispatch(tenantId, 'vehicles removed from inventory'); // tell CarGurus now, not at the next scheduled upload
    return gone;
  }

  // ───────── dealer (file upload — kept for the API, the portal now stages the inventory automatically) ─────────

  template() {
    return cg.vehicleTemplate().join(',') + '\n';
  }

  async upload(tenantId: string, text: string, fileName: string, user: AuthUser) {
    const [headers, rows] = cg.parse(text);
    if (!headers.length) throw new BadRequestException('The file is empty');
    if (rows.length > cg.MAX_ROWS) throw new BadRequestException(`The file has more than ${cg.MAX_ROWS} vehicles`);
    const { map, missing, found } = cg.mapHeaders(headers);
    if (missing.length) {
      throw new BadRequestException({ message: `The file is missing these required columns: ${missing.join(', ')}. Nothing was saved.`, missing, found });
    }
    const records = cg.ingestRows(headers, rows, map);
    // additional columns of the file (not a CarGurus vehicle column, not a dealer column) go to the master CSV
    const used = new Set(Object.values(map));
    const extraCols = headers.map((h, i) => [h, i] as const).filter(([h, i]) => h.trim() && !used.has(i) && !cg.DEALER_COLUMN_NORMS.has(cg.norm(h)));
    if (extraCols.length) for (const r of records) r._extra = Object.fromEntries(extraCols.map(([h, i]) => [h, rows[r._row - 2]?.[i] ?? '']));
    const res = await this.create(tenantId, records, 'upload', fileName.slice(0, 200), text, user.login);
    await this.audit.record('cargurus.upload', { tenantId, actor: user.login, detail: { total: records.length } });
    return { ...res, found };
  }

  async submitInventory(tenantId: string, user: AuthUser) {
    const { records } = await this.feeds.cargurusFromInventory(tenantId);
    if (!records.length) throw new BadRequestException('There are no published vehicles to send');
    const res = await this.create(tenantId, records, 'inventory', 'Website inventory', '', user.login);
    await this.audit.record('cargurus.submit_inventory', { tenantId, actor: user.login, detail: { total: records.length } });
    return res;
  }

  async listForDealer(tenantId: string) {
    const subs = await this.prisma.cargurusSubmission.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    const live = subs.find((s) => s.status === 'APPROVED');
    return {
      submissions: subs.map((s) => this.summaryOf(s)),
      live: live ? this.summaryOf(live) : null,
      profile: cg.profile(await this.meta(tenantId)),
      columns: cg.columnsInfo(),
    };
  }

  async getForDealer(tenantId: string, id: string) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new NotFoundException('Submission not found');
    const records = sub.records as unknown as cg.CgRecord[];
    return { submission: this.summaryOf(sub), summary: sub.summary, issues: cg.issueList(records), warnings: cg.warningList(records) };
  }

  // ───────── Platform Admin ─────────

  async listAll(status?: string) {
    const st = (status || '').toUpperCase();
    const subs = await this.prisma.cargurusSubmission.findMany({
      where: ['PENDING', 'APPROVED', 'REJECTED', 'REPLACED'].includes(st) ? { status: st as never } : { status: { not: 'REPLACED' } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { tenant: { select: { name: true, dealerCode: true } } },
    });
    return subs.map((s) => ({ ...this.summaryOf(s), tenantName: s.tenant.name, dealerCode: s.tenant.dealerCode }));
  }

  async audit_(tenantId: string, id: string) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { id, tenantId }, include: { tenant: { select: { name: true, dealerCode: true } } } });
    if (!sub) throw new NotFoundException('Submission not found');
    const meta = await this.meta(tenantId);
    const records = await this.recordsWithExtra(tenantId, sub);
    const extraColumns = cg.extraHeaders(records);
    const dealerIssues = cg.dealerIssues(meta);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    return {
      submission: { ...this.summaryOf(sub), tenantName: sub.tenant.name, dealerCode: sub.tenant.dealerCode },
      summary: cg.audit(records, meta),
      columns: cg.columnsInfo(),
      /** the dealer's additional inventory columns, shown after the 20 CarGurus columns (same order as the master CSV) */
      extraColumns,
      dealer: meta,
      dealerIssues,
      sftpSettings: {
        host: s?.cargurusFtpHost || 'ftp.cargurus.com',
        port: s?.cargurusFtpPort || 2122,
        username: s?.cargurusFtpUser || '',
        hasPassword: !!s?.cargurusFtpPass,
        remoteDir: s?.cargurusRemoteDir || '',
        remoteName: s?.cargurusRemoteName || 'inventory.csv',
      },
      rows: records.map((r) => ({
        row: r._row,
        valid: cg.recordValid(r),
        values: cg.exportValues(r, meta),
        extra: extraColumns.map((h) => {
          const ex = r._extra || {};
          if (ex[h] !== undefined) return String(ex[h] ?? '');
          const hit = Object.entries(ex).find(([k]) => cg.norm(k) === cg.norm(h));
          return hit ? String(hit[1] ?? '') : '';
        }),
        raw: r._raw,
        issues: { ...r._issues, ...dealerIssues },
        warnings: r._warn,
      })),
    };
  }

  async masterCsv(tenantId: string, id: string) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new NotFoundException('Submission not found');
    // the 20 CarGurus columns + every additional column of the dealer's file, at the end
    return cg.csv(await this.recordsWithExtra(tenantId, sub), await this.meta(tenantId), false, true);
  }

  async approve(tenantId: string, id: string, b: { includeInvalid?: boolean; note?: string }, user: AuthUser) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new NotFoundException('Submission not found');
    if (sub.status !== 'PENDING') throw new BadRequestException('Only pending uploads can be approved');
    const meta = await this.meta(tenantId);
    const pr = cg.profile(meta);
    if (!pr.complete) throw new BadRequestException({ message: 'The dealership profile is incomplete', missing: pr.missing });
    const records = sub.records as unknown as cg.CgRecord[];
    const feedCsv = cg.csv(records, meta, !b.includeInvalid);
    const sent = records.filter((r) => b.includeInvalid || cg.recordValid(r)).length;
    await this.prisma.cargurusSubmission.update({
      where: { id },
      data: { status: 'APPROVED', reviewedBy: user.login, reviewNote: cleanMl(b.note, 1000), reviewedAt: new Date(), feedCsv },
    });
    await this.audit.record('cargurus.approve_sync', { tenantId, actor: user.login, detail: { id, vehicles: sent } });
    await this.log2(tenantId, 'approve', { id, by: user.login, vehicles: sent });
    const dispatch = await this.dispatch(tenantId, 'approve');
    return { ok: true, vehicles: sent, dispatch };
  }

  async reject(tenantId: string, id: string, b: { note?: string }, user: AuthUser) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new NotFoundException('Submission not found');
    if (sub.status !== 'PENDING') throw new BadRequestException('Only pending uploads can be rejected');
    const note = cleanMl(b.note, 2000);
    if (!note) throw new BadRequestException('Tell the dealer what to fix');
    await this.prisma.cargurusSubmission.update({ where: { id }, data: { status: 'REJECTED', reviewedBy: user.login, reviewNote: note, reviewedAt: new Date() } });
    await this.audit.record('cargurus.reject', { tenantId, actor: user.login, detail: { id } });
    await this.log2(tenantId, 'reject', { id, by: user.login, note });
    return { ok: true };
  }

  /** The approved feed that is sent / served to CarGurus. */
  async liveFeed(tenantId: string) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { tenantId, status: 'APPROVED' }, orderBy: { reviewedAt: 'desc' } });
    // feeds approved before the fee wording was removed: clean the comments on the way out (prices unchanged)
    return cg.scrubFeedCsv(sub?.feedCsv ?? null);
  }

  /** Uploads the live feed to the dealer's CarGurus FTP (when set). Used by Approve, Re-send and the daily job. */
  async dispatch(tenantId: string, trigger: string) {
    const csv = await this.liveFeed(tenantId);
    if (!csv) return { sent: false, reason: 'No approved feed yet' };
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!s?.cargurusFtpHost || !s.cargurusFtpUser || !s.cargurusFtpPass) {
      const r = { sent: false, status: 'not_configured', reason: 'CarGurus FTP is not set up for this dealership (feed approved, waiting for FTP details)', at: new Date().toISOString(), trigger };
      await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { dispatchResult: r } });
      await this.log2(tenantId, 'dispatch.skipped', r);
      return r;
    }
    const isSftp = s.cargurusFtpPort === 2122 || (s.cargurusFtpHost && s.cargurusFtpHost.includes('cargurus.com'));
    if (isSftp) {
      try {
        const sftpRes = await uploadViaSftp(
          {
            host: s.cargurusFtpHost,
            port: s.cargurusFtpPort || 2122,
            username: s.cargurusFtpUser,
            password: s.cargurusFtpPass,
            timeout: 30000,
          },
          s.cargurusRemoteName || 'inventory.csv',
          csv,
          s.cargurusRemoteDir || undefined,
        );
        const r = { sent: true, status: 'uploaded', at: new Date().toISOString(), bytes: sftpRes.bytes, trigger, protocol: 'sftp' };
        await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { dispatchedAt: new Date(), dispatchResult: r } });
        await this.log2(tenantId, 'dispatch.ok', r);
        return r;
      } catch (e) {
        const r = { sent: false, status: 'failed', reason: (e as Error).message, at: new Date().toISOString(), trigger, protocol: 'sftp' };
        await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { dispatchResult: r } });
        await this.log2(tenantId, 'dispatch.failed', r);
        this.log.warn(`dispatch SFTP ${tenantId} failed: ${r.reason}`);
        return r;
      }
    }

    const client = new FtpClient(30_000);
    try {
      await client.access({
        host: s.cargurusFtpHost,
        port: s.cargurusFtpPort || 21,
        user: s.cargurusFtpUser,
        password: s.cargurusFtpPass,
        secure: s.cargurusFtpSsl,
      });
      if (s.cargurusRemoteDir) await client.ensureDir(s.cargurusRemoteDir);
      await client.uploadFrom(Readable.from([Buffer.from(csv, 'utf8')]), s.cargurusRemoteName || 'inventory.csv');
      const r = { sent: true, status: 'uploaded', at: new Date().toISOString(), bytes: csv.length, trigger };
      await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { dispatchedAt: new Date(), dispatchResult: r } });
      await this.log2(tenantId, 'dispatch.ok', r);
      return r;
    } catch (e) {
      const r = { sent: false, status: 'failed', reason: (e as Error).message, at: new Date().toISOString(), trigger };
      await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { dispatchResult: r } });
      await this.log2(tenantId, 'dispatch.failed', r);
      this.log.warn(`dispatch ${tenantId} failed: ${r.reason}`);
      return r;
    } finally {
      client.close();
    }
  }

  async resend(tenantId: string, user: AuthUser) {
    const r = await this.dispatch(tenantId, 'resend');
    await this.audit.record('cargurus.resend', { tenantId, actor: user.login, detail: r });
    return r;
  }

  logs(tenantId: string) {
    return this.prisma.cargurusLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  // ───────── daily upload job (replaces cron/cargurus-upload.php) ─────────

  onModuleInit() {
    const hour = process.env.CARGURUS_CRON_HOUR;
    if (hour === undefined || hour === '') return;
    this.timer = setInterval(() => void this.tick(Number(hour)), 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(hour: number) {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() !== hour || this.lastCronDay === day) return;
    this.lastCronDay = day;
    await this.runAll();
  }

  async runAll() {
    if (!(await this.platform.get('feeds', 'cargurusCron', true))) return { skipped: 'paused in Platform settings' };
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', settings: { cargurusFtpHost: { not: '' } }, cargurusSubmission: { some: { status: 'APPROVED' } } },
    });
    const results: Record<string, unknown> = {};
    for (const t of tenants) {
      if (!(await this.cargurusOn(t.id))) continue;
      results[t.id] = await this.dispatch(t.id, 'cron');
    }
    return results;
  }
}
