// @ts-nocheck
/* Facebook listing text: template or AI (ported unchanged from fb-poster/marketplace.js).
 * Vehicles here use the old marketplace.js shape: { year, make, model, trim, price, mileage, … }.
 * Settings `s` = Marketplace settings + the dealership's Business details (dealerName, phone, address, city, website). */

export const DEFAULT_SETTINGS = {
  dealerName: '', phone: '', address: '', city: '', website: '',
  titleTemplate: '{year} {make} {model} {trim}',
  descriptionTemplate:
    '{title}\n\n' +
    '✅ Mileage: {mileage} miles\n✅ Exterior: {exterior} | Interior: {interior}\n' +
    '✅ Transmission: {transmission} | Fuel: {fuel}\n✅ Drivetrain: {drivetrain} | Engine: {engine}\n' +
    '{features_block}\n' +
    'Stock #{stock} | VIN: {vin}\n\n' +
    '📍 {dealer_name} {dealer_address}\n📞 Call/Text: {dealer_phone}\n\nMessage us today to schedule a test drive!',
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
  if (v.mileage === null || v.mileage === undefined) errs.push('mileage');
  return errs;
}


const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
function tokens(v, s) {
  const features = (v.features || []).slice(0, 15);
  return {
    year: v.year || '', make: v.make || '', model: v.model || '', trim: v.trim || '',
    price: v.price ? '$' + fmtNum(v.price) : '', mileage: fmtNum(v.mileage), vin: v.vin || '', stock: v.stock || '',
    exterior: v.exteriorColor || '', interior: v.interiorColor || '', transmission: v.transmission || '',
    fuel: v.fuelType || '', drivetrain: v.drivetrain || '', engine: v.engine || '', body: v.bodyStyle || '',
    condition: v.condition || '', title: v.title || '',
    features: features.join(', '),
    features_block: features.length ? '\n⭐ Features:\n' + features.map((f) => '• ' + f).join('\n') + '\n' : '',
    dealer_name: s.dealerName || '', dealer_phone: s.phone || '', dealer_address: [s.address, s.city].filter(Boolean).join(', '),
    dealer_website: s.website || '',
  };
}
// Fill {tokens}. Segments ("Label: {token}" between | separators) whose tokens are all empty are dropped,
// and a line is dropped when all of its token segments are empty (so no "Engine: " with nothing after it).
function fill(tpl, t) {
  const val = (k) => (t[k] !== undefined && t[k] !== null ? String(t[k]) : '');
  const out = [];
  for (const line of String(tpl || '').split('\n')) {
    if (!/\{\w+\}/.test(line)) { out.push(line); continue; }
    const segs = line.split('|').filter((seg) => {
      const ks = [...seg.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      return !ks.length || ks.some((k) => val(k).trim() !== '');
    });
    if (!segs.some((seg) => /\{\w+\}/.test(seg))) continue;
    out.push(segs.map((s) => s.trim()).join(' | ').replace(/\{(\w+)\}/g, (_, k) => val(k)));
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
  const description = fill(s.descriptionTemplate || DEFAULT_SETTINGS.descriptionTemplate, t);
  const slug = (x) => String(x || '').replace(/[^A-Za-z0-9]/g, '');
  const tags = [s.defaultHashtags, slug(v.make), slug(v.make) + slug(v.model), slug(v.model), v.bodyStyle && slug(v.bodyStyle),
    s.city && slug(s.city) + 'cars', v.year && slug(v.make) && v.year + slug(v.make)].filter(Boolean).join(' ');
  return { title, description, hashtags: cleanTags(tags), source: 'template' };
}

export async function aiCopy(v, s) {
  const facts = {
    year: v.year, make: v.make, model: v.model, trim: v.trim, price: v.price, mileage: v.mileage, condition: v.condition,
    bodyStyle: v.bodyStyle, exteriorColor: v.exteriorColor, interiorColor: v.interiorColor, transmission: v.transmission,
    fuelType: v.fuelType, drivetrain: v.drivetrain, engine: v.engine, features: v.features, vin: v.vin, stock: v.stock,
    dealer: { name: s.dealerName, phone: s.phone, address: [s.address, s.city].filter(Boolean).join(', ') },
  };
  const prompt =
    'Write a Facebook Marketplace vehicle listing for a car dealership using ONLY these facts (never invent features, ' +
    'history, warranties or financing terms not given):\n' + JSON.stringify(facts) +
    '\n\nReturn strict JSON only: {"title": string (max 80 chars, Year Make Model Trim + 1 key selling point), ' +
    '"description": string (120-220 words, plain text, short paragraphs, a few ✅ bullet highlights, ends with a call to message/call the dealer), ' +
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
  if (v.description) parts.push(v.title && v.description.startsWith(v.title) ? v.description.slice(v.title.length).trim() : v.description);
  if (v.hashtags) parts.push(cleanTags(v.hashtags));
  if (s.disclaimer) parts.push(s.disclaimer);
  return parts.filter(Boolean).join('\n\n').slice(0, 9000);
}
