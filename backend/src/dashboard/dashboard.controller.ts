import { Controller, Get, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Perms, TenantId } from '../common/decorators.js';
import { cachedDashboard } from './dashboard.cache.js';

/**
 * Dealership Portal › Overview: key numbers and the set-up checklist.
 * Speed: all queries run at the same time, read only the columns the page shows, the three inquiry counts are one
 * query, and the result is kept for 20 s per dealership (cleared at once when the dealer changes something).
 * Nothing here calls Facebook, Chrome or any other outside service.
 */
@Controller('dealer/dashboard')
@Perms('dashboard')
export class DashboardController {
  private readonly log = new Logger('Dashboard');

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  get(@TenantId() tenantId: string) {
    return cachedDashboard(tenantId, () => this.compute(tenantId));
  }

  /** unread / last 7 days / last 30 days inquiries in one query (three counts if the SQL cannot run) */
  private async leadStats(tenantId: string, since7: Date, since30: Date) {
    try {
      const rows = await this.prisma.$queryRaw<{ last7: number; last30: number; unread: number }[]>`
        SELECT
          count(*) FILTER (WHERE "createdAt" >= ${since7})::int AS last7,
          count(*) FILTER (WHERE "createdAt" >= ${since30})::int AS last30,
          count(*) FILTER (WHERE "status"::text = 'UNREAD')::int AS unread
        FROM "Lead" WHERE "tenantId" = ${tenantId}`;
      const r = rows[0];
      return { last7: Number(r?.last7 || 0), last30: Number(r?.last30 || 0), unread: Number(r?.unread || 0) };
    } catch (e) {
      this.log.warn(`lead stats query failed, using separate counts: ${(e as Error).message}`);
      const [last7, last30, unread] = await Promise.all([
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: since7 } } }),
        this.prisma.lead.count({ where: { tenantId, createdAt: { gte: since30 } } }),
        this.prisma.lead.count({ where: { tenantId, status: 'UNREAD' } }),
      ]);
      return { last7, last30, unread };
    }
  }

  private async compute(tenantId: string) {
    const since7 = new Date(Date.now() - 7 * 86400_000);
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const [t, s, byStatus, value, leads, posts, contentCount, latestLeads, recentVehicles] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { themeId: true, onboarding: true, domains: { select: { domain: true }, orderBy: { isPrimary: 'desc' } } },
      }),
      this.prisma.tenantSettings.findUnique({
        where: { tenantId },
        select: { name: true, phone: true, street: true, city: true, logo: true, hours: true, leadTo: true, email: true },
      }),
      this.prisma.vehicle.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
      this.prisma.vehicle.aggregate({ where: { tenantId, status: 'PUBLISHED' }, _sum: { price: true }, _avg: { price: true } }),
      this.leadStats(tenantId, since7, since30),
      this.prisma.blogPost.count({ where: { tenantId, status: 'PUBLISHED' } }),
      // only "is there any?" matters for the checklist
      this.prisma.contentValue.count({ where: { tenantId }, take: 1 }),
      this.prisma.lead.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, name: true, topic: true, message: true, status: true, createdAt: true },
      }),
      this.prisma.vehicle.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, year: true, make: true, model: true, trim: true, price: true, status: true, images: true },
      }),
    ]);
    if (!t) throw new NotFoundException('Dealership not found');
    const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count])) as Record<string, number>;
    const onb = (t.onboarding || {}) as Record<string, boolean>;
    const checklist = [
      { id: 'business', label: 'Add your business details', desc: 'Dealership name, phone number and address.', done: !!(s?.name && s?.phone && (s?.street || s?.city)), href: '/dealer/business' },
      { id: 'logo', label: 'Upload your logo', desc: 'Shown in the header and footer of every theme.', done: !!s?.logo, href: '/dealer/business' },
      { id: 'hours', label: 'Set your opening hours', desc: 'So visitors know when to call or visit.', done: !!(s?.hours && Object.keys((s?.hours as object) || {}).length > 0), href: '/dealer/business' },
      { id: 'design', label: 'Choose your website design', desc: 'Preview the themes and pick the one you like.', done: !!onb.theme_chosen || !!t.themeId, href: '/dealer/design' },
      { id: 'content', label: 'Write your website text', desc: 'Headlines, your story and customer reviews.', done: !!onb.content_edited || contentCount > 0, href: '/dealer/content' },
      { id: 'leads', label: 'Choose where inquiries go', desc: 'The email address that receives customer messages.', done: !!s?.leadTo || !!s?.email, href: '/dealer/leads' },
      { id: 'vehicle', label: 'Add your first vehicle', desc: 'Publish vehicles with photos and prices.', done: (counts.PUBLISHED || 0) > 0, href: '/dealer/vehicles/new' },
    ];
    return {
      vehicles: { published: counts.PUBLISHED || 0, draft: counts.DRAFT || 0, sold: counts.SOLD || 0 },
      inventoryValue: Number(value._sum.price || 0),
      averagePrice: Math.round(Number(value._avg.price || 0)),
      leads,
      posts,
      checklist,
      progress: Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100),
      latestLeads,
      // only the first photo is shown; the rest is not sent
      recentVehicles: recentVehicles.map((v) => ({ ...v, images: (v.images || []).slice(0, 1) })),
      domains: t.domains.map((d) => d.domain),
      themeId: t.themeId,
    };
  }
}
