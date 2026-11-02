import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { clean, cleanMl, isEmail, rateLimit, toCsv } from '../common/util.js';
import type { LeadStatus, Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';

export interface PublicLeadInput {
  name?: string;
  email?: string;
  phone?: string;
  topic?: string;
  message?: string;
  page?: string;
  vehicleId?: string;
  website?: string; // honeypot
}

const STATUSES: LeadStatus[] = ['UNREAD', 'READ', 'REPLIED', 'CLOSED'];

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /** Inquiry from the public website. Saved first (never lost), then e-mailed to the dealership. */
  async submit(tenantId: string, b: PublicLeadInput, ip: string) {
    if (b.website) return { ok: true }; // bots fill the hidden field
    if (!rateLimit(`lead|${tenantId}|${ip}`, 5, 600)) throw new HttpException('Too many messages, please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    const name = clean(b.name, 120);
    const email = clean(b.email, 160).toLowerCase();
    const phone = clean(b.phone, 40);
    const message = cleanMl(b.message, 4000);
    const topic = clean(b.topic, 160) || 'Website inquiry';
    if (!name || (!email && !phone) || !message) throw new BadRequestException('Please fill in your name, a phone number or email, and a message.');
    if (email && !isEmail(email)) throw new BadRequestException('Please check your email address.');
    let vehicleId: string | null = null;
    let vehicleLabel = '';
    if (b.vehicleId) {
      const v = await this.prisma.vehicle.findFirst({ where: { tenantId, OR: [{ id: String(b.vehicleId) }, { slug: String(b.vehicleId) }, { legacyId: String(b.vehicleId) }] } });
      if (v) {
        vehicleId = v.id;
        vehicleLabel = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') + (v.stockNumber ? ` (stock ${v.stockNumber})` : '');
      }
    }
    const lead = await this.prisma.lead.create({
      data: { tenantId, name, email, phone, topic, message, page: clean(b.page, 300), vehicleId, source: vehicleId || topic.startsWith('Vehicle') ? 'VEHICLE' : 'CONTACT' },
    });
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const to = s?.leadTo || s?.email || '';
    let emailed = false;
    if (to) {
      const text =
        `New website inquiry\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nTopic: ${topic}\n` +
        (vehicleLabel ? `Vehicle: ${vehicleLabel}\n` : '') +
        `\n${message}\n\nPage: ${lead.page}\nTime: ${lead.createdAt.toISOString()}\n`;
      emailed = (await this.mail.send({ tenantId, to, subject: `${s?.name || 'Website'}: ${topic} - ${name}`, text, replyTo: email })).sent;
      if (emailed) await this.prisma.lead.update({ where: { id: lead.id }, data: { emailed: true } });
    }
    return { ok: true, emailed };
  }

  async list(tenantId: string, q: { status?: string; q?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize || '50', 10) || 50));
    const where: Prisma.LeadWhereInput = { tenantId };
    const st = (q.status || '').toUpperCase() as LeadStatus;
    if (STATUSES.includes(st)) where.status = st;
    const term = clean(q.q, 80);
    if (term) {
      where.OR = ['name', 'email', 'phone', 'message', 'topic'].map((f) => ({ [f]: { contains: term, mode: 'insensitive' } }));
    }
    const [items, total, unread] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { vehicle: { select: { id: true, year: true, make: true, model: true, slug: true } }, _count: { select: { replies: true } } },
      }),
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: { tenantId, status: 'UNREAD' } }),
    ]);
    return { items, total, page, pageSize, unread };
  }

  async get(tenantId: string, id: string) {
    const l = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      include: { replies: { orderBy: { createdAt: 'asc' } }, vehicle: true },
    });
    if (!l) throw new NotFoundException('Inquiry not found');
    if (l.status === 'UNREAD') {
      await this.prisma.lead.update({ where: { id }, data: { status: 'READ' } });
      l.status = 'READ';
    }
    return l;
  }

  async update(tenantId: string, id: string, b: { status?: string; notes?: string }, user: AuthUser) {
    await this.get(tenantId, id);
    const data: Prisma.LeadUpdateInput = {};
    if (b.status) {
      const st = b.status.toUpperCase() as LeadStatus;
      if (!STATUSES.includes(st)) throw new BadRequestException('Unknown status');
      data.status = st;
    }
    if (b.notes !== undefined) data.notes = cleanMl(b.notes, 4000);
    const l = await this.prisma.lead.update({ where: { id }, data });
    await this.audit.record('lead.update', { tenantId, actor: user.login, detail: { id, status: l.status } });
    return l;
  }

  async remove(tenantId: string, id: string, user: AuthUser) {
    await this.get(tenantId, id);
    await this.prisma.lead.delete({ where: { id } });
    await this.audit.record('lead.delete', { tenantId, actor: user.login, detail: { id } });
    return { ok: true };
  }

  /** Reply by e-mail; the customer's reply comes back to the dealership's inquiry address. */
  async reply(tenantId: string, id: string, b: { body?: string }, user: AuthUser) {
    const lead = await this.get(tenantId, id);
    const body = cleanMl(b.body, 8000);
    if (!body) throw new BadRequestException('Write a message first');
    if (!lead.email) throw new BadRequestException('This customer did not leave an email address');
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const replyTo = s?.leadTo || s?.email || user.email;
    const res = await this.mail.send({ tenantId, to: lead.email, subject: `Re: ${lead.topic}`, text: `${body}\n\n— ${s?.name || ''}\n${s?.phone || ''}`, replyTo });
    if (!res.sent) throw new BadRequestException(`The email could not be sent: ${res.error}`);
    const reply = await this.prisma.leadReply.create({
      data: { leadId: id, body, sentBy: user.login, toEmail: lead.email, fromEmail: res.from || '', replyTo, emailed: true },
    });
    await this.prisma.lead.update({ where: { id }, data: { status: 'REPLIED' } });
    await this.audit.record('lead.reply', { tenantId, actor: user.login, detail: { id } });
    return reply;
  }

  async exportCsv(tenantId: string) {
    const rows = await this.prisma.lead.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, include: { vehicle: true } });
    return toCsv([
      ['Date', 'Name', 'Email', 'Phone', 'Topic', 'Message', 'Vehicle', 'Status', 'Notes', 'Page'],
      ...rows.map((l) => [
        l.createdAt.toISOString(),
        l.name,
        l.email,
        l.phone,
        l.topic,
        l.message,
        l.vehicle ? [l.vehicle.year, l.vehicle.make, l.vehicle.model].filter(Boolean).join(' ') : '',
        l.status,
        l.notes,
        l.page,
      ]),
    ]);
  }

  async leadEmail(tenantId: string) {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { leadTo: true, email: true } });
    return { leadTo: s?.leadTo || '', fallback: s?.email || '' };
  }

  async setLeadEmail(tenantId: string, b: { leadTo?: string }, user: AuthUser) {
    const e = clean(b.leadTo, 160).toLowerCase();
    if (e && !isEmail(e)) throw new BadRequestException('Please enter a valid email address');
    await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, leadTo: e }, update: { leadTo: e } });
    await this.audit.record('lead.email', { tenantId, actor: user.login, detail: { leadTo: e } });
    return this.leadEmail(tenantId);
  }

  async testEmail(tenantId: string, user: AuthUser) {
    if (!rateLimit(`testmail|${tenantId}`, 5, 600)) throw new HttpException('Please wait a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    const { leadTo, fallback } = await this.leadEmail(tenantId);
    const to = leadTo || fallback;
    if (!to) throw new BadRequestException('Set the inquiry email address first');
    const res = await this.mail.send({ tenantId, to, subject: 'Test email from your website', text: `This is a test. Website inquiries will arrive at ${to}.\n\nSent by ${user.name || user.login}.` });
    if (!res.sent) throw new BadRequestException(`The email could not be sent: ${res.error}`);
    return { ok: true, to };
  }
}
