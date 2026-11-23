import { HttpException, HttpStatus, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { clean, rateLimit } from '../common/util.js';
import { Prisma } from '../generated/prisma/client.js';
import { CLIENT_EVENTS, EVENT_TYPES, clampInt, cleanVisitorId, deviceOf, isBot, summarize, timeline, type ActivityRow, type ActivitySummary } from './activity.util.js';

/** one event as the storefront tracker sends it */
export interface TrackEventInput {
  eventType?: string;
  type?: string;
  vehicleId?: string;
  vehicleTitle?: string;
  pagePath?: string;
  path?: string;
  scrollDepth?: number;
  durationSec?: number;
}

export interface TrackInput extends TrackEventInput {
  dealerSlug?: string;
  visitorId?: string;
  events?: TrackEventInput[];
}

/** request facts the controller passes on (nothing here blocks: no IP look-ups, only headers already present) */
export interface TrackMeta {
  host: string;
  ip: string;
  userAgent: string;
  city: string;
  region: string;
}

const MAX_EVENTS = 50;
const HOST_TTL = 60_000;
/** visitor activity older than this is deleted every night (VISITOR_ACTIVITY_DAYS, default 180) */
const KEEP_DAYS = Math.max(7, Number(process.env.VISITOR_ACTIVITY_DAYS) || 180);

const ROW_SELECT = {
  eventType: true, vehicleId: true, vehicleTitle: true, pagePath: true, scrollDepth: true, durationSec: true, deviceType: true, city: true, region: true, createdAt: true,
} as const;

@Injectable()
export class ActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('VisitorActivity');
  /** host → dealership id (null = unknown site), kept a minute: the tracker calls often */
  private hosts = new Map<string, { at: number; id: string | null }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
  ) {}

  onModuleInit() {
    // once a day: forget visitor activity past the retention period (the table only grows otherwise)
    this.timer = setInterval(() => void this.prune(), 24 * 3600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async prune() {
    try {
      const r = await this.prisma.visitorActivity.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86400_000) } } });
      if (r.count) this.log.log(`Removed ${r.count} visitor events older than ${KEEP_DAYS} days`);
    } catch (e) {
      this.log.warn(`Prune failed: ${(e as Error).message}`);
    }
  }

  /** the dealership of a website host, or of the dealer slug the tracker sent (null = unknown / suspended: ignored) */
  private async tenantFor(host: string, slug: string): Promise<string | null> {
    const key = `${host}|${slug}`;
    const hit = this.hosts.get(key);
    if (hit && Date.now() - hit.at < HOST_TTL) return hit.id;
    let t = host ? await this.tenants.resolveHost(host).catch(() => null) : null;
    if (!t && slug && /^[a-z0-9][a-z0-9-]{1,39}$/.test(slug)) t = await this.prisma.tenant.findUnique({ where: { id: slug } });
    const id = t && t.status !== 'SUSPENDED' ? t.id : null;
    if (this.hosts.size > 2000) this.hosts.clear();
    this.hosts.set(key, { at: Date.now(), id });
    return id;
  }

  /** POST /public/track — single or batched events from the storefront tracker */
  async track(b: TrackInput, m: TrackMeta) {
    const visitorId = cleanVisitorId(b?.visitorId);
    if (!visitorId) return { ok: true, stored: 0 };
    const ua = clean(m.userAgent, 400);
    if (isBot(ua)) return { ok: true, stored: 0 };
    if (!rateLimit(`track|ip|${m.ip}`, 300, 60) || !rateLimit(`track|v|${visitorId}`, 120, 60)) {
      throw new HttpException('Too many events', HttpStatus.TOO_MANY_REQUESTS);
    }
    const tenantId = await this.tenantFor(clean(m.host, 253), clean(b.dealerSlug, 40).toLowerCase());
    if (!tenantId) return { ok: true, stored: 0 };

    const raw = Array.isArray(b.events) ? b.events : b.eventType || b.type ? [b] : [];
    const allowed = new Set<string>(CLIENT_EVENTS);
    const events = raw
      .slice(0, MAX_EVENTS)
      .map((e) => ({
        eventType: clean(e?.eventType || e?.type, 32).toUpperCase(),
        vehicleId: clean(e?.vehicleId, 120) || null,
        vehicleTitle: clean(e?.vehicleTitle, 160) || null,
        pagePath: clean(e?.pagePath || e?.path, 300) || null,
        scrollDepth: clampInt(e?.scrollDepth, 0, 100),
        durationSec: clampInt(e?.durationSec, 0, 6 * 3600),
      }))
      .filter((e) => allowed.has(e.eventType));
    if (!events.length) return { ok: true, stored: 0 };

    // vehicle id / slug / old id from the design → the vehicle's own id and its real title
    const refs = [...new Set(events.map((e) => e.vehicleId).filter((x): x is string => !!x))];
    const byRef = new Map<string, { id: string; title: string }>();
    if (refs.length) {
      const vs = await this.prisma.vehicle.findMany({
        where: { tenantId, OR: [{ id: { in: refs } }, { slug: { in: refs } }, { legacyId: { in: refs } }] },
        select: { id: true, slug: true, legacyId: true, title: true, year: true, make: true, model: true, trim: true },
      });
      for (const v of vs) {
        const title = v.title || [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
        for (const k of [v.id, v.slug, v.legacyId]) if (k) byRef.set(k, { id: v.id, title });
      }
    }

    // a visitor who already sent an inquiry: new activity belongs to that lead straight away
    const lead = await this.prisma.lead.findFirst({ where: { tenantId, visitorId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const device = deviceOf(ua);
    const city = clean(m.city, 80) || null;
    const region = clean(m.region, 80) || null;
    const data: Prisma.VisitorActivityCreateManyInput[] = events.map((e) => {
      const v = e.vehicleId ? byRef.get(e.vehicleId) : undefined;
      return {
        tenantId, visitorId, leadId: lead?.id ?? null, eventType: e.eventType,
        vehicleId: v?.id ?? e.vehicleId, vehicleTitle: v?.title || e.vehicleTitle,
        pagePath: e.pagePath, scrollDepth: e.scrollDepth, durationSec: e.durationSec,
        city, region, userAgent: ua || null, deviceType: device,
      };
    });
    await this.prisma.visitorActivity.createMany({ data });
    return { ok: true, stored: data.length };
  }

  /**
   * A new inquiry from a known visitor: earlier anonymous activity of that visitor (same dealership) becomes part of
   * the lead, and the inquiry itself is added to the journey. Never throws (the inquiry is already saved).
   */
  async onLeadCreated(tenantId: string, leadId: string, visitorIdRaw: string, o: { pagePath?: string; vehicleId?: string | null; vehicleTitle?: string; userAgent?: string }) {
    const visitorId = cleanVisitorId(visitorIdRaw);
    if (!visitorId) return;
    try {
      await this.prisma.visitorActivity.updateMany({ where: { tenantId, visitorId, leadId: null }, data: { leadId } });
      const ua = clean(o.userAgent, 400);
      await this.prisma.visitorActivity.create({
        data: {
          tenantId, visitorId, leadId, eventType: 'LEAD_SUBMITTED',
          vehicleId: o.vehicleId || null, vehicleTitle: clean(o.vehicleTitle, 160) || null, pagePath: pathOf(o.pagePath),
          userAgent: ua || null, deviceType: ua ? deviceOf(ua) : null,
        },
      });
    } catch (e) {
      this.log.warn(`Could not link visitor activity to lead ${leadId}: ${(e as Error).message}`);
    }
  }

  /** every event of a lead: linked rows + any row of its visitor id */
  private async leadRows(tenantId: string, leadId: string, visitorId: string | null) {
    const or: Prisma.VisitorActivityWhereInput[] = [{ leadId }];
    if (visitorId) or.push({ visitorId });
    return this.prisma.visitorActivity.findMany({ where: { tenantId, OR: or }, orderBy: { createdAt: 'asc' }, take: 2000, select: ROW_SELECT });
  }

  /** GET /dealer/leads/:id/activity — only the dealership's own lead */
  async leadActivity(tenantId: string, leadId: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true, visitorId: true } });
    if (!lead) throw new NotFoundException('Inquiry not found');
    const rows = await this.leadRows(tenantId, lead.id, lead.visitorId);
    return { leadId: lead.id, visitorId: lead.visitorId, hasActivity: rows.length > 0, summary: summarize(rows), timeline: timeline(rows) };
  }

  /** short summaries for a page of leads (Leads list badges): leadId → summary (leads without activity are left out) */
  async summariesFor(tenantId: string, leads: { id: string; visitorId: string | null }[]): Promise<Record<string, ActivitySummary>> {
    const ids = leads.map((l) => l.id);
    const visitors = [...new Set(leads.map((l) => l.visitorId).filter((v): v is string => !!v))];
    if (!ids.length) return {};
    const rows = await this.prisma.visitorActivity.findMany({
      where: { tenantId, OR: [{ leadId: { in: ids } }, ...(visitors.length ? [{ visitorId: { in: visitors } }] : [])] },
      select: { ...ROW_SELECT, leadId: true, visitorId: true },
      take: 20000,
    });
    const byVisitor = new Map(leads.filter((l) => l.visitorId).map((l) => [l.visitorId!, l.id]));
    const groups = new Map<string, ActivityRow[]>();
    for (const r of rows) {
      const id = (r.leadId && ids.includes(r.leadId) ? r.leadId : null) || byVisitor.get(r.visitorId);
      if (!id) continue;
      (groups.get(id) || groups.set(id, []).get(id)!).push(r);
    }
    const out: Record<string, ActivitySummary> = {};
    for (const [id, list] of groups) out[id] = summarize(list);
    return out;
  }

  /* ───────────────────────── Platform Admin ───────────────────────── */

  private feedWhere(q: { tenantId?: string; eventType?: string; linked?: string }) {
    const where: Prisma.VisitorActivityWhereInput = {};
    if (q.tenantId) where.tenantId = clean(q.tenantId, 40);
    const et = clean(q.eventType, 32).toUpperCase();
    if ((EVENT_TYPES as readonly string[]).includes(et)) where.eventType = et;
    if (q.linked === 'lead') where.leadId = { not: null };
    if (q.linked === 'anonymous') where.leadId = null;
    return where;
  }

  /** GET /platform/visitors/feed — live activity stream across all dealerships */
  async feed(q: { tenantId?: string; eventType?: string; linked?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(q.pageSize || '25', 10) || 25));
    const where = this.feedWhere(q);
    const [items, total] = await Promise.all([
      this.prisma.visitorActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, tenantId: true, visitorId: true, leadId: true, eventType: true, vehicleId: true, vehicleTitle: true, pagePath: true,
          scrollDepth: true, durationSec: true, city: true, region: true, deviceType: true, createdAt: true,
          tenant: { select: { name: true } },
          lead: { select: { id: true, name: true } },
        },
      }),
      this.prisma.visitorActivity.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** GET /platform/visitors/overview — platform-wide numbers, per-dealership comparison, top vehicles, latest events */
  async overview(q: { tenantId?: string; days?: string; eventType?: string }) {
    const days = [1, 7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 7;
    const tenantId = clean(q.tenantId, 40);
    const now = Date.now();
    const since = (d: number) => new Date(now - d * 86400_000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const t = tenantId ? Prisma.sql`AND "tenantId" = ${tenantId}` : Prisma.empty;
    const tw: Prisma.VisitorActivityWhereInput = tenantId ? { tenantId } : {};
    const lw: Prisma.LeadWhereInput = tenantId ? { tenantId } : {};
    const range = since(days);

    const [counts, visitors, perDealer, topVehicles, leadsByDealer, identified, tenants, feed] = await Promise.all([
      Promise.all([
        this.prisma.visitorActivity.count({ where: { ...tw, createdAt: { gte: startOfToday } } }),
        this.prisma.visitorActivity.count({ where: { ...tw, createdAt: { gte: since(7) } } }),
        this.prisma.visitorActivity.count({ where: { ...tw, createdAt: { gte: since(30) } } }),
      ]),
      this.prisma.$queryRaw<{ h24: number; d7: number; d30: number; in_range: number; vdp: number; whatsapp: number; calls: number }[]>`
        SELECT
          COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= ${since(1)})::int AS h24,
          COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= ${since(7)})::int AS d7,
          COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= ${since(30)})::int AS d30,
          COUNT(DISTINCT "visitorId") FILTER (WHERE "createdAt" >= ${range})::int AS in_range,
          COUNT(*) FILTER (WHERE "eventType" = 'VIEW_VDP' AND "createdAt" >= ${range})::int AS vdp,
          COUNT(*) FILTER (WHERE "eventType" = 'WHATSAPP_CLICK' AND "createdAt" >= ${range})::int AS whatsapp,
          COUNT(*) FILTER (WHERE "eventType" = 'CALL_CLICK' AND "createdAt" >= ${range})::int AS calls
        FROM "VisitorActivity"
        WHERE "createdAt" >= ${since(Math.max(30, days))} ${t}`,
      this.prisma.$queryRaw<{ tenantId: string; visitors: number; views: number; vdp: number; contacts: number; lastActive: Date }[]>`
        SELECT "tenantId",
          COUNT(DISTINCT "visitorId")::int AS visitors,
          COUNT(*) FILTER (WHERE "eventType" IN ('PAGE_VIEW', 'VIEW_VDP'))::int AS views,
          COUNT(*) FILTER (WHERE "eventType" = 'VIEW_VDP')::int AS vdp,
          COUNT(*) FILTER (WHERE "eventType" IN ('WHATSAPP_CLICK', 'CALL_CLICK'))::int AS contacts,
          MAX("createdAt") AS "lastActive"
        FROM "VisitorActivity"
        WHERE "createdAt" >= ${range} ${t}
        GROUP BY "tenantId"`,
      this.prisma.$queryRaw<{ tenantId: string; vehicleId: string; title: string | null; views: number; visitors: number }[]>`
        SELECT "tenantId", "vehicleId", MAX("vehicleTitle") AS title, COUNT(*)::int AS views, COUNT(DISTINCT "visitorId")::int AS visitors
        FROM "VisitorActivity"
        WHERE "eventType" = 'VIEW_VDP' AND "vehicleId" IS NOT NULL AND "createdAt" >= ${range} ${t}
        GROUP BY "tenantId", "vehicleId"
        ORDER BY views DESC
        LIMIT 10`,
      this.prisma.lead.groupBy({ by: ['tenantId'], where: { ...lw, createdAt: { gte: range } }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['tenantId'], where: { ...lw, createdAt: { gte: range }, visitorId: { not: null } }, _count: { _all: true } }),
      this.prisma.tenant.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: 'asc' } }),
      this.feed({ tenantId, eventType: q.eventType, page: '1', pageSize: '25' }),
    ]);

    const v = visitors[0] || { h24: 0, d7: 0, d30: 0, in_range: 0, vdp: 0, whatsapp: 0, calls: 0 };
    const names = new Map(tenants.map((x) => [x.id, x.name]));
    const leadsOf = new Map(leadsByDealer.map((x) => [x.tenantId, x._count._all]));
    const idOf = new Map(identified.map((x) => [x.tenantId, x._count._all]));
    const identifiedLeads = [...idOf.values()].reduce((a, b) => a + b, 0);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

    const seen = new Set(perDealer.map((d) => d.tenantId));
    const dealers = [
      ...perDealer.map((d) => ({
        tenantId: d.tenantId, dealerSlug: d.tenantId, name: names.get(d.tenantId) || d.tenantId,
        visitors: d.visitors, views: d.views, vdpViews: d.vdp, contactClicks: d.contacts,
        leads: leadsOf.get(d.tenantId) || 0, identifiedLeads: idOf.get(d.tenantId) || 0,
        conversion: pct(idOf.get(d.tenantId) || 0, d.visitors), lastActive: d.lastActive,
      })),
      // dealerships with inquiries but no tracked visits in the period (e.g. tracker not live yet)
      ...[...leadsOf.keys()].filter((id) => !seen.has(id)).map((id) => ({
        tenantId: id, dealerSlug: id, name: names.get(id) || id, visitors: 0, views: 0, vdpViews: 0, contactClicks: 0,
        leads: leadsOf.get(id) || 0, identifiedLeads: idOf.get(id) || 0, conversion: 0, lastActive: null as Date | null,
      })),
    ].sort((a, b) => b.visitors - a.visitors || b.leads - a.leads);

    return {
      days,
      tenantId: tenantId || null,
      kpis: {
        events: { today: counts[0], d7: counts[1], d30: counts[2] },
        visitors: { h24: v.h24, d7: v.d7, d30: v.d30, range: v.in_range },
        vdpViews: v.vdp,
        whatsappClicks: v.whatsapp,
        callClicks: v.calls,
        identifiedLeads,
        conversionRate: pct(identifiedLeads, v.in_range),
      },
      dealers,
      topVehicles: topVehicles.map((x) => ({ ...x, dealerName: names.get(x.tenantId) || x.tenantId })),
      dealerships: tenants.map((x) => ({ id: x.id, name: x.name })),
      feed,
    };
  }
}

/** "https://site.com/inventory/x?y" → "/inventory/x?y" */
function pathOf(u?: string): string | null {
  const s = clean(u, 500);
  if (!s) return null;
  try {
    const x = new URL(s, 'http://x');
    return (x.pathname + x.search).slice(0, 300);
  } catch {
    return s.slice(0, 300);
  }
}
