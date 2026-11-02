import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { clean, slugify } from '../common/util.js';
import { CARGURUS_RULES, cleanVehicleInput, DEFAULT_RULES, missingRequired, RULE_FIELDS, vehicleName } from './vehicle.fields.js';
import type { Prisma, VehicleStatus } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';

export interface VehicleQuery {
  q?: string;
  status?: string;
  featured?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
}

const SORTS: Record<string, Prisma.VehicleOrderByWithRelationInput> = {
  newest: { createdAt: 'desc' },
  oldest: { createdAt: 'asc' },
  updated: { updatedAt: 'desc' },
  price_asc: { price: 'asc' },
  price_desc: { price: 'desc' },
  year_desc: { year: 'desc' },
  mileage_asc: { mileage: 'asc' },
};

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
  ) {}

  async list(tenantId: string, q: VehicleQuery) {
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize || '50', 10) || 50));
    const where: Prisma.VehicleWhereInput = { tenantId };
    const status = (q.status || '').toUpperCase();
    if (['PUBLISHED', 'DRAFT', 'SOLD'].includes(status)) where.status = status as VehicleStatus;
    if (q.featured === 'true') where.featured = true;
    const term = clean(q.q, 80);
    if (term) {
      const n = parseInt(term, 10);
      where.OR = [
        { make: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
        { trim: { contains: term, mode: 'insensitive' } },
        { vin: { contains: term.toUpperCase() } },
        { stockNumber: { contains: term, mode: 'insensitive' } },
        ...(Number.isFinite(n) && n > 1900 && n < 2100 ? [{ year: n }] : []),
      ];
    }
    const [items, total, counts] = await Promise.all([
      this.prisma.vehicle.findMany({ where, orderBy: SORTS[q.sort || 'newest'] ?? SORTS.newest, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
    ]);
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    return { items, total, page, pageSize, counts: { PUBLISHED: 0, DRAFT: 0, SOLD: 0, ...byStatus } };
  }

  async get(tenantId: string, id: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return v;
  }

  async rules(tenantId: string) {
    const r = await this.prisma.fieldRules.findUnique({ where: { tenantId } });
    return {
      rules: (r?.rules as Record<string, string>) ?? DEFAULT_RULES,
      skipDraft: r?.skipDraft ?? true,
      fields: RULE_FIELDS,
      cargurusSet: CARGURUS_RULES,
    };
  }

  async saveRules(tenantId: string, body: { rules?: Record<string, string>; skipDraft?: boolean }) {
    const rules: Record<string, 'required'> = {};
    for (const [k, v] of Object.entries(body.rules || {})) if (RULE_FIELDS[k] && v === 'required') rules[k] = 'required';
    const skipDraft = body.skipDraft !== false;
    await this.prisma.fieldRules.upsert({ where: { tenantId }, create: { tenantId, rules, skipDraft }, update: { rules, skipDraft } });
    return this.rules(tenantId);
  }

  private async uniqueSlug(tenantId: string, base: string, exceptId?: string) {
    const root = slugify(base || 'vehicle', 70);
    let slug = root;
    for (let i = 2; ; i++) {
      const hit = await this.prisma.vehicle.findFirst({ where: { tenantId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
      if (!hit) return slug;
      slug = `${root}-${i}`;
    }
  }

  private async check(tenantId: string, merged: Record<string, unknown>) {
    const { rules, skipDraft } = await this.rules(tenantId);
    const missing = missingRequired(merged, rules, skipDraft);
    if (missing.length) throw new BadRequestException(`Please fill in: ${missing.join(', ')}`);
  }

  async create(tenantId: string, body: Record<string, unknown>, user: AuthUser) {
    const data = cleanVehicleInput(body) as Record<string, unknown>;
    if (!data.status) data.status = 'DRAFT';
    await this.check(tenantId, data);
    const slug = await this.uniqueSlug(tenantId, String(data.slug || vehicleName(data as never) || 'vehicle'));
    const v = await this.prisma.vehicle.create({ data: { ...(data as Prisma.VehicleUncheckedCreateInput), tenantId, slug } });
    await this.audit.record('vehicle.create', { tenantId, actor: user.login, detail: { id: v.id, name: vehicleName(v) } });
    if (v.status === 'PUBLISHED') await this.tenants.setOnboarding(tenantId, 'first_vehicle');
    return v;
  }

  async update(tenantId: string, id: string, body: Record<string, unknown>, user: AuthUser) {
    const cur = await this.get(tenantId, id);
    const data = cleanVehicleInput(body) as Record<string, unknown>;
    if (data.status === cur.status) delete data.soldAt;
    await this.check(tenantId, { ...cur, ...data });
    if (data.slug) data.slug = await this.uniqueSlug(tenantId, String(data.slug), id);
    const v = await this.prisma.vehicle.update({ where: { id }, data });
    await this.audit.record('vehicle.update', { tenantId, actor: user.login, detail: { id, name: vehicleName(v), fields: Object.keys(data) } });
    return v;
  }

  async remove(tenantId: string, id: string, user: AuthUser) {
    const v = await this.get(tenantId, id);
    await this.prisma.vehicle.delete({ where: { id } });
    await this.audit.record('vehicle.delete', { tenantId, actor: user.login, detail: { id, name: vehicleName(v) } });
    return { ok: true };
  }

  async bulk(tenantId: string, body: { ids?: string[]; action?: string }, user: AuthUser) {
    const ids = (body.ids || []).filter((x) => typeof x === 'string').slice(0, 1000);
    const where = { tenantId, id: { in: ids } };
    let count = 0;
    switch (body.action) {
      case 'publish':
        count = (await this.prisma.vehicle.updateMany({ where, data: { status: 'PUBLISHED', soldAt: null } })).count;
        break;
      case 'draft':
        count = (await this.prisma.vehicle.updateMany({ where, data: { status: 'DRAFT', soldAt: null } })).count;
        break;
      case 'sold':
        count = (await this.prisma.vehicle.updateMany({ where, data: { status: 'SOLD', soldAt: new Date() } })).count;
        break;
      case 'feature':
        count = (await this.prisma.vehicle.updateMany({ where, data: { featured: true } })).count;
        break;
      case 'unfeature':
        count = (await this.prisma.vehicle.updateMany({ where, data: { featured: false } })).count;
        break;
      case 'delete':
        count = (await this.prisma.vehicle.deleteMany({ where })).count;
        break;
      default:
        throw new BadRequestException('Unknown action');
    }
    await this.audit.record(`vehicle.bulk.${body.action}`, { tenantId, actor: user.login, detail: { count } });
    return { ok: true, count };
  }

  /**
   * Import (CSV / TSV / XML parsed in the admin). Existing vehicles are matched by VIN, then stock number,
   * and updated; their other fields — and photos when the row has none — are kept.
   */
  async import(tenantId: string, body: { rows?: Record<string, unknown>[]; mode?: 'publish' | 'draft' }, user: AuthUser) {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
    const res = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };
    const existing = await this.prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, vin: true, stockNumber: true } });
    const byVin = new Map(existing.filter((v) => v.vin).map((v) => [v.vin, v.id]));
    const byStock = new Map(existing.filter((v) => v.stockNumber).map((v) => [v.stockNumber.toLowerCase(), v.id]));

    for (let i = 0; i < rows.length; i++) {
      try {
        const data = cleanVehicleInput(rows[i]) as Record<string, unknown>;
        delete data.status;
        const imgs = (data.images as string[] | undefined) ?? [];
        if (!imgs.length) delete data.images;
        if (!data.make && !data.model && !data.vin) {
          res.skipped.push({ row: i + 1, reason: 'No make, model or VIN' });
          continue;
        }
        const vin = data.vin ? String(data.vin) : '';
        const stock = data.stockNumber ? String(data.stockNumber).toLowerCase() : '';
        const id: string | undefined = (vin && byVin.get(vin)) || (stock && byStock.get(stock)) || undefined;
        if (id) {
          await this.prisma.vehicle.update({ where: { id }, data: data as Prisma.VehicleUncheckedUpdateInput });
          res.updated++;
        } else {
          const status: VehicleStatus = body.mode === 'publish' && imgs.length ? 'PUBLISHED' : 'DRAFT';
          const slug = await this.uniqueSlug(tenantId, vehicleName(data as never));
          const v = await this.prisma.vehicle.create({ data: { ...(data as Prisma.VehicleUncheckedCreateInput), tenantId, slug, status } });
          if (v.vin) byVin.set(v.vin, v.id);
          if (v.stockNumber) byStock.set(v.stockNumber.toLowerCase(), v.id);
          res.created++;
        }
      } catch (e) {
        res.skipped.push({ row: i + 1, reason: (e as Error).message });
      }
    }
    await this.audit.record('vehicle.import', { tenantId, actor: user.login, detail: { created: res.created, updated: res.updated, skipped: res.skipped.length } });
    return res;
  }
}
