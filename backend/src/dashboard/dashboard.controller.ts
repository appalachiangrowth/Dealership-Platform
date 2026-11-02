import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { Perms, TenantId } from '../common/decorators.js';

/** Dealership Portal › Overview: key numbers and the set-up checklist. */
@Controller('dealer/dashboard')
@Perms('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly tenants: TenantsService) {}

  @Get()
  async get(@TenantId() tenantId: string) {
    const since7 = new Date(Date.now() - 7 * 86400_000);
    const since30 = new Date(Date.now() - 30 * 86400_000);
    const [t, s, byStatus, value, leads7, leads30, unread, posts, contentCount, latestLeads, recentVehicles] = await Promise.all([
      this.tenants.get(tenantId),
      this.prisma.tenantSettings.findUnique({ where: { tenantId } }),
      this.prisma.vehicle.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
      this.prisma.vehicle.aggregate({ where: { tenantId, status: 'PUBLISHED' }, _sum: { price: true }, _avg: { price: true } }),
      this.prisma.lead.count({ where: { tenantId, createdAt: { gte: since7 } } }),
      this.prisma.lead.count({ where: { tenantId, createdAt: { gte: since30 } } }),
      this.prisma.lead.count({ where: { tenantId, status: 'UNREAD' } }),
      this.prisma.blogPost.count({ where: { tenantId, status: 'PUBLISHED' } }),
      this.prisma.contentValue.count({ where: { tenantId } }),
      this.prisma.lead.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.vehicle.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    ]);
    const counts = Object.fromEntries(byStatus.map((b) => [b.status, b._count])) as Record<string, number>;
    const onb = (t.onboarding || {}) as Record<string, boolean>;
    const checklist = [
      { id: 'business', label: 'Add your business details', done: !!(s?.name && s?.phone && (s?.street || s?.city)), href: '/dealer/business' },
      { id: 'logo', label: 'Upload your logo', done: !!s?.logo, href: '/dealer/business' },
      { id: 'design', label: 'Choose your website design', done: !!onb.theme_chosen, href: '/dealer/design' },
      { id: 'content', label: 'Write your website text', done: !!onb.content_edited || contentCount > 0, href: '/dealer/content' },
      { id: 'vehicle', label: 'Add your first vehicle', done: (counts.PUBLISHED || 0) > 0, href: '/dealer/vehicles/new' },
      { id: 'leads', label: 'Set where inquiries are emailed', done: !!s?.leadTo, href: '/dealer/leads' },
    ];
    return {
      vehicles: { published: counts.PUBLISHED || 0, draft: counts.DRAFT || 0, sold: counts.SOLD || 0 },
      inventoryValue: Number(value._sum.price || 0),
      averagePrice: Math.round(Number(value._avg.price || 0)),
      leads: { last7: leads7, last30: leads30, unread },
      posts,
      checklist,
      progress: Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100),
      latestLeads,
      recentVehicles,
      domains: t.domains.map((d) => d.domain),
      themeId: t.themeId,
    };
  }
}
