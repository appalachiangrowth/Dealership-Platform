import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { FeedsService } from '../feeds/feeds.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import * as cg from './ingestion.js';
import { cleanMl } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';
import type { CargurusSubmission } from '../generated/prisma/client.js';

/**
 * CarGurus ingestion, verification & dispatch pipeline.
 * Nothing reaches CarGurus without Platform Admin approval:
 *   dealer uploads a file (or submits the website inventory) → PENDING submission
 *   Platform Admin audits it → Approve & Sync (writes the live feed and uploads by FTP) or Reject with feedback.
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

  // ───────── dealer ─────────

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
    const records = sub.records as unknown as cg.CgRecord[];
    const dealerIssues = cg.dealerIssues(meta);
    return {
      submission: { ...this.summaryOf(sub), tenantName: sub.tenant.name, dealerCode: sub.tenant.dealerCode },
      summary: cg.audit(records, meta),
      columns: cg.columnsInfo(),
      dealer: meta,
      dealerIssues,
      rows: records.map((r) => ({
        row: r._row,
        valid: cg.recordValid(r),
        values: cg.exportValues(r, meta),
        raw: r._raw,
        issues: { ...r._issues, ...dealerIssues },
        warnings: r._warn,
      })),
    };
  }

  async masterCsv(tenantId: string, id: string) {
    const sub = await this.prisma.cargurusSubmission.findFirst({ where: { id, tenantId } });
    if (!sub) throw new NotFoundException('Submission not found');
    return cg.csv(sub.records as unknown as cg.CgRecord[], await this.meta(tenantId), false);
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
    return sub?.feedCsv ?? null;
  }

  /** Uploads the live feed to the dealer's CarGurus FTP (when set). Used by Approve, Re-send and the daily job. */
  async dispatch(tenantId: string, trigger: string) {
    const csv = await this.liveFeed(tenantId);
    if (!csv) return { sent: false, reason: 'No approved feed yet' };
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!s?.cargurusFtpHost || !s.cargurusFtpUser || !s.cargurusFtpPass) {
      const r = { sent: false, reason: 'CarGurus FTP is not set up for this dealership (feed approved, waiting for FTP details)' };
      await this.log2(tenantId, 'dispatch.skipped', { trigger, ...r });
      return r;
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
      const r = { sent: true, at: new Date().toISOString(), bytes: csv.length, trigger };
      await this.prisma.cargurusSubmission.updateMany({ where: { tenantId, status: 'APPROVED' }, data: { dispatchedAt: new Date(), dispatchResult: r } });
      await this.log2(tenantId, 'dispatch.ok', r);
      return r;
    } catch (e) {
      const r = { sent: false, reason: (e as Error).message, trigger };
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
      if (!(await this.tenants.features(t)).cargurus) continue;
      results[t.id] = await this.dispatch(t.id, 'cron');
    }
    return results;
  }
}
