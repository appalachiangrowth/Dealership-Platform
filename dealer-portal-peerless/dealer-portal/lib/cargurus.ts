/**
 * CarGurus readiness of a vehicle — the same rules as the CarGurus feed check on the server
 * (backend/src/cargurus/ingestion.ts) and the old portal's cgIssues(). Used for the live checklist in the
 * vehicle editor and the Import check. Only vehicles for sale go to CarGurus.
 */

export type CgProblem = { f: string; label: string; m: string };

/** The 12 details CarGurus requires, in CarGurus order: [editor field, CarGurus name, help]. */
export const CG_ITEMS: [string, string, string][] = [
  ['vin', 'VIN', '17 letters/digits, no I, O or Q'],
  ['make', 'Make', 'e.g. Ford'],
  ['model', 'Model', 'e.g. F-150'],
  ['year', 'Year', '4 digits'],
  ['trim', 'Trim', 'e.g. XLT SuperCrew'],
  ['price', 'Price', 'more than $0'],
  ['mileage', 'Mileage', 'whole number'],
  ['images', 'Photos', 'at least one, JPG / PNG / GIF'],
  ['exteriorColor', 'Exterior Color', 'e.g. Silver'],
  ['description', 'Dealer comments', 'the description of the vehicle'],
  ['stockNumber', 'Stock Number', 'your own unique number'],
  ['transmission', 'Transmission Type', 'e.g. Automatic'],
];

export const CG_IMG_OK = ['jpg', 'jpeg', 'png', 'gif'];

export function photoExt(u: string): string {
  return ((String(u).split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1] || '').toLowerCase();
}

type V = Record<string, any>;

/** Every CarGurus problem of one vehicle (empty list = CarGurus ready). `all` = the other vehicles, for duplicates. */
export function cgIssues(v: V, all: V[] = []): CgProblem[] {
  const out: CgProblem[] = [];
  const add = (f: string, label: string, m: string) => out.push({ f, label, m });
  const maxY = new Date().getFullYear() + 1;
  const vin = String(v.vin || '').toUpperCase().replace(/[\s-]+/g, '');
  const stock = String(v.stockNumber || '').trim();
  const others = all.filter((x) => x.id !== v.id && x.status === 'PUBLISHED');
  if (!vin) add('vin', 'VIN', 'Missing VIN');
  else if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) add('vin', 'VIN', 'VIN must be 17 letters/digits (no I, O or Q)');
  else if (others.some((x) => String(x.vin || '').toUpperCase() === vin)) add('vin', 'VIN', 'Another vehicle has the same VIN');
  if (!String(v.make || '').trim()) add('make', 'Make', 'Missing Make');
  if (!String(v.model || '').trim()) add('model', 'Model', 'Missing Model');
  const y = parseInt(v.year, 10);
  if (!(y >= 1980 && y <= maxY)) add('year', 'Year', `Year must be between 1980 and ${maxY}`);
  if (!(Number(v.price) > 0)) add('price', 'Price', 'Price must be more than $0');
  const mi = v.mileage;
  if (mi === '' || mi == null) add('mileage', 'Mileage', 'Missing Mileage');
  else if (isNaN(Number(mi)) || Number(mi) < 0 || Math.floor(Number(mi)) !== Number(mi)) add('mileage', 'Mileage', 'Mileage must be a whole number');
  if (!String(v.trim || '').trim()) add('trim', 'Trim', 'Missing Trim');
  if (!String(v.exteriorColor || '').trim()) add('exteriorColor', 'Exterior Color', 'Missing Exterior Color');
  if (!String(v.description || '').trim()) add('description', 'Dealer comments', 'Missing Dealer comments (description)');
  if (!String(v.transmission || '').trim()) add('transmission', 'Transmission Type', 'Missing Transmission Type');
  if (!stock) add('stockNumber', 'Stock Number', 'Missing Stock Number');
  else if (!/^[A-Za-z0-9\-_./#]{1,40}$/.test(stock)) add('stockNumber', 'Stock Number', 'Stock Number may only use letters, digits and - _ . / #');
  else if (others.some((x) => String(x.stockNumber || '').trim().toLowerCase() === stock.toLowerCase())) add('stockNumber', 'Stock Number', 'Another vehicle has the same Stock Number');
  const imgs: string[] = v.images || [];
  if (!imgs.length) add('images', 'Photos', 'No photos');
  for (const u of imgs) {
    const ext = photoExt(u);
    if (ext && !CG_IMG_OK.includes(ext)) add('images', 'Photos', `Photo format .${ext} not accepted (use JPG, PNG or GIF)`);
  }
  return out.filter((x, i, a) => a.findIndex((y2) => y2.m === x.m) === i);
}
