import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { clean, cleanMl } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';

export const REQUEST_TYPES = ['EXTRA_PAGE', 'EXTRA_SECTION', 'DESIGN_CHANGE'] as const;
export const REQUEST_STATUSES = ['NEW', 'IN_REVIEW', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const;
export const CONTACT_PREFERENCES = ['PORTAL', 'EMAIL', 'PHONE'] as const;
type RequestType = (typeof REQUEST_TYPES)[number];
type RequestStatus = (typeof REQUEST_STATUSES)[number];
type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s().+-]{5,38}$/;
/** at most this many new requests per dealership per day (keeps a stuck "Submit" button from flooding the list) */
const DAILY_LIMIT = 15;

const pick = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);

/** what the dealer portal shows for one request */
function dealerView(r: Prisma.DesignRequestGetPayload<object>) {
  return {
    id: r.id,
    dealerId: r.tenantId,
    requestType: r.requestType,
    title: r.title,
    targetPage: r.targetPage,
    description: r.description,
    referenceUrl: r.referenceUrl,
    contactPreference: r.contactPreference,
    contactEmail: r.contactEmail,
    contactPhone: r.contactPhone,
    status: r.status,
    adminNotes: r.adminNotes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * Design requests: a dealership asks the platform team for an extra page, an extra section or a design change
 * (Dealer Portal › Design & colours); the team answers and moves it through
 * NEW → IN_REVIEW → IN_PROGRESS → COMPLETED / DECLINED (Platform Admin › Design requests).
 */
@Injectable()
export class DesignRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly platform: PlatformSettingsService,
  ) {}

  /* ───────────────── Dealer Portal ───────────────── */

  /** this dealership's requests + the platform's support contact + contact details to pre-fill the form */
  async listForDealer(tenantId: string, u: AuthUser) {
    const [rows, s, ps] = await Promise.all([
      this.prisma.designRequest.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { email: true, phone: true } }),
      this.platform.all(),
    ]);
    const support = (ps as unknown as { support?: { email?: string; phone?: string; note?: string } }).support || {};
    return {
      items: rows.map(dealerView),
      /** "Need to discuss directly?" — Platform Admin › Platform settings › Support */
      support: { email: support.email || '', phone: support.phone || '', note: support.note || '' },
      /** pre-filled in the form (editable) */
      contact: { email: (u.kind === 'dealer' ? u.email : '') || s?.email || '', phone: s?.phone || '' },
    };
  }

  async create(tenantId: string, b: Record<string, unknown>, u: AuthUser) {
    const requestType = pick<RequestType>(b.requestType, REQUEST_TYPES);
    if (!requestType) throw new BadRequestException('Choose what you need: an extra page, an extra section or a design change.');
    const title = clean(b.title, 120);
    if (title.length < 3) throw new BadRequestException('Give your request a short title (e.g. "Service department page").');
    const description = cleanMl(b.description, 5000);
    if (description.length < 10) throw new BadRequestException('Tell us a little more in "Details & requirements" (at least a sentence).');
    const referenceUrl = clean(b.referenceUrl, 500);
    if (referenceUrl && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(referenceUrl)) throw new BadRequestException('The reference link must be a full web address (https://…).');
    const contactPreference = pick<ContactPreference>(b.contactPreference, CONTACT_PREFERENCES) || 'PORTAL';
    const contactEmail = clean(b.contactEmail, 160);
    const contactPhone = clean(b.contactPhone, 40);
    if (contactEmail && !EMAIL_RE.test(contactEmail)) throw new BadRequestException('Please check the email address.');
    if (contactPhone && !PHONE_RE.test(contactPhone)) throw new BadRequestException('Please check the phone number.');
    if (contactPreference === 'EMAIL' && !contactEmail) throw new BadRequestException('Add the email address we should use.');
    if (contactPreference === 'PHONE' && !contactPhone) throw new BadRequestException('Add the phone number we should call.');

    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const today = await this.prisma.designRequest.count({ where: { tenantId, createdAt: { gte: since } } });
    if (today >= DAILY_LIMIT) throw new HttpException('You have sent many requests today — the team will get back to you. You can also contact us directly.', HttpStatus.TOO_MANY_REQUESTS);

    const row = await this.prisma.designRequest.create({
      data: {
        tenantId,
        requestType,
        title,
        targetPage: clean(b.targetPage, 120),
        description,
        referenceUrl,
        contactPreference,
        contactEmail,
        contactPhone,
        submittedBy: u.login,
      },
    });
    await this.audit.record('design-request.create', { tenantId, actor: u.login, detail: { id: row.id, requestType, title } });
    return dealerView(row);
  }

  /* ───────────────── Platform Admin ───────────────── */

  /** NEW requests (sidebar badge) */
  async newCount() {
    return { new: await this.prisma.designRequest.count({ where: { status: 'NEW' } }) };
  }

  /** ?status=NEW&requestType=EXTRA_PAGE&dealerId=…&q=…&page=1&pageSize=25 */
  async listForPlatform(q: { status?: string; requestType?: string; dealerId?: string; q?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(q.pageSize || '25', 10) || 25));
    const where: Prisma.DesignRequestWhereInput = {};
    const status = pick<RequestStatus>(q.status, REQUEST_STATUSES);
    if (status) where.status = status;
    const requestType = pick<RequestType>(q.requestType, REQUEST_TYPES);
    if (requestType) where.requestType = requestType;
    if (q.dealerId) where.tenantId = clean(q.dealerId, 80);
    const term = clean(q.q, 80);
    if (term) {
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { tenant: { name: { contains: term, mode: 'insensitive' } } },
        { tenant: { domains: { some: { domain: { contains: term.toLowerCase() } } } } },
      ];
    }
    const [rows, total, grouped] = await Promise.all([
      this.prisma.designRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              domains: { select: { domain: true, isPrimary: true }, orderBy: { isPrimary: 'desc' } },
              settings: { select: { email: true, phone: true, name: true } },
            },
          },
        },
      }),
      this.prisma.designRequest.count({ where }),
      this.prisma.designRequest.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;
    return {
      items: rows.map((r) => ({
        ...dealerView(r),
        submittedBy: r.submittedBy,
        updatedBy: r.updatedBy,
        dealer: {
          id: r.tenant.id,
          name: r.tenant.settings?.name || r.tenant.name,
          domain: r.tenant.domains[0]?.domain || '',
          email: r.tenant.settings?.email || '',
          phone: r.tenant.settings?.phone || '',
        },
      })),
      total,
      page,
      pageSize,
      counts,
      new: counts.NEW,
    };
  }

  /** { status?, adminNotes? } — the dealer sees both in the portal at once */
  async update(id: string, b: Record<string, unknown>, u: AuthUser) {
    const cur = await this.prisma.designRequest.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Request not found');
    const data: Prisma.DesignRequestUpdateInput = { updatedBy: u.login };
    if (b.status !== undefined) {
      const status = pick<RequestStatus>(b.status, REQUEST_STATUSES);
      if (!status) throw new BadRequestException(`Status must be one of ${REQUEST_STATUSES.join(', ')}`);
      data.status = status;
    }
    if (b.adminNotes !== undefined) data.adminNotes = cleanMl(b.adminNotes, 4000);
    const row = await this.prisma.designRequest.update({ where: { id }, data });
    await this.audit.record('design-request.update', { tenantId: cur.tenantId, actor: u.login, detail: { id, from: cur.status, to: row.status } });
    return dealerView(row);
  }
}
