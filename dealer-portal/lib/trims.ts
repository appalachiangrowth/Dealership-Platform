/**
 * Known trims for common makes / models, offered as suggestions in the Trim field (Add and Edit vehicle).
 * The dealer can always type any other trim.
 */
const T: Record<string, Record<string, string[]>> = {
  acura: { mdx: ['Base', 'Technology', 'A-Spec', 'Advance', 'Type S'], rdx: ['Base', 'Technology', 'A-Spec', 'Advance'], tlx: ['Base', 'Technology', 'A-Spec', 'Advance', 'Type S'], integra: ['Base', 'A-Spec', 'Type S'] },
  audi: { a4: ['Premium', 'Premium Plus', 'Prestige'], a6: ['Premium', 'Premium Plus', 'Prestige'], q3: ['Premium', 'Premium Plus'], q5: ['Premium', 'Premium Plus', 'Prestige'], q7: ['Premium', 'Premium Plus', 'Prestige'] },
  bmw: { '3 series': ['330i', '330i xDrive', 'M340i', 'M340i xDrive'], '5 series': ['530i', '530i xDrive', '540i xDrive', 'M550i xDrive'], x3: ['sDrive30i', 'xDrive30i', 'M40i'], x5: ['sDrive40i', 'xDrive40i', 'xDrive50e', 'M60i'] },
  buick: { enclave: ['Preferred', 'Essence', 'Premium', 'Avenir'], encore: ['Preferred', 'Sport Touring', 'Essence'], 'encore gx': ['Preferred', 'Sport Touring', 'Avenir'], envision: ['Preferred', 'Essence', 'Avenir'] },
  cadillac: { escalade: ['Luxury', 'Premium Luxury', 'Sport', 'Premium Luxury Platinum', 'Sport Platinum'], xt4: ['Luxury', 'Premium Luxury', 'Sport'], xt5: ['Luxury', 'Premium Luxury', 'Sport'], xt6: ['Luxury', 'Premium Luxury', 'Sport'] },
  chevrolet: {
    silverado: ['WT', 'Custom', 'Custom Trail Boss', 'LT', 'RST', 'LT Trail Boss', 'LTZ', 'High Country', 'ZR2'],
    'silverado 1500': ['WT', 'Custom', 'Custom Trail Boss', 'LT', 'RST', 'LT Trail Boss', 'LTZ', 'High Country', 'ZR2'],
    equinox: ['LS', 'LT', 'RS', 'Premier', 'ACTIV'], malibu: ['LS', 'RS', 'LT', '2LT', 'Premier'], tahoe: ['LS', 'LT', 'RST', 'Z71', 'Premier', 'High Country'],
    suburban: ['LS', 'LT', 'RST', 'Z71', 'Premier', 'High Country'], traverse: ['LS', 'LT', 'RS', 'Premier', 'Z71'], colorado: ['WT', 'LT', 'Z71', 'Trail Boss', 'ZR2'],
    trax: ['LS', '1RS', 'LT', '2RS', 'ACTIV'], camaro: ['1LS', '1LT', '2LT', '3LT', '1SS', '2SS', 'ZL1'], blazer: ['2LT', '3LT', 'RS', 'Premier'],
  },
  chrysler: { pacifica: ['Touring', 'Touring L', 'Limited', 'Pinnacle'], '300': ['Touring', 'Touring L', 'S', '300C'] },
  dodge: { charger: ['SXT', 'GT', 'R/T', 'Scat Pack', 'SRT Hellcat'], challenger: ['SXT', 'GT', 'R/T', 'R/T Scat Pack', 'SRT Hellcat'], durango: ['SXT', 'GT', 'R/T', 'Citadel', 'SRT 392'], 'grand caravan': ['SE', 'SXT', 'GT'] },
  ford: {
    'f-150': ['XL', 'STX', 'XLT', 'Lariat', 'King Ranch', 'Platinum', 'Limited', 'Tremor', 'Raptor'], 'f-250': ['XL', 'XLT', 'Lariat', 'King Ranch', 'Platinum', 'Limited', 'Tremor'],
    'f-350': ['XL', 'XLT', 'Lariat', 'King Ranch', 'Platinum', 'Limited'], escape: ['S', 'Active', 'ST-Line', 'Platinum', 'SE', 'SEL', 'Titanium'], explorer: ['Base', 'XLT', 'Active', 'ST-Line', 'Limited', 'Timberline', 'ST', 'Platinum'],
    edge: ['SE', 'SEL', 'ST-Line', 'Titanium', 'ST'], expedition: ['XL', 'XLT', 'Limited', 'King Ranch', 'Timberline', 'Platinum'], mustang: ['EcoBoost', 'EcoBoost Premium', 'GT', 'GT Premium', 'Dark Horse'],
    bronco: ['Base', 'Big Bend', 'Black Diamond', 'Outer Banks', 'Badlands', 'Wildtrak', 'Everglades', 'Raptor'], 'bronco sport': ['Big Bend', 'Outer Banks', 'Badlands', 'Heritage'],
    ranger: ['XL', 'XLT', 'Lariat', 'Raptor'], maverick: ['XL', 'XLT', 'Lariat', 'Tremor'], fusion: ['S', 'SE', 'SEL', 'Titanium'], transit: ['Cargo Van', 'Crew Van', 'Passenger Van XL', 'Passenger Van XLT'],
  },
  gmc: { sierra: ['Pro', 'SLE', 'Elevation', 'SLT', 'AT4', 'Denali', 'AT4X', 'Denali Ultimate'], 'sierra 1500': ['Pro', 'SLE', 'Elevation', 'SLT', 'AT4', 'Denali', 'AT4X', 'Denali Ultimate'], acadia: ['SLE', 'SLT', 'AT4', 'Denali'], terrain: ['SLE', 'SLT', 'AT4', 'Denali'], yukon: ['SLE', 'SLT', 'AT4', 'Denali', 'Denali Ultimate'], canyon: ['Elevation', 'AT4', 'Denali', 'AT4X'] },
  honda: {
    accord: ['LX', 'SE', 'EX', 'Sport', 'EX-L', 'Sport-L', 'Touring'], civic: ['LX', 'Sport', 'EX', 'EX-L', 'Touring', 'Si', 'Type R'], 'cr-v': ['LX', 'EX', 'EX-L', 'Sport', 'Sport-L', 'Touring', 'Sport Touring'],
    'hr-v': ['LX', 'Sport', 'EX', 'EX-L'], odyssey: ['LX', 'EX', 'EX-L', 'Sport', 'Touring', 'Elite'], pilot: ['LX', 'Sport', 'EX-L', 'TrailSport', 'Touring', 'Elite', 'Black Edition'],
    passport: ['EX-L', 'TrailSport', 'Elite'], ridgeline: ['Sport', 'RTL', 'RTL-E', 'TrailSport', 'Black Edition'], fit: ['LX', 'Sport', 'EX', 'EX-L'],
  },
  hyundai: {
    elantra: ['SE', 'SEL', 'Limited', 'N Line', 'N'], sonata: ['SE', 'SEL', 'SEL Plus', 'Limited', 'N Line'], tucson: ['SE', 'SEL', 'XRT', 'N Line', 'Limited'], 'santa fe': ['SE', 'SEL', 'XRT', 'Limited', 'Calligraphy'],
    palisade: ['SE', 'SEL', 'XRT', 'Limited', 'Calligraphy'], kona: ['SE', 'SEL', 'N Line', 'Limited'], venue: ['SE', 'SEL', 'Limited'],
  },
  infiniti: { q50: ['Pure', 'Luxe', 'Sensory', 'Red Sport 400'], qx50: ['Pure', 'Luxe', 'Sport', 'Sensory', 'Autograph'], qx60: ['Pure', 'Luxe', 'Sensory', 'Autograph'], qx80: ['Luxe', 'Premium Select', 'Sensory'] },
  jeep: {
    wrangler: ['Sport', 'Sport S', 'Willys', 'Sahara', 'Rubicon', 'Rubicon 392'], 'grand cherokee': ['Laredo', 'Altitude', 'Limited', 'Overland', 'Summit', 'Trailhawk', 'Summit Reserve'],
    cherokee: ['Latitude', 'Latitude Lux', 'Altitude', 'Limited', 'Trailhawk'], compass: ['Sport', 'Latitude', 'Latitude Lux', 'Limited', 'Trailhawk'], gladiator: ['Sport', 'Sport S', 'Willys', 'Overland', 'Mojave', 'Rubicon'],
    renegade: ['Sport', 'Latitude', 'Limited', 'Trailhawk'],
  },
  kia: {
    forte: ['LX', 'LXS', 'GT-Line', 'GT'], k5: ['LX', 'LXS', 'GT-Line', 'EX', 'GT'], sorento: ['LX', 'S', 'EX', 'SX', 'SX-Prestige', 'X-Line'], sportage: ['LX', 'EX', 'X-Line', 'SX', 'SX-Prestige', 'X-Pro'],
    telluride: ['LX', 'S', 'EX', 'SX', 'SX-Prestige', 'X-Line', 'X-Pro'], soul: ['LX', 'S', 'GT-Line', 'EX'], seltos: ['LX', 'S', 'EX', 'SX'], carnival: ['LX', 'LXS', 'EX', 'SX', 'SX-Prestige'],
  },
  lexus: { es: ['ES 250', 'ES 300h', 'ES 350', 'F Sport'], rx: ['RX 350', 'RX 350h', 'RX 450h+', 'RX 500h', 'F Sport'], nx: ['NX 250', 'NX 350', 'NX 350h', 'NX 450h+', 'F Sport'], gx: ['Premium', 'Luxury', 'Overtrail'] },
  mazda: { mazda3: ['2.5 S', 'Select', 'Preferred', 'Premium', 'Turbo'], 'cx-5': ['2.5 S', 'Select', 'Preferred', 'Carbon Edition', 'Premium', 'Turbo', 'Signature'], 'cx-30': ['2.5 S', 'Select', 'Preferred', 'Premium', 'Turbo'], 'cx-50': ['2.5 S', 'Select', 'Preferred', 'Premium', 'Turbo'], 'cx-9': ['Touring', 'Carbon Edition', 'Grand Touring', 'Signature'] },
  'mercedes-benz': { 'c-class': ['C 300', 'C 300 4MATIC', 'AMG C 43'], 'e-class': ['E 350', 'E 350 4MATIC', 'E 450 4MATIC', 'AMG E 53'], glc: ['GLC 300', 'GLC 300 4MATIC', 'AMG GLC 43'], gle: ['GLE 350', 'GLE 350 4MATIC', 'GLE 450 4MATIC', 'AMG GLE 53'] },
  nissan: {
    altima: ['S', 'SV', 'SR', 'SL', 'Platinum'], sentra: ['S', 'SV', 'SR'], rogue: ['S', 'SV', 'SL', 'Platinum'], 'rogue sport': ['S', 'SV', 'SL'], murano: ['S', 'SV', 'SL', 'Platinum'],
    pathfinder: ['S', 'SV', 'SL', 'Platinum', 'Rock Creek'], frontier: ['S', 'SV', 'PRO-4X', 'PRO-X'], titan: ['S', 'SV', 'PRO-4X', 'Platinum Reserve'], kicks: ['S', 'SV', 'SR'], versa: ['S', 'SV', 'SR'], armada: ['S', 'SV', 'SL', 'Platinum'],
  },
  ram: { '1500': ['Tradesman', 'Big Horn', 'Lone Star', 'Laramie', 'Rebel', 'Limited Longhorn', 'Limited', 'TRX'], '2500': ['Tradesman', 'Big Horn', 'Laramie', 'Power Wagon', 'Limited Longhorn', 'Limited'], '3500': ['Tradesman', 'Big Horn', 'Laramie', 'Limited Longhorn', 'Limited'], promaster: ['1500', '2500', '3500'] },
  subaru: { outback: ['Base', 'Premium', 'Onyx Edition', 'Limited', 'Touring', 'Wilderness'], forester: ['Base', 'Premium', 'Sport', 'Wilderness', 'Limited', 'Touring'], crosstrek: ['Base', 'Premium', 'Sport', 'Limited', 'Wilderness'], impreza: ['Base', 'Premium', 'Sport', 'RS'], ascent: ['Base', 'Premium', 'Onyx Edition', 'Limited', 'Touring'], wrx: ['Base', 'Premium', 'Limited', 'GT'] },
  tesla: { 'model 3': ['Standard Range', 'Long Range', 'Performance'], 'model y': ['Standard Range', 'Long Range', 'Performance'], 'model s': ['Long Range', 'Plaid'], 'model x': ['Long Range', 'Plaid'] },
  toyota: {
    camry: ['LE', 'SE', 'SE Nightshade', 'XLE', 'XSE', 'TRD'], corolla: ['L', 'LE', 'SE', 'XLE', 'XSE', 'Nightshade'], rav4: ['LE', 'XLE', 'XLE Premium', 'Adventure', 'TRD Off-Road', 'Limited'],
    highlander: ['L', 'LE', 'XLE', 'XSE', 'Limited', 'Platinum'], tacoma: ['SR', 'SR5', 'TRD Sport', 'TRD Off-Road', 'Limited', 'TRD Pro', 'Trailhunter'], tundra: ['SR', 'SR5', 'Limited', 'Platinum', '1794 Edition', 'TRD Pro', 'Capstone'],
    '4runner': ['SR5', 'SR5 Premium', 'TRD Sport', 'TRD Off-Road', 'TRD Off-Road Premium', 'Limited', 'TRD Pro'], sienna: ['LE', 'XLE', 'XSE', 'Woodland Edition', 'Limited', 'Platinum'],
    prius: ['LE', 'XLE', 'Limited'], 'corolla cross': ['L', 'LE', 'S', 'SE', 'XLE', 'XSE'], sequoia: ['SR5', 'Limited', 'Platinum', 'TRD Pro', 'Capstone'], avalon: ['XLE', 'XSE', 'Limited', 'Touring'],
  },
  volkswagen: { jetta: ['S', 'Sport', 'SE', 'SEL', 'GLI'], tiguan: ['S', 'SE', 'SE R-Line Black', 'SEL R-Line'], atlas: ['SE', 'SE with Technology', 'Peak Edition', 'SEL', 'SEL Premium R-Line'], passat: ['S', 'SE', 'R-Line', 'SEL'], golf: ['S', 'SE', 'GTI', 'R'] },
  volvo: { xc60: ['Core', 'Plus', 'Ultimate'], xc90: ['Core', 'Plus', 'Ultimate'], xc40: ['Core', 'Plus', 'Ultimate'], s60: ['Core', 'Plus', 'Ultimate'] },
};
const ALIAS: Record<string, string> = { chevy: 'chevrolet', mercedes: 'mercedes-benz', vw: 'volkswagen' };
/** generic trims when the make / model is not in the list above */
const GENERIC = ['Base', 'S', 'SE', 'SEL', 'LE', 'XLE', 'LX', 'EX', 'EX-L', 'LT', 'LTZ', 'XL', 'XLT', 'Sport', 'Limited', 'Premium', 'Touring', 'Platinum'];

const key = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** trims to suggest for this make + model (generic ones when unknown); the current value comes first when it is not listed */
export function trimOptions(make: unknown, model: unknown): string[] {
  const mk = key(make);
  const md = key(model);
  const byMake = T[ALIAS[mk] || mk];
  let list: string[] | undefined;
  if (byMake && md) list = byMake[md] || byMake[md.replace(/-/g, '')] || byMake[md.replace(/\s/g, '-')] || Object.entries(byMake).find(([m]) => md.startsWith(`${m} `))?.[1];
  return list || GENERIC;
}
