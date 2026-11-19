import { BadRequestException } from '@nestjs/common';
import { clean, cleanMl, int, num, strArray } from '../common/util.js';
import type { Prisma, VehicleStatus } from '../generated/prisma/client.js';

/** Text fields of a vehicle and their max length (API name = database column). */
export const VEHICLE_TEXT: Record<string, number> = {
  title: 200,
  metaTitle: 200,
  metaDescription: 320,
  make: 60,
  model: 80,
  trim: 80,
  vehicleType: 40,
  bodyStyle: 40,
  condition: 20,
  stockNumber: 40,
  vin: 17,
  exteriorColor: 60,
  interiorColor: 60,
  engine: 80,
  horsepower: 20,
  drivetrain: 60,
  transmission: 60,
  fuelType: 40,
  mpg: 40,
  fuelTank: 20,
  doors: 10,
  seats: 10,
  owners: 10,
  accidents: 10,
  dealLabel: 80,
};

/** Fields the dealer can make required in Inventory > Field rules (key → label). */
export const RULE_FIELDS: Record<string, string> = {
  year: 'Year',
  make: 'Make',
  model: 'Model',
  trim: 'Trim',
  price: 'Price',
  mileage: 'Mileage',
  vin: 'VIN',
  stockNumber: 'Stock number',
  exteriorColor: 'Exterior color',
  interiorColor: 'Interior color',
  transmission: 'Transmission',
  engine: 'Engine',
  drivetrain: 'Drivetrain',
  fuelType: 'Fuel type',
  bodyStyle: 'Body style',
  vehicleType: 'Vehicle type',
  description: 'Description',
  images: 'At least one photo',
};

export const DEFAULT_RULES: Record<string, 'required'> = {
  year: 'required',
  make: 'required',
  model: 'required',
  price: 'required',
  mileage: 'required',
  images: 'required',
};

/** CarGurus needs these too ("Use CarGurus required set"). */
export const CARGURUS_RULES = ['year', 'make', 'model', 'trim', 'price', 'mileage', 'vin', 'stockNumber', 'exteriorColor', 'transmission', 'description', 'images'];

const STATUSES: VehicleStatus[] = ['PUBLISHED', 'DRAFT', 'SOLD'];

export function cleanImageList(v: unknown): string[] {
  return strArray(v, 60, 600).filter((u) => u.startsWith('/uploads/') || /^https?:\/\//i.test(u));
}

/** true / false from JSON, a form or a CSV ("false", "0", "no", "off" = false) */
function bool(v: unknown): boolean {
  if (typeof v === 'string') return !/^(false|0|no|off|)$/i.test(v.trim());
  return !!v;
}

/** VINs are compared trimmed and upper-case (spaces and dashes removed). */
export function normVin(v: unknown): string {
  return String(v ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
}

/** "Pickup Truck" / "Pickup" / "Pick-up" (older vehicles, imports, VIN records) are saved as "Truck". */
export function normBodyStyle(v: unknown): string {
  const s = String(v ?? '').trim();
  return /^pick[\s-]?up(\s+truck)?$/i.test(s) ? 'Truck' : s;
}

/** Validates vehicle input from the admin. Only keys present in `b` are returned (PATCH friendly). */
export function cleanVehicleInput(b: Record<string, unknown>): Prisma.VehicleUncheckedUpdateInput {
  const d: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(VEHICLE_TEXT)) if (k in b) d[k] = clean(b[k], max);
  if ('vin' in d) d.vin = normVin(d.vin);
  if ('bodyStyle' in d) d.bodyStyle = normBodyStyle(d.bodyStyle);
  // the dealer's own stock number, as typed (never generated)
  if ('stockNumber' in b || 'stockNo' in b || 'stock_no' in b) d.stockNumber = clean(b.stockNumber ?? b.stockNo ?? b.stock_no, VEHICLE_TEXT.stockNumber);
  if ('description' in b) d.description = cleanMl(b.description, 8000);
  if ('year' in b) {
    const y = int(b.year);
    // a year that cannot be right is left empty instead of refusing the vehicle
    d.year = y !== null && (y < 1900 || y > new Date().getFullYear() + 2) ? null : y;
  }
  if ('price' in b) d.price = num(b.price);
  if ('msrp' in b) d.msrp = num(b.msrp);
  if ('mileage' in b) d.mileage = int(b.mileage);
  if ('certified' in b) d.certified = b.certified === true || b.certified === 'Yes' || b.certified === 'true';
  if ('featured' in b) d.featured = !!b.featured;
  // syndication: off = the vehicle stays on the website only for that channel (website-only when both are off)
  if ('syndicateCargurus' in b) d.syndicateCargurus = bool(b.syndicateCargurus);
  if ('syndicateFacebook' in b) d.syndicateFacebook = bool(b.syndicateFacebook);
  if ('features' in b) d.features = strArray(b.features, 150, 120);
  if ('safetyFeatures' in b) d.safetyFeatures = strArray(b.safetyFeatures, 150, 120);
  if ('images' in b) d.images = cleanImageList(b.images);
  if ('extra' in b && b.extra && typeof b.extra === 'object') d.extra = b.extra;
  if ('processingFee' in b || 'processing_fee' in b) {
    const rawVal = b.processingFee !== undefined ? b.processingFee : b.processing_fee;
    const feeNum = num(rawVal);
    const prevExtra = (d.extra && typeof d.extra === 'object' ? d.extra : b.extra && typeof b.extra === 'object' ? b.extra : {}) as Record<string, unknown>;
    d.extra = { ...prevExtra, ...(feeNum !== null && feeNum !== undefined && feeNum > 0 ? { processingFee: feeNum } : { processingFee: 0 }) };
  }
  if ('status' in b) {
    const s = String(b.status).toUpperCase() as VehicleStatus;
    if (!STATUSES.includes(s)) throw new BadRequestException('Unknown status');
    d.status = s;
    d.soldAt = s === 'SOLD' ? new Date() : null;
  }
  if ('slug' in b && b.slug) d.slug = clean(b.slug, 80);
  return d as Prisma.VehicleUncheckedUpdateInput;
}

export function vehicleName(v: { year?: number | null; make?: string; model?: string; trim?: string }) {
  return [v.year || '', v.make || '', v.model || '', v.trim || ''].join(' ').replace(/\s+/g, ' ').trim();
}

/** Required-field check (skipped for drafts when skipDraft is on). Returns the missing field labels. */
export function missingRequired(v: Record<string, unknown>, rules: Record<string, string>, skipDraft: boolean): string[] {
  if (skipDraft && v.status === 'DRAFT') return [];
  const missing: string[] = [];
  for (const [k, r] of Object.entries(rules)) {
    if (r !== 'required' || !RULE_FIELDS[k]) continue;
    const val = v[k];
    const empty = val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
    if (empty) missing.push(RULE_FIELDS[k]);
  }
  return missing;
}

/**
 * Saving rules (manual add / edit, CSV import, AI import): a vehicle only needs something to recognise it by —
 * a make, a model or a VIN. Photos, price, mileage, VIN format, trim, body style … are NOT required (not for the
 * website and not for CarGurus): with CarGurus on in Business details every vehicle goes into the CarGurus feed as it
 * is, missing details as empty columns. Facebook Marketplace checks live in the portal / posting step and are unchanged.
 */
export function publishProblems(v: Record<string, unknown>): string {
  const empty = (x: unknown) => x === null || x === undefined || String(x).trim() === '';
  if (empty(v.make) && empty(v.model) && empty(v.vin)) return 'Enter at least a make, model or VIN.';
  return '';
}
