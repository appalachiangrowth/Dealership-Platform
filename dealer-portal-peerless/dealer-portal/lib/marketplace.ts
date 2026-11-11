/**
 * Facebook Marketplace: the vehicle fields a listing needs. A vehicle that has all of them is
 * "Marketplace ready" — the FB button can list it on Marketplace straight away.
 * (The backend checks the same fields before it publishes: backend/src/facebook/fb-copy.ts › validate.)
 */
export const MP_FIELDS: [field: string, label: string][] = [
  ['year', 'Year'],
  ['make', 'Make'],
  ['model', 'Model'],
  ['price', 'Price'],
  ['images', 'Image URLs'],
  ['mileage', 'Mileage'],
  ['bodyStyle', 'Body style'],
  ['exteriorColor', 'Exterior color'],
  ['interiorColor', 'Interior color'],
];
export const MP_REQ_N = MP_FIELDS.length;

type VehicleLike = Record<string, any>;

const filled = (x: unknown) => String(x ?? '').trim() !== '';

/** labels of the Marketplace fields this vehicle is missing (empty = Marketplace ready) */
export function mpMissing(v: VehicleLike | null | undefined): string[] {
  if (!v) return MP_FIELDS.map((f) => f[1]);
  const out: string[] = [];
  const year = Number(v.year);
  if (!(year >= 1900 && year <= new Date().getFullYear() + 2)) out.push('Year');
  if (!filled(v.make)) out.push('Make');
  if (!filled(v.model)) out.push('Model');
  if (!(Number(String(v.price ?? '').replace(/[^0-9.]/g, '')) > 0)) out.push('Price');
  const imgs = Array.isArray(v.images) ? v.images.filter(filled) : [];
  if (!imgs.length) out.push('Image URLs');
  // Marketplace does not take 0 miles: the mileage must be a number above 0
  if (!(Number(String(v.mileage ?? '').replace(/[,\s]/g, '')) > 0)) out.push('Mileage');
  if (!filled(v.bodyStyle) && !filled(v.vehicleType)) out.push('Body style');
  if (!filled(v.exteriorColor)) out.push('Exterior color');
  if (!filled(v.interiorColor)) out.push('Interior color');
  return out;
}

export const mpReady = (v: VehicleLike | null | undefined) => mpMissing(v).length === 0;

/** label → the inventory editor field to open for "Fix" */
export const MP_FIX: Record<string, string> = Object.fromEntries(MP_FIELDS.map(([f, l]) => [l, f]));
