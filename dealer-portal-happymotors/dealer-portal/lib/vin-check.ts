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
