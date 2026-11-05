/**
 * The description written automatically in Add / Edit vehicle from the details filled in above it.
 * Plain sentences (no icons, no bullets) so it works everywhere it goes: the website, CarGurus
 * ("Dealer comments") and Facebook. The dealer can change it freely; once they type in it, it is theirs.
 */
type V = Record<string, any>;

const s = (x: unknown) => String(x ?? '').trim();
const num = (x: unknown) => {
  const n = Number(String(x ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const a = (word: string) => (/^(u[sn]i|use|eu|one)/i.test(word) ? 'a' : /^[aeiou8]/i.test(word) ? 'an' : 'a');
/** "x, y and z" */
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function autoDescription(v: V, features: string[] = [], safety: string[] = []): string {
  const name = [s(v.year), s(v.make), s(v.model), s(v.trim)].filter(Boolean).join(' ');
  if (!s(v.make) && !s(v.model)) return '';
  const body = s(v.bodyStyle) || s(v.vehicleType) || 'vehicle';
  const cond = v.certified ? 'certified pre-owned' : /new/i.test(s(v.condition)) ? 'new' : 'used';
  const out: string[] = [];

  out.push(`For sale: ${cond === 'new' ? 'a brand-new' : `${a(cond)} ${cond}`} ${name}.`);

  // what it is
  const look: string[] = [];
  const miles = num(v.mileage);
  if (miles) look.push(`${miles.toLocaleString('en-US')} miles`);
  if (s(v.exteriorColor)) look.push(`${a(s(v.exteriorColor))} ${s(v.exteriorColor)} exterior`);
  if (s(v.interiorColor)) look.push(`${a(s(v.interiorColor))} ${s(v.interiorColor)} interior`);
  const bodyWord = /^[A-Z]{2,}$/.test(body) ? body : body.toLowerCase(); // SUV stays SUV
  if (look.length) out.push(`This ${bodyWord} has ${list(look)}.`);

  // how it drives
  const drive: string[] = [];
  if (s(v.engine)) drive.push(`${a(s(v.engine))} ${s(v.engine)} engine${s(v.horsepower) ? ` (${s(v.horsepower).replace(/\s*hp$/i, '')} hp)` : ''}`);
  if (s(v.transmission)) drive.push(`${a(s(v.transmission))} ${s(v.transmission).toLowerCase()} transmission`);
  if (s(v.drivetrain)) drive.push(s(v.drivetrain).toLowerCase());
  if (drive.length) out.push(`It comes with ${list(drive)}.`);
  const fuel: string[] = [];
  if (s(v.fuelType)) fuel.push(`It runs on ${s(v.fuelType).toLowerCase()}`);
  if (s(v.mpg)) fuel.push(`${fuel.length ? 'gets' : 'It gets'} ${s(v.mpg)} MPG`);
  if (fuel.length) out.push(`${fuel.join(' and ')}.`);
  const doors = num(v.doors), seats = num(v.seats);
  if (doors && seats) out.push(`It has ${doors} doors and seats ${seats}.`);
  else if (doors) out.push(`It has ${doors} doors.`);
  else if (seats) out.push(`It seats ${seats}.`);

  // history
  const hist: string[] = [];
  const owners = s(v.owners);
  if (/^\d+$/.test(owners) && owners !== '0') hist.push(owners === '1' ? 'one owner' : `${owners} previous owners`);
  const acc = s(v.accidents);
  if (acc === '0') hist.push('no accidents reported');
  else if (/^\d+$/.test(acc)) hist.push(`${acc} accident${acc === '1' ? '' : 's'} reported`);
  if (hist.length) out.push(`${list(hist).replace(/^./, (c) => c.toUpperCase())}.`);

  let text = out.join(' ');
  const options = [...features, ...safety.filter((x) => !features.includes(x))].map(s).filter(Boolean);
  if (options.length) text += `\n\nInstalled options: ${options.join(', ')}.`;
  const ids = [s(v.stockNumber) && `Stock number ${s(v.stockNumber)}`, s(v.vin) && `VIN ${s(v.vin).toUpperCase()}`].filter(Boolean);
  if (ids.length) text += `\n\n${ids.join('. ')}.`;
  text += '\n\nContact us today to check availability or schedule a test drive.';
  return text;
}
