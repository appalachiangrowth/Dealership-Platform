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
/** the two tracks of Design & colours: "Add Pages" (blue) and "Add Custom Design / Theme" (green) */
export const REQUEST_CATEGORIES = ['ADD_PAGE', 'CUSTOM_THEME'] as const;
/** Add Pages › Page style / layout */
export const LAYOUT_STYLES = ['CLEAN_INFO', 'LEAD_FOCUSED', 'MEDIA_GALLERY', 'MATCH_SITE'] as const;
/** Add Custom Design / Theme › What would you like to customize? */
export const DESIGN_AREAS = ['FULL_THEME', 'NEW_SECTION', 'COLORS_TYPOGRAPHY', 'HEADER_FOOTER', 'WIDGET_BANNER'] as const;
type RequestType = (typeof REQUEST_TYPES)[number];
type RequestCategory = (typeof REQUEST_CATEGORIES)[number];
type RequestStatus = (typeof REQUEST_STATUSES)[number];
type ContactPreference = (typeof CONTACT_PREFERENCES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\d][\d\s().+-]{5,38}$/;
/** at most this many new requests per dealership per day (keeps a stuck "Submit" button from flooding the list) */
const DAILY_LIMIT = 15;

const pick = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);

const HEX = /^#[0-9a-f]{6}$/i;

/** the track of a request; requests sent before the two tracks: an extra page → ADD_PAGE, anything else → CUSTOM_THEME */
const categoryOf = (r: { requestCategory?: RequestCategory | null; requestType: RequestType }): RequestCategory =>
  r.requestCategory || (r.requestType === 'EXTRA_PAGE' ? 'ADD_PAGE' : 'CUSTOM_THEME');

/** list of short texts ("Hero Banner", custom ones): trimmed, unique, at most `max` */
function textList(v: unknown, max: number, len = 60): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|,/) : [];
  const out: string[] = [];
  for (const x of raw) {
    const t = clean(x, len);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** reference / inspiration links: one per line, each a full https:// address */
function urlList(v: unknown): string {
  const lines = String(v ?? '')
    .split(/[\n\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
  for (const l of lines) if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(l) || l.length > 500) throw new BadRequestException(`"${l.slice(0, 80)}" is not a full web address (https://…).`);
  return lines.join('\n');
}

/** what the dealer portal shows for one request */
function dealerView(r: Prisma.DesignRequestGetPayload<object>) {
  return {
    id: r.id,
    dealerId: r.tenantId,
    requestCategory: categoryOf(r),
    subType: r.subType,
    designAreas: r.designAreas,
    pageSlug: r.pageSlug,
    layoutStyle: r.layoutStyle,
    requestedSections: r.requestedSections,
    contentNotes: r.contentNotes,
    colorPreferences: (r.colorPreferences as { primary?: string; accent?: string; mode?: string; font?: string } | null) || null,
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

  /**
   * Add Pages: { requestCategory: 'ADD_PAGE', title, pageSlug?, layoutStyle, requestedSections[], contentNotes, referenceUrl? }
   * Add Custom Design / Theme: { requestCategory: 'CUSTOM_THEME', designAreas[], title, targetPage?, description (brief),
   *   colorPreferences?: { primary, accent, mode, font }, referenceUrl? (one link per line) }
   * Both: contactPreference, contactEmail, contactPhone. Without requestCategory the older form ({ requestType, … }) still works.
   */
  async create(tenantId: string, b: Record<string, unknown>, u: AuthUser) {
    const requestCategory = pick<RequestCategory>(b.requestCategory, REQUEST_CATEGORIES);
    const extra: Record<string, unknown> = {};
    let requestType: RequestType | null;
    let title: string;
    let description: string;
    let targetPage = clean(b.targetPage, 120);
    let referenceUrl: string;

    if (requestCategory === 'ADD_PAGE') {
      title = clean(b.title, 120);
      if (title.length < 3) throw new BadRequestException('Enter the page title, e.g. "Service Department".');
      const pageSlug = clean(b.pageSlug, 80)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const layoutStyle = pick(b.layoutStyle, LAYOUT_STYLES);
      if (!layoutStyle) throw new BadRequestException('Choose a page style / layout.');
      const requestedSections = textList(b.requestedSections, 20);
      if (!requestedSections.length) throw new BadRequestException('Tick at least one section the page should have.');
      const contentNotes = cleanMl(b.contentNotes ?? b.description, 5000);
      if (contentNotes.length < 10) throw new BadRequestException('Tell us what the page should say in "Page content & copy notes" (at least a sentence).');
      requestType = 'EXTRA_PAGE';
      description = contentNotes;
      targetPage = targetPage || (pageSlug ? `/${pageSlug}` : 'New page');
      referenceUrl = urlList(b.referenceUrl);
      Object.assign(extra, { requestCategory, subType: 'page', pageSlug, layoutStyle, requestedSections, contentNotes });
    } else if (requestCategory === 'CUSTOM_THEME') {
      const designAreas = textList(b.designAreas, DESIGN_AREAS.length).filter((a) => (DESIGN_AREAS as readonly string[]).includes(a));
      if (!designAreas.length) throw new BadRequestException('Choose what you would like to customize.');
      title = clean(b.title, 120);
      if (title.length < 3) throw new BadRequestException('Give your request a short title / summary.');
      description = cleanMl(b.description, 5000);
      if (description.length < 10) throw new BadRequestException('Describe what you want in the design brief (at least a sentence).');
      if (designAreas.includes('NEW_SECTION') && !targetPage) throw new BadRequestException('Choose the page the new section should go on.');
      const cp = (b.colorPreferences || {}) as Record<string, unknown>;
      const colorPreferences = designAreas.includes('COLORS_TYPOGRAPHY')
        ? {
            primary: HEX.test(String(cp.primary || '')) ? String(cp.primary).toUpperCase() : '',
            accent: HEX.test(String(cp.accent || '')) ? String(cp.accent).toUpperCase() : '',
            mode: ['light', 'dark', 'either'].includes(String(cp.mode)) ? String(cp.mode) : 'either',
            font: clean(cp.font, 60),
          }
        : undefined;
      requestType = designAreas.length === 1 && designAreas[0] === 'NEW_SECTION' ? 'EXTRA_SECTION' : 'DESIGN_CHANGE';
      referenceUrl = urlList(b.referenceUrl);
      Object.assign(extra, { requestCategory, subType: designAreas[0], designAreas, ...(colorPreferences ? { colorPreferences } : {}) });
    } else {
      // the first version of the form (one form for everything)
      requestType = pick<RequestType>(b.requestType, REQUEST_TYPES);
      if (!requestType) throw new BadRequestException('Choose what you need: a new page or a custom design / theme.');
      title = clean(b.title, 120);
      if (title.length < 3) throw new BadRequestException('Give your request a short title (e.g. "Service department page").');
      description = cleanMl(b.description, 5000);
      if (description.length < 10) throw new BadRequestException('Tell us a little more in "Details & requirements" (at least a sentence).');
      referenceUrl = urlList(b.referenceUrl);
    }
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
        targetPage,
        description,
        ...extra,
        referenceUrl,
        contactPreference,
        contactEmail,
        contactPhone,
        submittedBy: u.login,
      },
    });
    await this.audit.record('design-request.create', { tenantId, actor: u.login, detail: { id: row.id, category: categoryOf(row), requestType, title } });
    return dealerView(row);
  }

  /* ───────────────── Platform Admin ───────────────── */

  /** NEW requests (sidebar badge) */
  async newCount() {
    return { new: await this.prisma.designRequest.count({ where: { status: 'NEW' } }) };
  }

  /** ?status=NEW&requestType=EXTRA_PAGE&dealerId=…&q=…&page=1&pageSize=25 */
  async listForPlatform(q: { status?: string; requestType?: string; category?: string; dealerId?: string; q?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(5, parseInt(q.pageSize || '25', 10) || 25));
    const where: Prisma.DesignRequestWhereInput = {};
    const status = pick<RequestStatus>(q.status, REQUEST_STATUSES);
    if (status) where.status = status;
    const requestType = pick<RequestType>(q.requestType, REQUEST_TYPES);
    if (requestType) where.requestType = requestType;
    // Add Page (blue) / Custom Theme (green) — older requests have no category: their type decides
    const category = pick<RequestCategory>(q.category, REQUEST_CATEGORIES);
    const and: Prisma.DesignRequestWhereInput[] = [];
    if (category === 'ADD_PAGE') and.push({ OR: [{ requestCategory: 'ADD_PAGE' }, { requestCategory: null, requestType: 'EXTRA_PAGE' }] });
    if (category === 'CUSTOM_THEME') and.push({ OR: [{ requestCategory: 'CUSTOM_THEME' }, { requestCategory: null, requestType: { in: ['EXTRA_SECTION', 'DESIGN_CHANGE'] } }] });
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
    if (and.length) where.AND = and;
    // counts per status follow the track filter; counts per track follow the status filter
    const trackWhere: Prisma.DesignRequestWhereInput = { ...where };
    delete trackWhere.AND;
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
      this.prisma.designRequest.groupBy({ by: ['status'], where: and.length ? { AND: and } : {}, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;
    const tracks = await this.prisma.designRequest.groupBy({ by: ['requestCategory', 'requestType'], where: trackWhere, _count: { _all: true } });
    const categories: Record<RequestCategory, number> = { ADD_PAGE: 0, CUSTOM_THEME: 0 };
    for (const g of tracks) categories[categoryOf(g as { requestCategory: RequestCategory | null; requestType: RequestType })] += g._count._all;
    const all = await this.prisma.designRequest.count();
    const newAll = await this.prisma.designRequest.count({ where: { status: 'NEW' } });
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
      categories,
      all,
      new: newAll,
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
