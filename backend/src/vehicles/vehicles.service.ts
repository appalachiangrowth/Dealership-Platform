import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { clean, slugify } from '../common/util.js';
import { CARGURUS_RULES, cleanVehicleInput, DEFAULT_RULES, normVin, publishProblems, RULE_FIELDS, vehicleName } from './vehicle.fields.js';

export const VIN_IN_INVENTORY = 'A vehicle with this VIN is already in your inventory.';
export const VIN_SOLD = 'This vehicle (VIN) has already been sold.';
/** published vehicles need a stock number of their own (trimmed, case-insensitive) within the dealership */
export const stockInUse = (stock: string, v: { year?: unknown; make?: unknown; model?: unknown } | null | undefined) => {
  // year, make and model only: the trim is never part of this message
  const ymm = [v?.year, v?.make, v?.model].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
  return `Stock number ${stock} is already assigned to ${ymm ? `a ${ymm}` : 'another vehicle'}. Please enter a different stock number to proceed.`;
};
import { CargurusService } from '../cargurus/cargurus.service.js';
import { PhotoJobsService } from './photo-jobs.service.js';
import type { PhotoJob } from './photo-jobs.service.js';
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
    private readonly photoJobs: PhotoJobsService,
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
    const channelsP = this.cargurus.channels(tenantId);
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
    // CarGurus on in Business details = every vehicle for sale is in the CarGurus feed (issues = details sent empty)
    const items = rows.map((v) => ({ ...this.serialize(v), cargurus: cargurusOn && v.status === 'PUBLISHED' ? { issues: ready.get(v.id) ?? [] } : null }));
    // channels = Business details › "Where your vehicles are sent" (the import only runs the checks of the channels that are on)
    return { items, total, page, pageSize, cargurusOn, channels: await channelsP, counts: { PUBLISHED: 0, DRAFT: 0, SOLD: 0, ...byStatus, cgReady, cgExcluded } };
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

  /** Only a make, model or VIN is needed to save (no CarGurus or photo requirements). */
  private check(merged: Record<string, unknown>) {
    const problem = publishProblems(merged);
    if (problem) throw new BadRequestException(problem);
  }

  /**
   * Same VIN already on this dealership's books (trimmed, case-insensitive): 'active' = in the inventory (for sale or
   * draft), 'sold' = sold before. exceptId = the vehicle being edited.
   */
  async vinCheck(tenantId: string, raw: unknown, exceptId?: string) {
    const vin = normVin(raw);
    if (!vin) return { vin, status: 'none' as const, vehicle: null };
    const hits = await this.prisma.vehicle.findMany({
      where: { tenantId, vin: { equals: vin, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true, year: true, make: true, model: true, trim: true, status: true, stockNumber: true },
      orderBy: { updatedAt: 'desc' },
    });
    const active = hits.find((h) => h.status !== 'SOLD');
    const hit = active || hits[0];
    if (!hit) return { vin, status: 'none' as const, vehicle: null };
    return { vin, status: active ? ('active' as const) : ('sold' as const), vehicle: { ...hit, name: vehicleName(hit) } };
  }

  /** refuses a VIN that is already in the inventory or was sold (409 with the reason) */
  private async assertVinFree(tenantId: string, vin: unknown, exceptId?: string) {
    const r = await this.vinCheck(tenantId, vin, exceptId);
    if (r.status === 'active') throw new ConflictException({ message: VIN_IN_INVENTORY, code: 'vin_in_inventory', vehicle: r.vehicle });
    if (r.status === 'sold') throw new ConflictException({ message: VIN_SOLD, code: 'vin_sold', vehicle: r.vehicle });
  }

  /**
   * Same stock number on another published vehicle of this dealership (drafts and sold vehicles are not counted):
   * trimmed, case-insensitive. exceptId = the vehicle being edited.
   */
  async stockCheck(tenantId: string, raw: unknown, exceptId?: string) {
    const stock = clean(raw, 40).trim();
    if (!stock) return { stock, status: 'none' as const, vehicle: null };
    const hit = await this.prisma.vehicle.findFirst({
      where: { tenantId, stockNumber: { equals: stock, mode: 'insensitive' }, status: 'PUBLISHED', ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true, year: true, make: true, model: true, trim: true, status: true, stockNumber: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!hit) return { stock, status: 'none' as const, vehicle: null };
    return { stock, status: 'active' as const, vehicle: { ...hit, name: vehicleName(hit) } };
  }

  /** publishing (or saving a published vehicle) with a stock number another published vehicle uses: 400 */
  private async assertStockFree(tenantId: string, stock: unknown, exceptId?: string) {
    const r = await this.stockCheck(tenantId, stock, exceptId);
    if (r.status === 'active') throw new BadRequestException({ message: stockInUse(r.stock, r.vehicle), code: 'stock_in_use', vehicle: r.vehicle });
  }

  async create(tenantId: string, body: Record<string, unknown>, user: AuthUser) {
    const data = cleanVehicleInput(body) as Record<string, unknown>;
    if (!data.status) data.status = 'PUBLISHED';
    this.check(data);
    if (data.vin) await this.assertVinFree(tenantId, data.vin);
    if (data.status === 'PUBLISHED' && data.stockNumber) await this.assertStockFree(tenantId, data.stockNumber);
    const slug = await this.uniqueSlug(tenantId, String(data.slug || vehicleName(data as never) || 'vehicle'));
    const v = await this.prisma.vehicle.create({ data: { ...(data as Prisma.VehicleUncheckedCreateInput), tenantId, slug } });
    await this.audit.record('vehicle.create', { tenantId, actor: user.login, detail: { id: v.id, name: vehicleName(v) } });
    if (v.status === 'PUBLISHED') await this.tenants.setOnboarding(tenantId, 'first_vehicle');
    await this.changed(tenantId, user);
    await this.convertLinks(tenantId, [{ vehicleId: v.id, urls: v.images }], user);
    return this.serialize(v);
  }

  /**
   * Web photo links on a saved vehicle (pasted links, API, older vehicles) → the dealer's own .jpeg photos, in the
   * background (the save does not wait; a link that cannot be downloaded stays as it is).
   */
  private async convertLinks(tenantId: string, items: { vehicleId: string; urls: string[] }[], user: AuthUser, enhance = false) {
    if (!items.some((i) => i.urls.some((u) => PhotoJobsService.external(u, tenantId)))) return null;
    return this.photoJobs.start(tenantId, items, user, { enhance }, () => this.changed(tenantId, user)).catch((e: Error) => ({ job: null, note: e.message }));
  }

  async update(tenantId: string, id: string, body: Record<string, unknown>, user: AuthUser) {
    const cur = await this.get(tenantId, id);
    const data = cleanVehicleInput(body) as Record<string, unknown>;
    if (data.status === cur.status) delete data.soldAt;
    this.check({ ...cur, ...data });
    // a changed VIN must not belong to another vehicle (in the inventory or sold)
    if (data.vin && normVin(data.vin) !== normVin(cur.vin)) await this.assertVinFree(tenantId, data.vin, id);
    // a published vehicle (published now, or kept published) needs a stock number no other published vehicle has
    const status = (data.status ?? cur.status) as string;
    const stock = 'stockNumber' in data ? data.stockNumber : cur.stockNumber;
    const stockChanged = 'stockNumber' in data && String(data.stockNumber || '').trim().toLowerCase() !== String(cur.stockNumber || '').trim().toLowerCase();
    if (status === 'PUBLISHED' && stock && (stockChanged || cur.status !== 'PUBLISHED')) await this.assertStockFree(tenantId, stock, id);
    if (data.slug) data.slug = await this.uniqueSlug(tenantId, String(data.slug), id);
    const v = await this.prisma.vehicle.update({ where: { id }, data });
    await this.audit.record('vehicle.update', { tenantId, actor: user.login, detail: { id, name: vehicleName(v), fields: Object.keys(data) } });
    if (v.status === 'PUBLISHED') await this.tenants.setOnboarding(tenantId, 'first_vehicle');
    await this.changed(tenantId, user);
    if ('images' in data) await this.convertLinks(tenantId, [{ vehicleId: v.id, urls: v.images }], user);
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
      case 'publish': {
        // vehicles without photos can be published too (photos can be added later); a vehicle whose stock number
        // another published vehicle (or one earlier in this selection) already uses is left as it is ("skipped")
        const picked = await this.prisma.vehicle.findMany({ where, select: { id: true, stockNumber: true } });
        const ok: string[] = [];
        const seen = new Set<string>();
        for (const v of picked) {
          const s = String(v.stockNumber || '').trim().toLowerCase();
          if (s && (seen.has(s) || (await this.stockCheck(tenantId, v.stockNumber, v.id)).status === 'active')) continue;
          if (s) seen.add(s);
          ok.push(v.id);
        }
        count = ok.length ? (await this.prisma.vehicle.updateMany({ where: { tenantId, id: { in: ok } }, data: { status: 'PUBLISHED', soldAt: null } })).count : 0;
        break;
      }
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
   * Only the website's own save rules apply here (a name to save it under, a believable year): CarGurus and
   * Facebook Marketplace requirements never block or skip a row, whichever channels are on. Channel checks happen
   * in the portal preview (for the channels switched on) and later in each channel's own feed / posting step.
   * Existing vehicles are matched by VIN, then stock number, and updated with the non-empty values of the row;
   * their other fields (and photos when the row has none) are kept. New vehicles: the row's status when the file
   * has one, otherwise published (with or without photos).
   */
  async import(tenantId: string, body: { rows?: Record<string, unknown>[]; mode?: 'publish' | 'draft'; enhancePhotos?: boolean }, user: AuthUser) {
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : [];
    /** every photo link of the file becomes a .jpeg on this server; + white studio background unless switched off */
    const enhance = body.enhancePhotos !== false;
    const photoItems: { vehicleId: string; urls: string[] }[] = [];
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
          if (extra) data.extra = { ...(cur?.extra && typeof cur.extra === 'object' ? (cur.extra as Record<string, string>) : {}), ...extra };
          await this.prisma.vehicle.update({ where: { id }, data: data as Prisma.VehicleUncheckedUpdateInput });
          if (imgs.length) photoItems.push({ vehicleId: id, urls: imgs });
          res.updated++;
        } else {
          // published unless the file says otherwise (or the import is "as drafts"): missing photos do not matter
          let status = (data.status as VehicleStatus | undefined) ?? 'PUBLISHED';
          if (body.mode === 'draft') status = 'DRAFT';
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
          if (imgs.length) photoItems.push({ vehicleId: v.id, urls: imgs });
          res.created++;
        }
      } catch (e) {
        res.skipped.push({ row: rowNo, reason: (e as Error).message });
      }
    }
    await this.audit.record('vehicle.import', { tenantId, actor: user.login, detail: { created: res.created, updated: res.updated, skipped: res.skipped.length } });
    const channels = await this.cargurus.channels(tenantId).catch(() => null);
    if (res.created || res.updated) {
      if (await this.prisma.vehicle.count({ where: { tenantId, status: 'PUBLISHED' } })) await this.tenants.setOnboarding(tenantId, 'first_vehicle');
      await this.changed(tenantId, user);
    }
    // photo links → .jpeg photos on this server (+ white studio background), in the background (the answer does not wait)
    const photoJob: { job: PhotoJob | null; note: string } | null = photoItems.length ? await this.convertLinks(tenantId, photoItems, user, enhance) : null;
    return { ...res, channels, photoJob };
  }

  /** Progress of the Auto White Studio Background job of the last import */
  photoJob(tenantId: string) {
    return { job: this.photoJobs.status(tenantId) };
  }
}
