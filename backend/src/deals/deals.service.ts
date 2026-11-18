import { BadRequestException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { VehiclesService } from '../vehicles/vehicles.service.js';
import { clean, cleanMl, randomHex } from '../common/util.js';
import { aiAllowed, aiConfig, AiError, claudeCall, claudeText, extractJson, oaiCall } from '../ai/ai.provider.js';
import type { AuthUser } from '../common/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toDealDoc } from './deal-doc.js';
import { computeTotals, VA_SUT_RATE } from './deal-math.js';
import { autoMap, DEAL_KEYS, DEAL_KEY_MAP } from './deal-keys.js';
import { buildForm, buildPacket, FORM_KINDS, FORM_TITLES, type FormKind, type OfficialForm } from './pdf/index.js';
import { readPdfFields } from './pdf/vsa17a.js';

/** official fillable PDFs live outside /uploads (not public) */
export const STATE_FORMS_ROOT = join(process.cwd(), 'storage', 'state-forms');

const PAYMENT = ['CASH', 'FINANCE', 'OUTSIDE_LIEN'] as const;
const ODO = ['ACTUAL', 'EXCEEDS_LIMITS', 'NOT_ACTUAL'] as const;
const PURPOSE = ['TITLE_AND_REGISTRATION', 'TITLE_ONLY', 'TRANSFER_PLATE'] as const;

const TEXT: Record<string, number> = {
  buyerFullName: 160, buyerFirstName: 80, buyerMiddleName: 80, buyerLastName: 80, buyerEmail: 160, buyerPhone: 40,
  buyerAddress: 200, buyerCity: 80, buyerState: 2, buyerZip: 10, buyerCounty: 80, buyerLicenseNumber: 40, buyerLicenseState: 2,
  coBuyerFullName: 160, coBuyerAddress: 240, coBuyerPhone: 40, coBuyerLicenseNumber: 40,
  lienholderName: 160, lienholderAddress: 240, otherFeesLabel: 80,
  warrantyDuration: 160, warrantySystemsCovered: 400, warrantyLaborPct: 3, warrantyPartsPct: 3,
  stateCode: 2, plateNumber: 12, gvwr: 20,
};
const DATES = ['buyerDob', 'buyerLicenseExpiry', 'lienDate'];
const MONEY = ['salePrice', 'tradeInAllowance', 'tradeInPayoff', 'docFee', 'titleRegFee', 'otherFees', 'salesTaxAmount', 'downPayment'];
const UPPER = ['buyerState', 'buyerLicenseState', 'stateCode', 'plateNumber'];

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** "MM/DD/YYYY", "YYYY-MM-DD", "MMDDYYYY" → "YYYY-MM-DD" ("" when it is not a date) */
export function toYmd(v: unknown): string {
  const s = clean(v, 20);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return '';
}

/** browser body → Deal columns (only the keys that were sent) */
function cleanDeal(b: Record<string, unknown>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(TEXT)) if (k in b) d[k] = UPPER.includes(k) ? clean(b[k], max).toUpperCase() : clean(b[k], max);
  for (const k of DATES) if (k in b) d[k] = toYmd(b[k]);
  for (const k of MONEY) if (k in b) d[k] = Math.min(99_999_999, Math.max(0, r2(num(b[k]))));
  if ('salesTaxRate' in b) d.salesTaxRate = Math.min(20, Math.max(0, num(b.salesTaxRate)));
  if ('salesTaxManual' in b) d.salesTaxManual = !!b.salesTaxManual;
  if ('serviceContract' in b) d.serviceContract = !!b.serviceContract;
  if ('saleDate' in b) {
    const y = toYmd(b.saleDate);
    if (y) d.saleDate = new Date(`${y}T12:00:00Z`);
  }
  if ('paymentMethod' in b) d.paymentMethod = PAYMENT.includes(b.paymentMethod as never) ? b.paymentMethod : 'CASH';
  if ('odometerStatus' in b) d.odometerStatus = ODO.includes(b.odometerStatus as never) ? b.odometerStatus : 'ACTUAL';
  if ('odometerReading' in b) {
    const n = Math.trunc(num(b.odometerReading));
    d.odometerReading = b.odometerReading === '' || b.odometerReading === null || n < 0 ? null : Math.min(n, 9_999_999);
  }
  if ('warrantyType' in b) d.warrantyType = b.warrantyType === 'WARRANTY' ? 'WARRANTY' : 'AS_IS';
  if ('warrantyKind' in b) d.warrantyKind = b.warrantyKind === 'FULL' ? 'FULL' : 'LIMITED';
  if ('titlePurpose' in b) d.titlePurpose = PURPOSE.includes(b.titlePurpose as never) ? b.titlePurpose : 'TITLE_AND_REGISTRATION';
  if ('notes' in b) d.notes = cleanMl(b.notes, 2000);
  if ('tradeInVehicle' in b) {
    const t = (b.tradeInVehicle && typeof b.tradeInVehicle === 'object' ? b.tradeInVehicle : {}) as Record<string, unknown>;
    d.tradeInVehicle = {
      year: clean(t.year, 4),
      make: clean(t.make, 40),
      model: clean(t.model, 60),
      vin: clean(t.vin, 17).toUpperCase(),
      mileage: clean(t.mileage, 10),
    };
  }
  return d;
}

/** made-up values for "Test fill" (every field shows what it will be filled with) */
const SAMPLE_DEALER = { name: 'Sample Motors', legalName: 'Sample Motors LLC', street: '100 Dealer Row', city: 'Richmond', state: 'VA', zip: '23220', phone: '(555) 010-0100', email: 'sales@example.com', dealerLicenseNumber: 'SAMPLE-LIC' };
const SAMPLE_DEAL: Record<string, unknown> = {
  dealNumber: 'D-SAMPLE', status: 'DRAFT', saleDate: new Date(),
  buyerFullName: 'Sample A Buyer', buyerFirstName: 'Sample', buyerMiddleName: 'A', buyerLastName: 'Buyer', buyerEmail: 'buyer@example.com', buyerPhone: '(555) 010-0200',
  buyerAddress: '200 Example St', buyerCity: 'Richmond', buyerState: 'VA', buyerZip: '23221', buyerCounty: 'Richmond City', buyerDob: '1990-01-01',
  buyerLicenseNumber: 'SAMPLE-DL', buyerLicenseState: 'VA', coBuyerFullName: 'Sample Co-Buyer', coBuyerLicenseNumber: 'SAMPLE-DL2',
  salePrice: 15000, tradeInAllowance: 2000, docFee: 500, titleRegFee: 75, salesTaxRate: 4.15, salesTaxAmount: 643.25, totalPrice: 14218.25, balanceDue: 14218.25,
  paymentMethod: 'FINANCE', lienholderName: 'Sample Lender', lienholderAddress: '300 Bank Ave, Richmond, VA 23219', lienDate: new Date().toISOString().slice(0, 10),
  odometerReading: 45678, odometerStatus: 'ACTUAL', warrantyType: 'AS_IS', stateCode: 'VA', titlePurpose: 'TITLE_AND_REGISTRATION', gvwr: '4000',
  vehicleSnapshot: { year: 2020, make: 'Sample', model: 'Sedan', bodyStyle: 'Sedan', exteriorColor: 'Blue', vin: 'SAMPLEVIN00000000', stockNumber: 'S1', fuelType: 'Gasoline' },
};

const LICENSE_PROMPT = `This is a photo of the FRONT of a US driver's license or state ID card. Read it and reply with ONLY this JSON:
{"firstName":"","middleName":"","lastName":"","address":"","city":"","state":"","zip":"","dob":"YYYY-MM-DD","licenseNumber":"","licenseState":"","expiry":"YYYY-MM-DD"}
Use "" for anything you cannot read. state and licenseState are 2-letter codes. Do not guess.`;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vehicles: VehiclesService,
  ) {}

  /* ---------------- deals ---------------- */

  async list(tenantId: string, q: { status?: string; search?: string; vehicleId?: string }) {
    const where: Prisma.DealWhereInput = { tenantId };
    if (q.status === 'DRAFT' || q.status === 'COMPLETED') where.status = q.status;
    if (q.vehicleId) where.vehicleId = clean(q.vehicleId, 60);
    const s = clean(q.search, 80);
    if (s)
      where.OR = [
        { dealNumber: { contains: s, mode: 'insensitive' } },
        { buyerFullName: { contains: s, mode: 'insensitive' } },
        { buyerPhone: { contains: s } },
      ];
    const rows = await this.prisma.deal.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 });
    return rows.map((r) => this.serialize(r));
  }

  async get(tenantId: string, id: string) {
    return this.serialize(await this.row(tenantId, id));
  }

  private async row(tenantId: string, id: string) {
    const d = await this.prisma.deal.findFirst({ where: { id, tenantId } });
    if (!d) throw new NotFoundException('Deal not found');
    return d;
  }

  private serialize(d: Record<string, any>) {
    const out: Record<string, unknown> = { ...d };
    for (const k of [...MONEY, 'salesTaxRate', 'totalPrice', 'balanceDue']) out[k] = Number(d[k] ?? 0);
    out.saleDate = d.saleDate instanceof Date ? d.saleDate.toISOString().slice(0, 10) : d.saleDate;
    return out;
  }

  private async settings(tenantId: string) {
    return this.prisma.tenantSettings.findUnique({ where: { tenantId } });
  }

  private snapshot(v: Record<string, any>) {
    return {
      id: v.id,
      year: v.year ?? '',
      make: v.make ?? '',
      model: v.model ?? '',
      trim: v.trim ?? '',
      bodyStyle: v.bodyStyle ?? '',
      exteriorColor: v.exteriorColor ?? '',
      vin: v.vin ?? '',
      stockNumber: v.stockNumber ?? '',
      fuelType: v.fuelType ?? '',
      mileage: v.mileage ?? null,
      price: v.price === null || v.price === undefined ? null : Number(v.price),
    };
  }

  /** a new (unsaved) deal pre-filled from the vehicle and the dealership's deal defaults */
  async prefill(tenantId: string, vehicleId?: string) {
    const st = await this.settings(tenantId);
    const rate = st?.dealTaxRate !== undefined && st.dealTaxRate !== '' ? num(st.dealTaxRate) : VA_SUT_RATE;
    let vehicle: Record<string, unknown> | null = null;
    if (vehicleId) {
      const v = await this.prisma.vehicle.findFirst({ where: { id: clean(vehicleId, 60), tenantId } });
      if (!v) throw new NotFoundException('Vehicle not found');
      vehicle = this.snapshot(v);
    }
    const base = {
      vehicleId: vehicle ? (vehicle.id as string) : null,
      vehicleSnapshot: vehicle ?? {},
      saleDate: new Date().toISOString().slice(0, 10),
      status: 'DRAFT',
      stateCode: 'VA',
      buyerState: 'VA',
      buyerLicenseState: 'VA',
      salePrice: vehicle?.price ? Number(vehicle.price) : 0,
      odometerReading: (vehicle?.mileage as number | null) ?? null,
      odometerStatus: 'ACTUAL',
      docFee: num(st?.dealDocFee),
      titleRegFee: num(st?.dealTitleFee),
      salesTaxRate: rate,
      salesTaxManual: false,
      tradeInAllowance: 0,
      tradeInPayoff: 0,
      otherFees: 0,
      downPayment: 0,
      paymentMethod: 'CASH',
      warrantyType: 'AS_IS',
      warrantyKind: 'LIMITED',
      titlePurpose: 'TITLE_AND_REGISTRATION',
      tradeInVehicle: {},
    };
    const t = computeTotals({ ...base, salesTaxAmount: 0 } as never);
    return {
      deal: { ...base, ...t },
      dealer: {
        name: st?.name ?? '',
        legalName: st?.legalName ?? '',
        address: [st?.street, st?.city, [st?.state, st?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        phone: st?.phone ?? '',
        email: st?.email ?? '',
        licenseNumber: st?.dealerLicenseNumber ?? '',
      },
      forms: FORM_KINDS.map((k) => ({ kind: k, title: FORM_TITLES[k] })),
    };
  }

  /** totals are always worked out here (the browser shows the same numbers live) */
  private withTotals(cur: Record<string, any>, patch: Record<string, unknown>) {
    const m = { ...cur, ...patch } as Record<string, any>;
    const t = computeTotals({
      salePrice: num(m.salePrice),
      tradeInAllowance: num(m.tradeInAllowance),
      tradeInPayoff: num(m.tradeInPayoff),
      docFee: num(m.docFee),
      titleRegFee: num(m.titleRegFee),
      otherFees: num(m.otherFees),
      salesTaxRate: num(m.salesTaxRate),
      salesTaxAmount: num(m.salesTaxAmount),
      salesTaxManual: !!m.salesTaxManual,
      downPayment: num(m.downPayment),
      stateCode: String(m.stateCode || 'VA'),
    });
    const full = clean(m.buyerFullName, 160) || [m.buyerFirstName, m.buyerMiddleName, m.buyerLastName].map((x) => clean(x, 80)).filter(Boolean).join(' ');
    return { ...patch, ...t, buyerFullName: full };
  }

  async create(tenantId: string, body: Record<string, unknown>, user: AuthUser) {
    const data = cleanDeal(body || {});
    let snapshot: Record<string, unknown> = {};
    let vehicleId: string | null = null;
    if (body?.vehicleId) {
      const v = await this.prisma.vehicle.findFirst({ where: { id: clean(body.vehicleId, 60), tenantId } });
      if (!v) throw new NotFoundException('Vehicle not found');
      vehicleId = v.id;
      snapshot = this.snapshot(v);
    }
    const full = this.withTotals({ stateCode: 'VA', salesTaxRate: VA_SUT_RATE }, data);
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await this.prisma.deal.findFirst({ where: { tenantId }, orderBy: { dealSeq: 'desc' }, select: { dealSeq: true } });
      const seq = (last?.dealSeq ?? 0) + 1;
      try {
        const d = await this.prisma.deal.create({
          data: {
            ...(full as object),
            tenantId,
            vehicleId,
            vehicleSnapshot: snapshot as Prisma.InputJsonValue,
            dealSeq: seq,
            dealNumber: `D-${String(seq).padStart(4, '0')}`,
            createdBy: user.name || user.login || '',
          } as Prisma.DealUncheckedCreateInput,
        });
        await this.audit.record('deal.create', { tenantId, actor: user.login, detail: { id: d.id, dealNumber: d.dealNumber, vehicleId } });
        return this.serialize(d);
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') continue; // two deals at the same moment: next number
        throw e;
      }
    }
    throw new HttpException('Could not number the deal, try again.', 409);
  }

  async update(tenantId: string, id: string, body: Record<string, unknown>, user: AuthUser) {
    const cur = await this.row(tenantId, id);
    const data = this.withTotals(cur, cleanDeal(body || {}));
    if (body?.refreshVehicle && cur.vehicleId) {
      const v = await this.prisma.vehicle.findFirst({ where: { id: cur.vehicleId, tenantId } });
      if (v) (data as Record<string, unknown>).vehicleSnapshot = this.snapshot(v);
    }
    const d = await this.prisma.deal.update({ where: { id }, data: data as Prisma.DealUncheckedUpdateInput });
    await this.audit.record('deal.update', { tenantId, actor: user.login, detail: { id, dealNumber: d.dealNumber } });
    return this.serialize(d);
  }

  async remove(tenantId: string, id: string, user: AuthUser) {
    const cur = await this.row(tenantId, id);
    await this.prisma.deal.delete({ where: { id } });
    await this.audit.record('deal.delete', { tenantId, actor: user.login, detail: { id, dealNumber: cur.dealNumber } });
    return { ok: true };
  }

  /** "Generate Deal Forms": saves, marks the deal COMPLETED and (optionally) the vehicle SOLD */
  async complete(tenantId: string, id: string, body: { markSold?: unknown }, user: AuthUser) {
    const cur = await this.row(tenantId, id);
    if (!cur.buyerFullName && !cur.buyerLastName) throw new BadRequestException("Add the buyer's name before completing the deal.");
    const d = await this.prisma.deal.update({ where: { id }, data: { status: 'COMPLETED' } });
    let sold = false;
    if (body?.markSold && cur.vehicleId) {
      try {
        await this.vehicles.update(tenantId, cur.vehicleId, { status: 'SOLD' }, user);
        sold = true;
      } catch {
        // the vehicle was deleted meanwhile: the deal still completes
      }
    }
    await this.audit.record('deal.complete', { tenantId, actor: user.login, detail: { id, dealNumber: d.dealNumber, markedSold: sold } });
    return { ...this.serialize(d), vehicleMarkedSold: sold };
  }

  /* ---------------- PDFs ---------------- */

  private async official(tenantId: string, stateCode: string): Promise<OfficialForm | null> {
    const t =
      (await this.prisma.stateFormTemplate.findFirst({ where: { tenantId, stateCode, isActive: true }, orderBy: { updatedAt: 'desc' } })) ??
      (await this.prisma.stateFormTemplate.findFirst({ where: { tenantId: null, stateCode, isActive: true }, orderBy: { updatedAt: 'desc' } }));
    if (!t) return null;
    try {
      const bytes = await readFile(join(STATE_FORMS_ROOT, t.pdfUrl));
      return { bytes: new Uint8Array(bytes), mappings: (t.fieldMappings || {}) as Record<string, string> };
    } catch {
      return null;
    }
  }

  async pdf(tenantId: string, id: string, kind: string) {
    const deal = await this.row(tenantId, id);
    const doc = toDealDoc(deal, await this.settings(tenantId));
    const official = kind === 'vsa17a' || kind === 'packet' ? await this.official(tenantId, doc.stateCode) : null;
    if (kind === 'packet') return { bytes: await buildPacket(doc, official), name: `${deal.dealNumber}-deal-packet.pdf` };
    if (!FORM_KINDS.includes(kind as FormKind)) throw new NotFoundException('Unknown form');
    return { bytes: await buildForm(kind as FormKind, doc, official), name: `${deal.dealNumber}-${kind}.pdf` };
  }

  /* ---------------- driver's license front photo (AI) ---------------- */

  async readLicense(tenantId: string, body: { image?: unknown; media_type?: unknown }) {
    const data = typeof body?.image === 'string' ? body.image.replace(/^data:[^,]+,/, '') : '';
    if (data.length < 100 || data.length > 8_000_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.slice(0, 200)))
      throw new BadRequestException('Add a photo of the front of the license.');
    const mt = ['image/jpeg', 'image/png', 'image/webp'].includes(String(body.media_type)) ? String(body.media_type) : 'image/jpeg';
    const c = aiConfig();
    if (!c.key) throw new HttpException(`Reading license photos needs AI: add ${c.keyEnv} to the backend .env file.`, 503);
    if (!aiAllowed(tenantId, c.maxPerHour)) throw new HttpException('The hourly limit of AI requests has been reached. Try again later.', 429);
    try {
      let raw: any;
      if (c.oai) {
        const r = await oaiCall(
          [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mt};base64,${data}` } }, { type: 'text', text: LICENSE_PROMPT }] }],
          600,
          true,
        );
        raw = extractJson(r.text);
      } else {
        const j = await claudeCall({
          max_tokens: 600,
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mt, data } }, { type: 'text', text: LICENSE_PROMPT }] }],
        });
        raw = extractJson(claudeText(j));
      }
      const g = (k: string, max = 80) => clean(raw?.[k], max);
      return {
        firstName: g('firstName'),
        middleName: g('middleName'),
        lastName: g('lastName'),
        address: g('address', 200),
        city: g('city'),
        state: g('state', 2).toUpperCase(),
        zip: g('zip', 10),
        dob: toYmd(raw?.dob),
        licenseNumber: g('licenseNumber', 40),
        licenseState: g('licenseState', 2).toUpperCase(),
        expiry: toYmd(raw?.expiry),
      };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof AiError) throw new HttpException(e.message, e.status);
      throw new HttpException('Could not read the license photo. Try a sharper photo or type the details.', 502);
    }
  }

  /* ---------------- official state forms (VSA 17A) ---------------- */

  keys() {
    return DEAL_KEYS.map((k) => ({ key: k.key, label: k.label, group: k.group, bool: !!k.bool }));
  }

  /** tenantId null = the platform's copy for every dealership */
  async templates(tenantId: string | null) {
    const rows = await this.prisma.stateFormTemplate.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    const global = tenantId
      ? await this.prisma.stateFormTemplate.findFirst({ where: { tenantId: null, isActive: true }, orderBy: { updatedAt: 'desc' } })
      : null;
    return { templates: rows, global, keys: this.keys() };
  }

  async uploadTemplate(tenantId: string | null, file: { buffer: Buffer; originalname?: string } | undefined, body: Record<string, unknown>, user: AuthUser) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose the fillable PDF first.');
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('That file is not a PDF.');
    let fields: { name: string; type: string }[];
    try {
      fields = await readPdfFields(new Uint8Array(file.buffer));
    } catch {
      throw new BadRequestException('This PDF could not be read. Use the fillable PDF from the DMV website.');
    }
    if (!fields.length) throw new BadRequestException('This PDF has no fillable fields. Upload the fillable (AcroForm) version of the form.');
    const stateCode = clean(body.stateCode, 2).toUpperCase() || 'VA';
    const dir = tenantId || '_global';
    const rel = `${dir}/${stateCode.toLowerCase()}-${randomHex(6)}.pdf`;
    await mkdir(join(STATE_FORMS_ROOT, dir), { recursive: true });
    await writeFile(join(STATE_FORMS_ROOT, rel), file.buffer);
    // one active form per state and owner
    await this.prisma.stateFormTemplate.updateMany({ where: { tenantId, stateCode }, data: { isActive: false } });
    const t = await this.prisma.stateFormTemplate.create({
      data: {
        tenantId,
        stateCode,
        formName: clean(body.formName, 200) || undefined,
        pdfUrl: rel,
        pdfFields: fields as unknown as Prisma.InputJsonValue,
        fieldMappings: autoMap(fields),
        isActive: true,
        uploadedBy: user.login,
      },
    });
    await this.audit.record('deal.form-template.upload', { tenantId, actor: user.login, detail: { id: t.id, stateCode, fields: fields.length } });
    return t;
  }

  private async template(tenantId: string | null, id: string) {
    const t = await this.prisma.stateFormTemplate.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException('Form not found');
    return t;
  }

  async updateTemplate(tenantId: string | null, id: string, body: Record<string, unknown>, user: AuthUser) {
    const t = await this.template(tenantId, id);
    const data: Prisma.StateFormTemplateUpdateInput = {};
    if ('formName' in body) data.formName = clean(body.formName, 200);
    if ('isActive' in body) {
      data.isActive = !!body.isActive;
      if (body.isActive) await this.prisma.stateFormTemplate.updateMany({ where: { tenantId, stateCode: t.stateCode, NOT: { id } }, data: { isActive: false } });
    }
    if (body.autoMap) data.fieldMappings = autoMap((t.pdfFields || []) as { name: string; type: string }[]);
    else if (body.fieldMappings && typeof body.fieldMappings === 'object') {
      const names = new Set(((t.pdfFields || []) as { name: string }[]).map((f) => f.name));
      const m: Record<string, string> = {};
      for (const [k, v] of Object.entries(body.fieldMappings as Record<string, unknown>))
        if (names.has(k) && typeof v === 'string' && DEAL_KEY_MAP.has(v)) m[k] = v;
      data.fieldMappings = m;
    }
    const out = await this.prisma.stateFormTemplate.update({ where: { id }, data });
    await this.audit.record('deal.form-template.update', { tenantId, actor: user.login, detail: { id } });
    return out;
  }

  async removeTemplate(tenantId: string | null, id: string, user: AuthUser) {
    const t = await this.template(tenantId, id);
    await this.prisma.stateFormTemplate.delete({ where: { id } });
    await unlink(join(STATE_FORMS_ROOT, t.pdfUrl)).catch(() => undefined);
    await this.audit.record('deal.form-template.delete', { tenantId, actor: user.login, detail: { id } });
    return { ok: true };
  }

  /** the blank uploaded PDF (to check it), a test fill with made-up sample data, or a test fill with a deal */
  async templatePdf(tenantId: string | null, id: string, dealTenant?: string, dealId?: string, sample = false) {
    const t = await this.template(tenantId, id);
    const bytes = new Uint8Array(await readFile(join(STATE_FORMS_ROOT, t.pdfUrl)));
    if (sample) {
      const doc = toDealDoc(SAMPLE_DEAL, tenantId ? await this.settings(tenantId) : SAMPLE_DEALER);
      return { bytes: await buildForm('vsa17a', doc, { bytes, mappings: (t.fieldMappings || {}) as Record<string, string> }), name: `${t.stateCode}-sample.pdf` };
    }
    if (dealTenant && dealId) {
      const deal = await this.row(dealTenant, dealId);
      const doc = toDealDoc(deal, await this.settings(dealTenant));
      return { bytes: await buildForm('vsa17a', doc, { bytes, mappings: (t.fieldMappings || {}) as Record<string, string> }), name: `${t.stateCode}-test.pdf` };
    }
    return { bytes, name: `${t.stateCode}-form.pdf` };
  }
}
