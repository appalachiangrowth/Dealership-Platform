/** AI Quick Add — VIN record (NHTSA vPIC), prompts and clean-up of the AI answers. Values use the portal's own spelling. */

type Rec = Record<string, unknown>;

const pick = (r: Rec, k: string) => {
  const v = String(r?.[k] ?? '').trim();
  return v !== '' && v !== 'Not Applicable' && v !== '0' ? v : '';
};

function niceMake(m: string) {
  return m
    .split(/([\s-])/)
    .map((w) => (w.length <= 3 && /^[A-Z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

function mapBody(b: string) {
  const x = b.toLowerCase();
  if (!x) return '';
  const table: [string, string][] = [
    ['pickup', 'Pickup Truck'], ['sport utility', 'SUV'], ['suv', 'SUV'], ['crossover', 'SUV'], ['minivan', 'Minivan'], ['convertible', 'Convertible'],
    ['cabriolet', 'Convertible'], ['coupe', 'Coupe'], ['wagon', 'Wagon'], ['hatchback', 'Hatchback'], ['liftback', 'Hatchback'], ['sedan', 'Sedan'],
    ['saloon', 'Sedan'], ['cargo van', 'Cargo Van'], ['van', 'Van / Passenger Van'],
  ];
  for (const [k, v] of table) if (x.includes(k)) return v;
  return '';
}
function mapDrive(d: string) {
  const x = d.toLowerCase();
  if (!x) return '';
  if (/awd|all-wheel|all wheel/.test(x)) return 'All-Wheel Drive';
  if (/4wd|4x4|4-wheel|four/.test(x)) return 'Four-Wheel Drive';
  if (/fwd|front/.test(x)) return 'Front-Wheel Drive';
  if (/rwd|rear/.test(x)) return 'Rear-Wheel Drive';
  return '';
}
function mapTrans(t: string) {
  const x = t.toLowerCase();
  if (!x) return '';
  if (/cvt|continuously/.test(x)) return 'CVT';
  if (/dual|dct/.test(x)) return 'Dual-Clutch';
  if (/manual|standard/.test(x)) return 'Manual';
  if (x.includes('auto')) return 'Automatic';
  return '';
}
function mapFuel(r: Rec) {
  const f = pick(r, 'FuelTypePrimary').toLowerCase();
  const e = pick(r, 'ElectrificationLevel').toLowerCase();
  if (/phev|plug/.test(e)) return 'Plug-in Hybrid';
  if (e.includes('bev') || f.includes('electric')) return 'Electric';
  if (/hev|hybrid/.test(e)) return 'Hybrid';
  if (f.includes('diesel')) return 'Diesel';
  if (/gasoline|flexible/.test(f)) return 'Gasoline';
  return '';
}
function mapType(t: string) {
  const x = t.toLowerCase();
  if (x.includes('truck')) return 'Truck';
  if (x.includes('multipurpose') || x.includes('mpv')) return 'SUV';
  if (x.includes('motorcycle')) return 'Motorcycle';
  if (x.includes('bus') || x.includes('van')) return 'Van';
  if (x.includes('passenger car')) return 'Car';
  return '';
}

const SAFETY_NAMES: Record<string, string> = {
  ABS: 'Anti-lock brakes (ABS)', ESC: 'Electronic stability control', TractionControl: 'Traction control', TPMS: 'Tire pressure monitoring',
  RearVisibilitySystem: 'Backup camera', BackupCamera: 'Backup camera', BlindSpotMon: 'Blind-spot warning', BlindSpotWarning: 'Blind-spot warning',
  BlindSpotIntervention: 'Blind-spot intervention', LaneDepartureWarning: 'Lane departure warning', LaneKeepSystem: 'Lane keeping assist',
  LaneCenteringAssistance: 'Lane centering assist', ForwardCollisionWarning: 'Forward collision warning', CIB: 'Automatic emergency braking',
  DynamicBrakeSupport: 'Dynamic brake support', PedestrianAutomaticEmergencyBraking: 'Pedestrian emergency braking', AdaptiveCruiseControl: 'Adaptive cruise control',
  RearCrossTrafficAlert: 'Rear cross-traffic alert', RearAutomaticEmergencyBraking: 'Rear automatic braking', ParkAssist: 'Park assist',
  AdaptiveDrivingBeam: 'Adaptive headlights', AutomaticHeadlampsSwitching: 'Automatic high beams', DaytimeRunningLight: 'Daytime running lights',
  KeylessIgnition: 'Keyless ignition', AutoReverseSystem: 'Auto-reverse windows', CAN_AACN: 'Automatic crash notification',
};
/** Safety equipment the manufacturer reported as "Standard" in the official record. */
function vinSafety(r: Rec) {
  const out: string[] = [];
  for (const [k, v] of Object.entries(r || {})) {
    if (String(v ?? '').trim() !== 'Standard') continue;
    const label = SAFETY_NAMES[k] || k.replace(/(?<!^)([A-Z][a-z])/g, ' $1').trim();
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export function mapNhtsa(r: Rec) {
  const disp = pick(r, 'DisplacementL');
  const cyl = pick(r, 'EngineCylinders');
  const turbo = pick(r, 'Turbo') === 'Yes';
  const cylTxt = cyl ? (['6', '8', '10', '12'].includes(cyl) && /v/i.test(pick(r, 'EngineConfiguration')) ? ` V${cyl}` : ` ${cyl}-cylinder`) : '';
  const engine = disp ? `${Number(disp).toFixed(1)}L${cylTxt}${turbo ? ' Turbo' : ''}` : '';
  const trim = [pick(r, 'Trim'), pick(r, 'Trim2')].filter(Boolean).join(' ').trim() || pick(r, 'Series');
  const codes = (pick(r, 'ErrorCode') || '0').split(',').map((c) => c.trim());
  const clean = codes.every((c) => c === '0');
  const hp = pick(r, 'EngineHP');
  return {
    fields: {
      year: pick(r, 'ModelYear'),
      make: niceMake(pick(r, 'Make')),
      model: pick(r, 'Model'),
      trim,
      body: mapBody(pick(r, 'BodyClass')),
      vtype: mapType(pick(r, 'VehicleType')),
      engine,
      cyl,
      hp: hp ? String(Math.round(Number(hp))) : '',
      fuel: mapFuel(r),
      drive: mapDrive(pick(r, 'DriveType')),
      trans: mapTrans(pick(r, 'TransmissionStyle')),
      doors: pick(r, 'Doors'),
      seats: pick(r, 'Seats'),
    },
    clean,
    warnings: clean ? [] : [pick(r, 'ErrorText')].filter(Boolean),
    safety: vinSafety(r),
    manufacturer: pick(r, 'Manufacturer'),
    plant: [pick(r, 'PlantCity'), pick(r, 'PlantCountry')].filter(Boolean).join(', '),
  };
}

/** The 9th character of a VIN is a check digit: a misread VIN is caught. */
export function vinOk(v: unknown): boolean {
  const s = String(v || '').toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return false;
  const map: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const w = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (/\d/.test(s[i]) ? Number(s[i]) : map[s[i]]) * w[i];
  const cd = sum % 11 === 10 ? 'X' : String(sum % 11);
  return cd === s[8];
}

/* ---------- prompts ---------- */
export const FAST_RULES = `You fill in a car dealer's vehicle listing from their photos. Accuracy beats completeness.
RULES
- Report ONLY what is clearly visible. Never add equipment just because this model usually has it.
- transmission: Automatic only if a P-R-N-D gear selector, dial or buttons is clearly visible; Manual only if an H-pattern gear stick (clutch pedal) is visible; otherwise null.
- Not visible or unsure → value null. Null is a good answer.
- Colours: closest plain name from the allowed list. Silver vs gray or black vs dark blue unclear → confidence medium/low.
- odometer_miles: only if the odometer number is sharp; miles only (km display → null). Digits only.
- vin_in_photo: only if readable.
- vehicle_matches_vin.status: mismatch only if badges/shape clearly show another make or model.
- Never guess accidents, owners or mechanical condition. condition_notes = visible damage, wear or warning lights only.
- evidence: at most 6 words, start with the photo number, e.g. "Photo 9: front bumper".
- photos: one entry for EVERY photo: n = photo number, angle = what it mainly shows (front_left = front three-quarter from driver side, front_right = front three-quarter from passenger side, left/right = side profile, rear_left/rear_right = rear three-quarter, interior_front = view into the front cabin, console = centre screen/console, vin_label = VIN sticker, document = paperwork), quality 1-5 (5 = sharp, well lit, whole subject in frame; 1 = blurry, dark or cut off).
- best_cover_photo: the best front three-quarter exterior photo (the listing cover).
- description: 60-100 words, friendly and professional, plain text, using ONLY the VIN record and what you saw. No price, VIN, mileage, owners, accidents, warranty or financing. End with an invitation to visit or contact the dealership.`;

export const FAST_SHAPE =
  '{"vehicle_matches_vin":{"status":"match|mismatch|unsure","note":""},"exterior_color":{"value":"Black|White|Silver|Gray|Blue|Red|Green|Brown|Beige|Gold|Orange|Yellow|Purple|null","confidence":"high|medium|low","evidence":""},"interior_color":{"value":"Black|Gray|Beige|Brown|White|Red|Blue|Other|null","confidence":"","evidence":""},"interior_material":{"value":"Cloth|Leather|Leatherette|Suede|Vinyl|null","confidence":"","evidence":""},"transmission":{"value":"Automatic|Manual|null","confidence":"","evidence":""},"odometer_miles":{"value":"integer or null","confidence":"","evidence":""},"vin_in_photo":{"value":"string or null","confidence":"","evidence":""},"features":[{"name":"","confidence":"","evidence":""}],"safety_features":[{"name":"","confidence":"","evidence":""}],"visible_condition_notes":[{"note":"","evidence":""}],"photos":[{"n":1,"angle":"front_left|front|front_right|left|right|rear_left|rear|rear_right|wheel|interior_front|dashboard|odometer|console|front_seats|rear_seats|trunk|engine|detail|damage|vin_label|document|other","quality":5}],"best_cover_photo":"integer or null","description":""}';

export const VIDEO_RULES = `These are still frames from a car dealer's walkaround video of ONE vehicle, plus (if given) the audio of the dealer talking while filming. Accuracy beats completeness.
- transmission: Automatic only if a P-R-N-D gear selector, dial or buttons is clearly visible; Manual only if an H-pattern gear stick (clutch pedal) is visible; otherwise null.
RULES
- Report ONLY what is clearly visible or clearly said. Never add equipment just because this model usually has it. Unsure → null.
- vin_in_video: read the 17-character VIN only if clearly readable (door sticker, windshield plate, paperwork). Copy exactly. Otherwise null.
- odometer_miles: only if the odometer number is sharp; miles only. Digits only.
- seen_vehicle: make and model from badges/shape, e.g. "Buick Lucerne", or null.
- Colours: closest plain name from the allowed list; ambiguous lighting → confidence medium/low.
- frames: one entry for EVERY frame: n = frame number, angle = what it mainly shows (front_left = front three-quarter from driver side, front_right = from passenger side, left/right = side profile, rear_left/rear_right = rear three-quarter, interior_front = view into the front cabin, console = centre screen/console, vin_label = VIN sticker or plate, document = paperwork), quality 1-5 (5 = sharp, well lit, whole subject in frame; 1 = blurry or cut off).
- vin_frames: frame numbers where a VIN sticker/plate is visible (even if too small to read). odometer_frames: frame numbers where the instrument cluster/odometer is visible.
- spoken_notes: short, clean bullet notes of what the dealer SAID that a buyer should know (e.g. "New tyres", "One owner"). Only things actually said. No filler. [] if nothing useful.
- Never guess accidents, owners or mechanical condition. visible_condition_notes = visible damage, wear or warning lights only.
- evidence: at most 6 words, start with the frame number, e.g. "Frame 7: odometer".`;

export const VIDEO_SHAPE =
  '{"vin_in_video":{"value":"string or null","confidence":"high|medium|low","evidence":""},"seen_vehicle":"string or null","exterior_color":{"value":"Black|White|Silver|Gray|Blue|Red|Green|Brown|Beige|Gold|Orange|Yellow|Purple|null","confidence":"","evidence":""},"interior_color":{"value":"Black|Gray|Beige|Brown|White|Red|Blue|Other|null","confidence":"","evidence":""},"interior_material":{"value":"Cloth|Leather|Leatherette|Suede|Vinyl|null","confidence":"","evidence":""},"transmission":{"value":"Automatic|Manual|null","confidence":"","evidence":""},"odometer_miles":{"value":"integer or null","confidence":"","evidence":""},"features":[{"name":"","confidence":"","evidence":""}],"safety_features":[{"name":"","confidence":"","evidence":""}],"visible_condition_notes":[{"note":"","evidence":""}],"frames":[{"n":1,"angle":"front_left|front|front_right|left|right|rear_left|rear|rear_right|wheel|interior_front|dashboard|odometer|console|front_seats|rear_seats|trunk|engine|detail|damage|vin_label|document|other","quality":5}],"vin_frames":[],"odometer_frames":[],"spoken_notes":[]}';

export const CLOSEUP_PROMPT = `Read these close-ups from a car walkaround video very carefully.
- VIN: the 17-character Vehicle Identification Number on a sticker or plate (it never contains I, O or Q; confusable: 0/D, 1/7, 5/S, 8/B, 2/Z). Copy it character by character. If unsure about a character, give up to 3 full alternatives in candidates.
- Odometer: the total mileage number on the instrument cluster (not trip meter, not speed, not RPM). Miles only; if it shows km, value null.
Unreadable → null. Reply with ONLY this JSON:
{"vin":{"value":"string or null","candidates":[],"confidence":"high|medium|low","evidence":"Close-up N"},"odometer_miles":{"value":"digits or null","confidence":"high|medium|low","evidence":"Close-up N"}}`;

/* ---------- clean-up ---------- */
const EXT = ['Black', 'White', 'Silver', 'Gray', 'Blue', 'Red', 'Green', 'Brown', 'Beige', 'Gold', 'Orange', 'Yellow', 'Purple'];
const INT = ['Black', 'Gray', 'Beige', 'Brown', 'White', 'Red', 'Blue', 'Other'];
const MAT = ['Cloth', 'Leather', 'Leatherette', 'Suede', 'Vinyl'];
const CONF = ['high', 'medium', 'low'];
const ANGLES = ['front_left', 'front', 'front_right', 'left', 'right', 'rear_left', 'rear', 'rear_right', 'wheel', 'interior_front', 'dashboard', 'odometer', 'console', 'front_seats', 'rear_seats', 'trunk', 'engine', 'detail', 'damage', 'vin_label', 'document', 'other'];

export type Finding = { value: any; confidence: string; evidence: string };

function fix(x: any, allowed?: string[]): Finding {
  if (!x || typeof x !== 'object' || Array.isArray(x)) x = { value: x };
  let v = x.value === undefined || x.value === '' || x.value === 'null' ? null : x.value;
  let note = '';
  if (allowed && v !== null) {
    const hit = allowed.find((a) => a.toLowerCase() === String(v).toLowerCase()) || null;
    if (!hit) note = `AI said "${v}", which is not one of the standard choices. Please pick one. `;
    v = hit;
  }
  const conf = v === null ? 'low' : CONF.includes(x.confidence) ? x.confidence : 'medium';
  return { value: v, confidence: conf, evidence: note + String(x.evidence ?? (v === null ? 'not visible' : 'no evidence given')) };
}
function list(a: any) {
  return (Array.isArray(a) ? a : [])
    .filter((i) => i && typeof i === 'object' && i.name)
    .map((i) => ({ name: String(i.name), confidence: CONF.includes(i.confidence) ? i.confidence : 'medium', evidence: String(i.evidence ?? 'no evidence given') }));
}

export function normalize(f: any) {
  f = f && typeof f === 'object' ? f : {};
  const odo = fix(f.odometer_miles);
  if (odo.value !== null) {
    const n = String(odo.value).replace(/[^0-9]/g, '');
    odo.value = n === '' ? null : Number(n);
  }
  const m = f.vehicle_matches_vin && typeof f.vehicle_matches_vin === 'object' ? f.vehicle_matches_vin : {};
  const notes = (Array.isArray(f.visible_condition_notes) ? f.visible_condition_notes : [])
    .filter((n: any) => n && typeof n === 'object' && n.note)
    .map((n: any) => ({ note: String(n.note), evidence: String(n.evidence ?? '') }));
  return {
    vehicle_matches_vin: { status: ['match', 'mismatch', 'unsure'].includes(m.status) ? m.status : 'unsure', note: String(m.note ?? '') },
    exterior_color: fix(f.exterior_color, EXT),
    interior_color: fix(f.interior_color, INT),
    interior_material: fix(f.interior_material, MAT),
    transmission: fix(f.transmission, ['Automatic', 'Manual']),
    odometer_miles: odo,
    vin_in_photo: fix(f.vin_in_photo),
    features: list(f.features),
    safety_features: list(f.safety_features),
    visible_condition_notes: notes,
    best_cover_photo: Number.isInteger(f.best_cover_photo) ? f.best_cover_photo : null,
  } as Record<string, any>;
}

export function normFrames(input: any, max: number) {
  const out = new Map<number, { n: number; angle: string; quality: number }>();
  for (const x of Array.isArray(input) ? input : []) {
    if (!x || typeof x !== 'object' || !Number.isFinite(Number(x.n))) continue;
    const n = Math.trunc(Number(x.n));
    if (n < 1 || n > max) continue;
    out.set(n, { n, angle: ANGLES.includes(x.angle) ? x.angle : 'other', quality: Math.max(1, Math.min(5, Math.trunc(Number(x.quality) || 3))) });
  }
  return [...out.values()];
}
