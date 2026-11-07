// @ts-nocheck
/* Facebook listing text: template or AI (ported unchanged from fb-poster/marketplace.js).
 * Vehicles here use the old marketplace.js shape: { year, make, model, trim, price, mileage, … }.
 * Settings `s` = Marketplace settings + the dealership's Business details (dealerName, phone, address, city, website). */

/** the template of the first version — saved settings that still hold it get the detailed one */
export const OLD_DESCRIPTION_TEMPLATE =
  '{title}\n\n' +
  '✅ Mileage: {mileage} miles\n✅ Exterior: {exterior} | Interior: {interior}\n' +
  '✅ Transmission: {transmission} | Fuel: {fuel}\n✅ Drivetrain: {drivetrain} | Engine: {engine}\n' +
  '{features_block}\n' +
  'Stock #{stock} | VIN: {vin}\n\n' +
  '📍 {dealer_name} {dealer_address}\n📞 Call/Text: {dealer_phone}\n\nMessage us today to schedule a test drive!';

/** the detailed template with icons and bullets (replaced by the plain one below) */
const ICON_TEMPLATE =
  '🚗 {title}{price_line}\n\n' +
  '{comments}\n\n' +
  '📋 VEHICLE DETAILS\n' +
  '• Year: {year} | Make: {make} | Model: {model} | Trim: {trim}\n' +
  '• Body style: {body} | Condition: {condition_text}\n' +
  '• Mileage: {mileage} miles\n' +
  '• Exterior color: {exterior} | Interior color: {interior}\n' +
  '• Engine: {engine} | Horsepower: {horsepower}\n' +
  '• Transmission: {transmission} | Drivetrain: {drivetrain}\n' +
  '• Fuel: {fuel} | MPG: {mpg}\n' +
  '• Doors: {doors} | Seats: {seats}\n' +
  '• {history}\n' +
  '{features_block}' +
  '{safety_block}\n' +
  '🔎 Stock #{stock} | VIN: {vin}\n\n' +
  '📍 {dealer_name} | {dealer_address}\n' +
  '📞 Call or text: {dealer_phone}\n' +
  '🌐 {dealer_website}\n\n' +
  '✅ Message us now to check availability or book a test drive!';

/** plain text: every detail of the vehicle, no icons, no bullets, no check marks */
const DETAILED_TEMPLATE =
  '{title}{price_line}\n\n' +
  '{comments}\n\n' +
  'Vehicle details\n' +
  'Year: {year} | Make: {make} | Model: {model} | Trim: {trim}\n' +
  'Body style: {body} | Condition: {condition_text}\n' +
  'Mileage: {mileage} miles\n' +
  'Exterior color: {exterior} | Interior color: {interior}\n' +
  'Engine: {engine} | Horsepower: {horsepower}\n' +
  'Transmission: {transmission} | Drivetrain: {drivetrain}\n' +
  'Fuel: {fuel} | MPG: {mpg}\n' +
  'Doors: {doors} | Seats: {seats}\n' +
  'Processing fee: {processing_fee}\n' +
  'History: {history}\n' +
  '{options_block}\n' +
  'Stock number: {stock} | VIN: {vin}\n\n' +
  '{dealer_name} | {dealer_address}\n' +
  'Call or text: {dealer_phone}\n' +
  '{dealer_website}\n\n' +
  'Message us now to check availability or book a test drive.';

export const DEFAULT_SETTINGS = {
  dealerName: '', phone: '', address: '', city: '', website: '',
  titleTemplate: '{year} {make} {model} {trim}',
  // every detail of the vehicle — also the ones Facebook's form has no box for (trim, engine, drivetrain, VIN …)
  descriptionTemplate: DETAILED_TEMPLATE,
  defaultHashtags: '#carsforsale #usedcars #cardealer',
  disclaimer: '',
  dailyLimit: 5,
  autoPublish: 'on',   // on = the app clicks Next + Publish itself; off = you click them
  gapSeconds: 45,      // pause between listings when posting several in a row
  aiProvider: 'none', // none | openai | anthropic
  aiModel: '',
  aiKey: '',
};

export function validate(v) {
  const errs = [];
  if (!v.year || v.year < 1900 || v.year > new Date().getFullYear() + 2) errs.push('valid year');
  if (!v.make) errs.push('make');
  if (!v.model) errs.push('model');
  if (!v.price) errs.push('price');
  if (v.mileage === null || v.mileage === undefined || !(Number(v.mileage) > 0)) errs.push('mileage (more than 0)');
  // Marketplace's vehicle form asks for these too (same list as the portal's "Marketplace ready")
  if (!String(v.bodyStyle || '').trim()) errs.push('body style');
  if (!String(v.exteriorColor || '').trim()) errs.push('exterior color');
  if (!String(v.interiorColor || '').trim()) errs.push('interior color');
  return errs;
}


const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
function tokens(v, s) {
  const features = (v.features || []).slice(0, 25);
  const safety = (v.safetyFeatures || []).filter((x) => !features.includes(x)).slice(0, 15);
  const owners = String(v.owners ?? '').trim();
  const acc = String(v.accidents ?? '').trim();
  const history = [
    owners && /^\d+$/.test(owners) ? (owners === '1' ? '1 owner' : `${owners} owners`) : owners,
    acc === '0' ? 'no accidents reported' : acc && /^\d+$/.test(acc) ? `${acc} accident${acc === '1' ? '' : 's'} reported` : acc,
  ].filter(Boolean).join(', ');
  const condText = v.certified || v.condition === 'cpo' ? 'Certified pre-owned' : v.condition === 'new' ? 'New' : v.conditionText || 'Used';
  return {
    price_line: v.price ? ' - $' + fmtNum(v.price) : '',
    comments: String(v.comments || '').trim().slice(0, 1500),
    condition_text: condText,
    horsepower: v.horsepower ? String(v.horsepower).replace(/\s*hp$/i, '') + ' hp' : '',
    mpg: v.mpg || '', doors: v.doors || '', seats: v.seats || '',
    history: history ? history.charAt(0).toUpperCase() + history.slice(1) : '',
    safety_block: safety.length ? '\n🛡️ Safety:\n' + safety.map((f) => '• ' + f).join('\n') + '\n' : '',
    // "Installed options" (the CarGurus name): features and safety features together, one plain line
    options_block: features.length + safety.length ? '\nInstalled options: ' + [...features, ...safety].join(', ') + '\n' : '',
    year: v.year || '', make: v.make || '', model: v.model || '', trim: v.trim || '',
    price: v.price ? '$' + fmtNum(v.price) : '', mileage: fmtNum(v.mileage), vin: v.vin || '', stock: v.stock || '',
    processing_fee: v.processingFee ? '$' + fmtNum(v.processingFee) : '',
    exterior: v.exteriorColor || '', interior: v.interiorColor || '', transmission: v.transmission || '',
    fuel: v.fuelType || '', drivetrain: v.drivetrain || '', engine: v.engine || '', body: v.bodyStyle || '',
    condition: v.condition || '', title: v.title || '',
    features: features.join(', '),
    features_block: features.length ? '\n⭐ Features & options:\n' + features.map((f) => '• ' + f).join('\n') + '\n' : '',
    dealer_name: s.dealerName || '', dealer_phone: s.phone || '', dealer_address: [s.address, s.city].filter(Boolean).join(', '),
    dealer_website: s.website || '',
  };
}
// Fill {tokens}. Segments ("Label: {token}" between | separators) whose tokens are all empty are dropped,
// and a line is dropped when all of its token segments are empty (so no "Engine: " with nothing after it).
function fill(tpl, t) {
  const val = (k) => (t[k] !== undefined && t[k] !== null ? String(t[k]) : '');
  const out = [];
  for (const raw of String(tpl || '').split('\n')) {
    if (!/\{\w+\}/.test(raw)) { out.push(raw); continue; }
    // a bullet in front ("• ", "✅ ", "- ") stays even when the first segment is dropped
    const bullet = (raw.match(/^\s*(?:[•✅\-*]|[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?)\s+(?=[^{]*:|\{)/u) || [''])[0];
    const line = raw.slice(bullet.length);
    const segs = line.split('|').filter((seg) => {
      const ks = [...seg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return !ks.length || ks.some((k) => val(k).trim() !== '');
    });
    if (!segs.some((seg) => /\{\w+\}/.test(seg))) continue;
    out.push(bullet + segs.map((s) => s.trim()).join(' | ').replace(/\{(\w+)\}/g, (_, k) => val(k)));
  }
  return out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
}
export function cleanTags(raw) {
  const seen = new Set(), out = [];
  for (const p of String(raw || '').split(/[\s,;]+/)) {
    const t = p.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase()); out.push('#' + t);
    if (out.length >= 15) break;
  }
  return out.join(' ');
}
export function templateCopy(v, s) {
  const t = tokens(v, s);
  const title = fill(s.titleTemplate || DEFAULT_SETTINGS.titleTemplate, t).replace(/\s+/g, ' ').slice(0, 100);
  t.title = title;
  // saved settings that still hold one of our earlier default templates get the current plain one
  let tpl = !s.descriptionTemplate || s.descriptionTemplate === OLD_DESCRIPTION_TEMPLATE || s.descriptionTemplate === ICON_TEMPLATE ? DEFAULT_SETTINGS.descriptionTemplate : s.descriptionTemplate;
  // Ensure processing fee is included in the description template if not already present
  if (t.processing_fee && !tpl.includes('{processing_fee}')) {
    if (tpl.includes('{history}')) {
      tpl = tpl.replace('{history}', 'Processing fee: {processing_fee}\nHistory: {history}');
    } else {
      tpl = tpl + '\nProcessing fee: {processing_fee}';
    }
  }
  let description = fill(tpl, t);
  if (t.processing_fee && !description.toLowerCase().includes('processing fee:')) {
    description += `\nProcessing fee: ${t.processing_fee}`;
  }
  const slug = (x) => String(x || '').replace(/[^A-Za-z0-9]/g, '');
  const tags = [s.defaultHashtags, slug(v.make), slug(v.make) + slug(v.model), slug(v.model), v.bodyStyle && slug(v.bodyStyle),
    s.city && slug(s.city) + 'cars', v.year && slug(v.make) && v.year + slug(v.make)].filter(Boolean).join(' ');
  return { title, description, hashtags: cleanTags(tags), source: 'template' };
}

export async function aiCopy(v, s) {
  const facts = {
    year: v.year, make: v.make, model: v.model, trim: v.trim, price: v.price, processingFee: v.processingFee, mileage: v.mileage, condition: v.condition,
    bodyStyle: v.bodyStyle, exteriorColor: v.exteriorColor, interiorColor: v.interiorColor, transmission: v.transmission,
    fuelType: v.fuelType, drivetrain: v.drivetrain, engine: v.engine, features: v.features, vin: v.vin, stock: v.stock,
    horsepower: v.horsepower, mpg: v.mpg, doors: v.doors, seats: v.seats, owners: v.owners, accidents: v.accidents,
    safetyFeatures: v.safetyFeatures, dealerComments: v.comments, website: s.website,
    dealer: { name: s.dealerName, phone: s.phone, address: [s.address, s.city].filter(Boolean).join(', ') },
  };
  const prompt =
    'Write a Facebook Marketplace vehicle listing for a car dealership using ONLY these facts (never invent features, ' +
    'history, warranties or financing terms not given):\n' + JSON.stringify(facts) +
    '\n\nReturn strict JSON only: {"title": string (max 80 chars, Year Make Model Trim + 1 key selling point), ' +
    '"description": string (180-320 words, plain text: a short engaging intro, then a "VEHICLE DETAILS" list with every fact given ' +
    '(trim, engine, drivetrain, colors, mileage, history, VIN, stock), then "Installed options:" with the features and safety features ' +
    'separated by commas, then the dealer contact and a call to message/call. Plain text only: NO emojis, NO icons, NO bullet points or check marks), ' +
    '"hashtags": string (8-12 relevant hashtags separated by spaces)}';
  let text = '';
  if (s.aiProvider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.aiKey}` },
      body: JSON.stringify({ model: s.aiModel || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('OpenAI: ' + ((j.error && j.error.message) || r.status));
    text = j.choices[0].message.content;
  } else if (s.aiProvider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': s.aiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: s.aiModel || 'claude-haiku-5-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('Anthropic: ' + ((j.error && j.error.message) || r.status));
    text = (j.content || []).map((c) => c.text || '').join('');
  } else {
    throw new Error('No AI provider configured');
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI did not return JSON');
  const out = JSON.parse(m[0]);
  if (!out.title || !out.description) throw new Error('AI response missing title/description');
  return { title: String(out.title).slice(0, 100), description: String(out.description).slice(0, 6000), hashtags: cleanTags(out.hashtags), source: 'ai' };
}


// Text that goes into Facebook's Description box
export function fbDescription(v, s) {
  const parts = [];
  if (v.title) parts.push(v.title);
  if (v.description) {
    let desc = v.title && v.description.startsWith(v.title) ? v.description.slice(v.title.length).trim() : v.description;
    const fee = v.processingFee ? Number(v.processingFee) : 0;
    if (fee > 0 && !desc.toLowerCase().includes('processing fee:')) {
      desc += `\nProcessing fee: $${fmtNum(fee)}`;
    }
    parts.push(desc);
  }
  if (v.hashtags) parts.push(cleanTags(v.hashtags));
  if (s.disclaimer) parts.push(s.disclaimer);
  return parts.filter(Boolean).join('\n\n').slice(0, 9000);
}
