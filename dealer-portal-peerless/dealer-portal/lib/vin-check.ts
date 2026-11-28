/**
 * Duplicate VIN check (same rules as the API: trimmed, upper-case) and the "Truck" body style.
 * The API refuses a VIN that is already in the inventory or was sold (409); the forms check it while typing.
 */
import { api } from './api';

export const VIN_IN_INVENTORY = 'A vehicle with this VIN is already in your inventory.';
export const VIN_SOLD = 'This vehicle (VIN) has already been sold.';

export type VinDup = { status: 'active' | 'sold'; message: string; vehicle: { id: string; name: string; status: string } };

export const normVin = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

/** null = this VIN is free (or the check could not run; the API checks again on save) */
export async function checkVin(vin: string, exceptId?: string): Promise<VinDup | null> {
  const v = normVin(vin);
  if (!v) return null;
  try {
    const r = await api<{ status: 'none' | 'active' | 'sold'; vehicle: { id: string; name: string; status: string } | null }>(
      `/dealer/vehicles/vin-check?vin=${encodeURIComponent(v)}${exceptId ? `&id=${encodeURIComponent(exceptId)}` : ''}`,
    );
    if (r.status === 'none' || !r.vehicle) return null;
    return { status: r.status, message: r.status === 'sold' ? VIN_SOLD : VIN_IN_INVENTORY, vehicle: r.vehicle };
  } catch {
    return null;
  }
}

/** body styles offered in the forms ("Pickup Truck" is now "Truck") */
export const BODY_STYLES = ['SUV', 'Sedan', 'Truck', 'Hatchback', 'Coupe', 'Convertible', 'Wagon', 'Minivan', 'Van / Passenger Van', 'Cargo Van'];

/** older vehicles saved as "Pickup Truck" / "Pickup" show (and save) as "Truck" */
export const normBodyStyle = (v: unknown) => {
  const s = String(v ?? '').trim();
  return /^pick[\s-]?up(\s+truck)?$/i.test(s) ? 'Truck' : s;
};

/** drivetrains offered in the Add and Edit forms (the VIN decoder and AI use the same names) */
export const DRIVETRAINS = ['Front-Wheel Drive', 'Rear-Wheel Drive', 'All-Wheel Drive', 'Four-Wheel Drive', 'Two-Wheel Drive'];

/** short / older drivetrain values (FWD, 2WD, 4x4 …) show and save as one of DRIVETRAINS; anything else stays as it is */
export const normDrive = (v: unknown) => {
  const s = String(v ?? '').trim();
  const x = s.toLowerCase();
  if (!x) return '';
  if (/^(awd|all[\s-]?wheel( drive)?)$/.test(x)) return 'All-Wheel Drive';
  if (/^(4wd|4x4|4-?wheel( drive)?|four[\s-]?wheel( drive)?)$/.test(x)) return 'Four-Wheel Drive';
  if (/^(fwd|front[\s-]?wheel( drive)?)$/.test(x)) return 'Front-Wheel Drive';
  if (/^(rwd|rear[\s-]?wheel( drive)?)$/.test(x)) return 'Rear-Wheel Drive';
  if (/^(2wd|4x2|2-?wheel( drive)?|two[\s-]?wheel( drive)?( \(2wd\))?)$/.test(x)) return 'Two-Wheel Drive';
  return s;
};

/* ---------------- duplicate stock number (published vehicles; trimmed, case-insensitive) ---------------- */
export type StockDup = { message: string; vehicle: { id: string; name: string; status: string; year?: number | string | null; make?: string | null; model?: string | null } };

/**
 * Any vehicle-like object (a Vehicle, the stock-check API's { id, name, status, year?, make?, model? }…).
 * Typed as `object` on purpose: an all-optional type like { year?, make?, model? } is a TypeScript "weak type"
 * and rejects objects that share none of those keys at compile time.
 */
type VehicleLike = object | null | undefined;

/** "2019 Honda Accord": year, make and model only (never the trim) */
export const yearMakeModel = (vehicle: VehicleLike) => {
  const v = (vehicle ?? {}) as { year?: unknown; make?: unknown; model?: unknown };
  return [v.year, v.make, v.model].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
};

/** the error under Stock number: names the other vehicle by year, make and model (no trim) */
export const stockInUse = (stock: string, v: VehicleLike) => {
  const ymm = yearMakeModel(v);
  return `Stock number ${stock} is already assigned to ${ymm ? `a ${ymm}` : 'another vehicle'}. Please enter a different stock number to proceed.`;
};
/** matches the stock number error from the API (current and older wording) */
export const STOCK_TAKEN_RE = /^Stock number .* is already (in use|assigned)/;

/** null = the stock number is free (or the check could not run; the API checks again when publishing) */
export async function checkStock(stock: string, exceptId?: string): Promise<StockDup | null> {
  const s = String(stock ?? '').trim();
  if (!s) return null;
  try {
    const r = await api<{ stock: string; status: 'none' | 'active'; vehicle: StockDup['vehicle'] | null }>(
      `/dealer/vehicles/stock-check?stock=${encodeURIComponent(s)}${exceptId ? `&id=${encodeURIComponent(exceptId)}` : ''}`,
    );
    if (r.status !== 'active' || !r.vehicle) return null;
    return { message: stockInUse(s, r.vehicle), vehicle: r.vehicle };
  } catch {
    return null;
  }
}
