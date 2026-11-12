import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { clean, slugify } from '../common/util.js';
import { CARGURUS_RULES, cleanVehicleInput, DEFAULT_RULES, publishProblems, RULE_FIELDS, vehicleName } from './vehicle.fields.js';
import { CargurusService } from '../cargurus/cargurus.service.js';
import type { Prisma, Vehicle, VehicleStatus } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';

type CgReady = Awaited<ReturnType<CargurusService['readiness']>>;

/** Additional file columns sent by the import: { header: value }, at most 60 columns. */
function cleanExtra(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 60)) {
    const key = clean(k, 80);
    if (key) out[key] = clean(x === null || x === undefined ? '' : String(x), 2000);
  }
  return Object.keys(out).length ? out : null;
}

export interface VehicleQuery {
  q?: string;
  status?: string;
  featured?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
  /** CarGurus filter: ready | bad */
  cg?: string;
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
    private readonly cargurus: CargurusService,
  ) {}

  /** Every inventory change: update the CarGurus queue / live feed (never blocks the save). */
  private changed(tenantId: string, user: AuthUser) {
    return this.cargurus.afterInventoryChange(tenantId, user.login);
  }

  private serialize(v: Vehicle) {
    let processingFee: number | null = null;
    let ex: any = v.extra;
    if (typeof ex === 'string') {
      try { ex = JSON.parse(ex); } catch {}
    }
    if (ex && typeof ex === 'object') {
      const feeKeys = ['processingfee', 'processing_fee', 'profee', 'docfee', 'documentationfee', 'dealerfee', 'adminfee'];
      for (const [k, val] of Object.entries(ex)) {
        if (feeKeys.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
          const num = parseFloat(String(val || '').replace(/[^0-9.]/g, ''));
          if (!isNaN(num) && num > 0) {
            processingFee = num;
            break;
          }
        }
      }
    }
    return { ...v, processingFee };
  }

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
    // CarGurus readiness of every vehicle for sale (same checks as the CarGurus feed).
    // Speed: when the list is not filtered by CarGurus status, the readiness check and the
    // page queries run at the same time instead of one after the other.
    const cgFilter = q.cg === 'ready' || q.cg === 'bad';
    const readyP = this.cargurus.cargurusOn(tenantId).then(async (on) => ({ on, ready: on ? await this.cargurus.readiness(tenantId) : (new Map() as CgReady) }));
    const pageQueries = () => Promise.all([
      this.prisma.vehicle.findMany({ where, orderBy: SORTS[q.sort || 'newest'] ?? SORTS.newest, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
    ]);
    let cargurusOn: boolean;
    let ready: CgReady;
    let rows: Awaited<ReturnType<typeof pageQueries>>[0];
    let total: number;
    let counts: Awaited<ReturnType<typeof pageQueries>>[2];
    if (cgFilter) {
      ({ on: cargurusOn, ready } = await readyP);
      if (cargurusOn) {
        const ids = [...ready.entries()].filter(([, iss]) => (q.cg === 'bad') === iss.length > 0).map(([id]) => id);
        where.status = 'PUBLISHED';
        where.id = { in: ids };
      }
      [rows, total, counts] = await pageQueries();
    } else {
      const [r, p] = await Promise.all([readyP, pageQueries()]);
      ({ on: cargurusOn, ready } = r);
      [rows, total, counts] = p;
    }
    let cgReady = 0;
    let cgExcluded = 0;
    for (const iss of ready.values()) iss.length ? cgExcluded++ : cgReady++;
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
    // vehicles switched off for CarGurus are not in its feed: no CarGurus status for them
    const items = rows.map((v) => ({ ...this.serialize(v), cargurus: cargurusOn && v.status === 'PUBLISHED' && v.syndicateCargurus !== false ? { issues: ready.get(v.id) ?? [] } : null }));
    return { items, total, page, pageSize, cargurusOn, counts: { PUBLISHED: 0, DRAFT: 0, SOLD: 0, ...byStatus, cgReady, cgExcluded } };
  }

  async get(tenantId: string, id: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return this.serialize(v);
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

  /** Same rules as the old portal: publishing needs Year, Make, Model, Price, Mileage and a photo; a draft needs a make or model. */
  private check(merged: Record<string, unknown>) {
    const problem = publishProblems(merged);
    if (problem) throw new BadRequestException(problem);
  }

  async create(tenantId: string, body: Record<string, unknown>, user: AuthUser) {
    const data = cleanVehicleInput(body) as Record<string, unknown>;
    if (!data.status) data.status = 'PUBLISHED';
    this.check(data);
    const slug = await this.uniqueSlug(tenantId, String(data.slug || vehicleName(data as never) || 'vehicle'));
    const v = await this.prisma.vehicle.create({ data: { ...(data as Prisma.VehicleUncheckedCreateInput), tenantId, slug } });
    await this.audit.record('vehicle.create', { tenantId, actor: user.login, detail: { id: v.id, name: vehicleName(v) } });
    if (v.status === 'PUBLISHED') await this.tenants.setOnboarding(tenantId, 'first_vehicle');
    await this.changed(tenantId, user);
    return this.serialize(v);
  }

  async update(tenantId: string, id: string, body: Record<string, unknown>, user: AuthUser) {
    const cur = await this.get(tenantId, id);
    const data = cleanVehicleInput(body) as Record<string, unknown>;
    if (data.status === cur.status) delete data.soldAt;
    this.check({ ...cur, ...data });
    if (data.slug) data.slug = await this.uniqueSlug(tenantId, String(data.slug), id);
    const v = await this.prisma.vehicle.update({ where: { id }, data });
    await this.audit.record('vehicle.update', { tenantId, actor: user.login, detail: { id, name: vehicleName(v), fields: Object.keys(data) } });
    if (v.status === 'PUBLISHED') await this.tenants.setOnboarding(tenantId, 'first_vehicle');
    await this.changed(tenantId, user);
    return this.serialize(v);
  }

  async remove(tenantId: string, id: string, user: AuthUser) {
    const v = await this.get(tenantId, id);
    await this.prisma.vehicle.delete({ where: { id } });
    await this.audit.record('vehicle.delete', { tenantId, actor: user.login, detail: { id, name: vehicleName(v) } });
    await this.changed(tenantId, user);
    return { ok: true };
  }

  async bulk(tenantId: string, body: { ids?: string[]; action?: string }, user: AuthUser) {
    const ids = (body.ids || []).filter((x) => typeof x === 'string').slice(0, 1000);
    const where = { tenantId, id: { in: ids } };
    let count = 0;
    switch (body.action) {
      case 'publish':
        // like the old portal: a vehicle without photos cannot be published
        count = (await this.prisma.vehicle.updateMany({ where: { ...where, NOT: { images: { isEmpty: true } } }, data: { status: 'PUBLISHED', soldAt: null } })).count;
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
    await this.changed(tenantId, user);
    return { ok: true, count, skipped: ids.length - count };
  }

  /**
   * Import (CSV / TSV / XML read and checked in the portal, 3 steps like the old platform).
   * Existing vehicles are matched by VIN, then stock number, and updated with the non-empty values of the row;
   * their other fields (and photos when the row has none) are kept. New vehicles: the row's status when the file
   * has one, otherwise published when they have photos and saved as drafts when they have none.
   */
  async import(tenantId: string, body: { rows?: Record<string, unknown>[]; mode?: 'publish' | 'draft' }, user: AuthUser) {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
    const res = { created: 0, updated: 0, skipped: [] as { row: number; reason: string }[] };
    const existing = await this.prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, vin: true, stockNumber: true } });
    const byVin = new Map<string, string>(existing.filter((v) => v.vin).map((v) => [v.vin, v.id]));
    const byStock = new Map<string, string>(existing.filter((v) => v.stockNumber).map((v) => [v.stockNumber.toLowerCase(), v.id]));

    for (let i = 0; i < rows.length; i++) {
      const rowNo = Number((rows[i] as { _row?: unknown })._row) || i + 1;
      try {
        const extra = cleanExtra((rows[i] as { extra?: unknown }).extra);
        const input = Object.fromEntries(
          Object.entries(rows[i]).filter(([k, v]) => k !== '_row' && k !== 'extra' && v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length)),
        );
        const data = cleanVehicleInput(input) as Record<string, unknown>;
        const imgs = (data.images as string[] | undefined) ?? [];
        if (!imgs.length) delete data.images;
        if (!data.make && !data.model && !data.vin) {
          res.skipped.push({ row: rowNo, reason: 'No make, model or VIN' });
          continue;
        }
        const vin = data.vin ? String(data.vin) : '';
        const stock = data.stockNumber ? String(data.stockNumber).toLowerCase() : '';
        const id: string | undefined = (vin ? byVin.get(vin) : undefined) ?? (stock ? byStock.get(stock) : undefined);
        if (id) {
          const cur = (await this.prisma.vehicle.findUnique({ where: { id } })) as unknown as { images: string[]; extra?: unknown } | null;
          if (data.status === 'PUBLISHED' && !imgs.length && !cur?.images.length) data.status = 'DRAFT';
          if (extra) data.extra = { ...(cur?.extra && typeof cur.extra === 'object' ? (cur.extra as Record<string, string>) : {}), ...extra };
          await this.prisma.vehicle.update({ where: { id }, data: data as Prisma.VehicleUncheckedUpdateInput });
          res.updated++;
        } else {
          let status = (data.status as VehicleStatus | undefined) ?? (imgs.length ? 'PUBLISHED' : 'DRAFT');
          if (body.mode === 'draft' || (status === 'PUBLISHED' && !imgs.length)) status = 'DRAFT';
          const slug = await this.uniqueSlug(tenantId, vehicleName(data as never));
          const v = await this.prisma.vehicle.create({
            data: {
              vehicleType: 'Car',
              condition: 'Used',
              ...(data as Prisma.VehicleUncheckedCreateInput),
              ...(extra ? ({ extra } as object) : {}),
              tenantId,
              slug,
              status,
              soldAt: status === 'SOLD' ? new Date() : null,
            },
          });
          if (v.vin) byVin.set(v.vin, v.id);
          if (v.stockNumber) byStock.set(v.stockNumber.toLowerCase(), v.id);
          res.created++;
        }
      } catch (e) {
        res.skipped.push({ row: rowNo, reason: (e as Error).message });
      }
    }
    await this.audit.record('vehicle.import', { tenantId, actor: user.login, detail: { created: res.created, updated: res.updated, skipped: res.skipped.length } });
    if (res.created || res.updated) {
      if (await this.prisma.vehicle.count({ where: { tenantId, status: 'PUBLISHED' } })) await this.tenants.setOnboarding(tenantId, 'first_vehicle');
      await this.changed(tenantId, user);
    }
    return res;
  }
}
