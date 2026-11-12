/**
 * "Just tell it" command bar — what it can DO, and the plan of a request (nothing is saved here).
 *
 * Every action the AI may ask for is listed in ACTIONS with the permission it needs, what it acts on (cars, leads or
 * the dealership itself) and whether it is destructive. planActions() turns the AI's actions into a list of changes
 * ("Phone: (540) 555-0100 → (540) 555-0199") from the dealership's current data, so the bar can show exactly what
 * happens, run it, and undo it. The executor lives in AiService (it needs the other services).
 */
import { hoursTexts, type Hours } from '../tenants/settings.fields.js';
import type { Permission } from '../common/permissions.js';

export type Scope = 'car' | 'lead' | 'dealer';
export type ActDef = {
  type: string;
  scope: Scope;
  perm: Permission;
  /** deleting things: always asks for a click on Confirm first */
  destructive?: boolean;
  /** shown to the AI: params and meaning */
  params: string;
  desc: string;
};

/** Everything the bar can do. The prompt is built from this list. */
export const ACTIONS: ActDef[] = [
  // ---- vehicles (cars: [car numbers]) ----
  { type: 'mark_sold', scope: 'car', perm: 'inventory', params: '{sold_price?: number}', desc: 'mark as sold' },
  { type: 'mark_for_sale', scope: 'car', perm: 'inventory', params: '{}', desc: 'publish / put on sale on the website' },
  { type: 'mark_draft', scope: 'car', perm: 'inventory', params: '{}', desc: 'unpublish: move to drafts, hidden from the website' },
  { type: 'set_price', scope: 'car', perm: 'inventory', params: '{price: number}', desc: 'set the price' },
  { type: 'change_price', scope: 'car', perm: 'inventory', params: '{amount: number}', desc: 'raise / lower the price by an amount (negative = lower)' },
  { type: 'change_price_percent', scope: 'car', perm: 'inventory', params: '{percent: number}', desc: 'raise / lower the price by a percentage (negative = lower)' },
  { type: 'feature', scope: 'car', perm: 'inventory', params: '{}', desc: 'show on the website home page (featured)' },
  { type: 'unfeature', scope: 'car', perm: 'inventory', params: '{}', desc: 'remove from the home page' },
  { type: 'vehicle_cargurus', scope: 'car', perm: 'inventory', params: '{on: boolean}', desc: 'include / leave out THESE cars from the CarGurus feed' },
  { type: 'vehicle_facebook', scope: 'car', perm: 'inventory', params: '{on: boolean}', desc: 'allow / stop posting THESE cars to Facebook' },
  { type: 'post_marketplace', scope: 'car', perm: 'inventory', params: '{}', desc: 'post / list these cars on Facebook Marketplace now (queued, one after another)' },
  { type: 'delete_vehicle', scope: 'car', perm: 'inventory', destructive: true, params: '{}', desc: 'delete the car for good' },
  // ---- leads (leads: [lead numbers]) ----
  { type: 'lead_status', scope: 'lead', perm: 'leads', params: '{status: "UNREAD"|"READ"|"REPLIED"|"CLOSED"}', desc: 'change the status of inquiries' },
  { type: 'delete_lead', scope: 'lead', perm: 'leads', destructive: true, params: '{}', desc: 'delete inquiries for good' },
  // ---- the dealership itself (no cars / leads) ----
  { type: 'cargurus_feed', scope: 'dealer', perm: 'business', params: '{on: boolean}', desc: 'turn the whole CarGurus feed on / off for the dealership ("turn off CarGurus", "disable CarGurus feed")' },
  { type: 'marketplace_channel', scope: 'dealer', perm: 'business', params: '{on: boolean}', desc: 'turn Facebook Marketplace on / off as a place the dealership lists vehicles' },
  {
    type: 'update_business',
    scope: 'dealer',
    perm: 'business',
    params: '{fields: {name?, legalName?, tagline?, phone?, email?, street?, city?, state? (2 letters), zip?, country?, siteUrl?, facebook?, instagram?, google?, googleReviews?, youtube?, tiktok?, messenger?}}',
    desc: 'change Business details (an address goes into street / city / state / zip)',
  },
  {
    type: 'set_hours',
    scope: 'dealer',
    perm: 'business',
    params: '{days: {mon?..sun?: {open: "HH:MM", close: "HH:MM"} | "closed"}}',
    desc: 'change opening hours, 24-hour times; list every day that changes (weekdays = mon–fri, weekend = sat + sun)',
  },
  { type: 'lead_email', scope: 'dealer', perm: 'settings', params: '{email: string}', desc: 'the email address new inquiries are sent to' },
  { type: 'photo_branding', scope: 'dealer', perm: 'settings', params: '{on: boolean}', desc: 'turn the branding bands on vehicle photos on / off' },
];
export const ACTION_BY_TYPE = new Map(ACTIONS.map((a) => [a.type, a]));

/** pages the bar can open (portal paths are in the Dealer Portal) */
export const PAGES = [
  'inventory', 'add_vehicle', 'ai_add', 'import', 'facebook', 'marketplace', 'leads', 'cargurus', 'business', 'design', 'content', 'branding', 'blog', 'team', 'overview',
];

/** more than this many cars / leads in one request: one click on Confirm first */
export const BULK_CONFIRM = 10;

/** setting names as the dealer knows them (error messages) */
export function settingLabel(k: string): string {
  return BUSINESS_FIELDS[k] || { leadTo: 'Inquiry email', brandImages: 'Photo branding', feedOperation: 'Where your vehicles are sent', hours: 'Opening hours' }[k] || k;
}

export const BUSINESS_FIELDS: Record<string, string> = {
  name: 'Dealership name', legalName: 'Legal name', tagline: 'Tagline', phone: 'Phone', email: 'Public email', street: 'Street address',
  city: 'City', state: 'State', zip: 'ZIP code', country: 'Country', siteUrl: 'Website address', facebook: 'Facebook page', instagram: 'Instagram',
  google: 'Google Business Profile', googleReviews: 'Google reviews link', youtube: 'YouTube', tiktok: 'TikTok', messenger: 'Messenger',
};

export type Car = {
  n: number;
  id: string;
  name: string;
  ext: string;
  body: string;
  stock: string;
  vin: string;
  price: number | null;
  mileage: number | null;
  status: 'PUBLISHED' | 'DRAFT' | 'SOLD';
  days: number;
  photos: number;
  featured: boolean;
  fb: boolean;
  cg: boolean;
  fbOn: boolean;
  extra: Record<string, unknown>;
};
export type LeadRow = { n: number; id: string; name: string; topic: string; vehicle: string; status: string; days: number; contact: string };
export type DealerSnap = Record<string, unknown> & { hours?: Hours; feedOperation?: string; brandImages?: boolean };

export type Action = { type: string; car_ids: string[]; lead_ids: string[]; params: Record<string, unknown> };
export type Change = {
  /** what it changes: a vehicle, a lead, a dealership setting, or a Facebook post */
  kind: 'vehicle' | 'lead' | 'setting' | 'facebook';
  id: string;
  target: string;
  sub: string;
  what: string;
  before: string;
  after: string;
  destructive?: boolean;
  /** Undo can put it back */
  undoable: boolean;
  /** what is saved (vehicle / lead patch, settings patch, { delete: true }, { post: true }) */
  data: Record<string, unknown>;
};

const STATUS_TXT = { PUBLISHED: 'For sale', DRAFT: 'Draft', SOLD: 'Sold' } as const;
const LEAD_STATUS = ['UNREAD', 'READ', 'REPLIED', 'CLOSED'];
const LEAD_TXT: Record<string, string> = { UNREAD: 'New', READ: 'Read', REPLIED: 'Replied', CLOSED: 'Closed' };
export const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
export const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};
const bool = (v: unknown) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

/** "cargurus,marketplace" → the channels that are on (empty setting = both, the default) */
export function channels(op: unknown): Set<string> {
  const s = String(op ?? '').trim();
  if (!s) return new Set(['cargurus', 'marketplace']);
  return new Set(s.split(',').map((x) => x.trim().toLowerCase()).filter((x) => x === 'cargurus' || x === 'marketplace'));
}
/** the setting for these channels ("website" = website only: both off) */
export const channelsOp = (c: Set<string>) => ['cargurus', 'marketplace'].filter((x) => c.has(x)).join(',') || 'website';

/** The AI's actions, cleaned: known types, targets that exist, what the user may do. */
export function cleanActions(
  input: unknown,
  carId: (x: unknown) => string | null,
  leadId: (x: unknown) => string | null,
  perms: readonly string[],
): { actions: Action[]; denied: string[] } {
  const denied: string[] = [];
  const actions: Action[] = [];
  for (const a of (Array.isArray(input) ? input : []).slice(0, 12)) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const def = ACTION_BY_TYPE.get(String(o.type));
    if (!def) continue;
    if (!perms.includes(def.perm)) {
      denied.push(`You don't have permission to ${def.desc.split(' (')[0]}.`);
      continue;
    }
    const list = (v: unknown) => (Array.isArray(v) ? v : []);
    const car_ids = def.scope === 'car' ? [...new Set(list(o.car_ids ?? o.cars).map(carId).filter(Boolean) as string[])].slice(0, 500) : [];
    const lead_ids = def.scope === 'lead' ? [...new Set(list(o.lead_ids ?? o.leads).map(leadId).filter(Boolean) as string[])].slice(0, 500) : [];
    if (def.scope === 'car' && !car_ids.length) continue;
    if (def.scope === 'lead' && !lead_ids.length) continue;
    actions.push({ type: def.type, car_ids, lead_ids, params: o.params && typeof o.params === 'object' ? (o.params as Record<string, unknown>) : {} });
  }
  return { actions, denied };
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const HHMM = (v: unknown) => {
  const m = String(v ?? '').trim().match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return h >= 0 && h < 24 && min >= 0 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : '';
};

/** opening hours from the AI ({mon: {open, close} | "closed"}) on top of the current ones; null = nothing usable */
export function mergeHours(cur: Hours | undefined, days: unknown): Hours | null {
  if (!days || typeof days !== 'object') return null;
  const out: Hours = JSON.parse(JSON.stringify(cur || {}));
  let any = false;
  for (const d of DAYS) {
    const v = (days as Record<string, unknown>)[d];
    if (v === undefined || v === null) continue;
    if (v === 'closed' || (typeof v === 'object' && ((v as Record<string, unknown>).closed === true || (v as Record<string, unknown>).s === 'closed'))) {
      out[d] = { s: 'closed', o: out[d]?.o || '09:00', c: out[d]?.c || '18:00' };
      any = true;
      continue;
    }
    if (typeof v !== 'object') continue;
    const x = v as Record<string, unknown>;
    const o = HHMM(x.open ?? x.o);
    const c = HHMM(x.close ?? x.c);
    if (!o || !c) continue;
    out[d] = { s: 'open', o, c };
    any = true;
  }
  return any ? out : null;
}

/** The changes a request makes, from the current data. Actions add up (a working copy per car / setting). */
export function planActions(cars: Car[], leads: LeadRow[], dealer: DealerSnap, actions: Action[]) {
  const errors: string[] = [];
  const notes: string[] = [];
  const out: Change[] = [];

  // ---- vehicles ----
  const byId = new Map(cars.map((c) => [c.id, c]));
  type W = { status: Car['status']; price: number | null; featured: boolean; extra: Record<string, unknown>; cg: boolean; fbOn: boolean };
  const work = new Map<string, W>();
  const vch = new Map<string, Change & { whats: string[]; befores: string[]; afters: string[] }>();
  const posts: Change[] = [];
  const deletes: Change[] = [];
  for (const a of actions.filter((x) => ACTION_BY_TYPE.get(x.type)?.scope === 'car')) {
    for (const id of a.car_ids) {
      const car = byId.get(id);
      if (!car) continue;
      if (a.type === 'delete_vehicle') {
        if (!deletes.some((d) => d.id === id))
          deletes.push({ kind: 'vehicle', id, target: car.name, sub: car.stock, what: 'Delete the vehicle', before: STATUS_TXT[car.status], after: 'Deleted', destructive: true, undoable: false, data: { delete: true } });
        continue;
      }
      if (a.type === 'post_marketplace') {
        if (car.fb) notes.push(`${car.name} is already on Facebook Marketplace (or being posted).`);
        else if (!car.fbOn) errors.push(`${car.name}: Facebook is switched off for this vehicle. Turn it on first ("allow the ${car.name} on Facebook").`);
        else if (!posts.some((p) => p.id === id)) posts.push({ kind: 'facebook', id, target: car.name, sub: car.stock, what: 'Post on Facebook Marketplace', before: 'Not on Marketplace', after: 'Queued for Marketplace', undoable: false, data: { post: true } });
        continue;
      }
      const w = work.get(id) || { status: car.status, price: car.price, featured: car.featured, extra: { ...car.extra }, cg: car.cg, fbOn: car.fbOn };
      const ch = vch.get(id) || { kind: 'vehicle' as const, id, target: car.name, sub: car.stock, what: '', before: '', after: '', undoable: true, data: {}, whats: [], befores: [], afters: [] };
      const p = a.params || {};
      const add = (what: string, before: string, after: string) => (ch.whats.push(what), ch.befores.push(before), ch.afters.push(after));
      switch (a.type) {
        case 'mark_sold': {
          if (w.status === 'SOLD') break;
          const sp = toNum(p.sold_price);
          add('Mark as sold', STATUS_TXT[w.status], `Sold${sp && sp > 0 ? ` for ${money(sp)}` : ''}`);
          w.status = 'SOLD';
          ch.data.status = 'SOLD';
          if (sp && sp > 0) ch.data.extra = w.extra = { ...w.extra, soldPrice: sp };
          break;
        }
        case 'mark_for_sale':
          if (w.status === 'PUBLISHED') break;
          if (!car.photos) {
            errors.push(`${car.name} has no photos, so it can't be put on sale. Add photos first.`);
            break;
          }
          if (!(w.price && w.price > 0)) {
            errors.push(`${car.name} has no price, so it can't be put on sale.`);
            break;
          }
          add('Put on sale', STATUS_TXT[w.status], 'For sale');
          w.status = 'PUBLISHED';
          ch.data.status = 'PUBLISHED';
          break;
        case 'mark_draft':
          if (w.status === 'DRAFT') break;
          add('Unpublish (move to drafts)', STATUS_TXT[w.status], 'Draft');
          w.status = 'DRAFT';
          ch.data.status = 'DRAFT';
          break;
        case 'set_price':
        case 'change_price':
        case 'change_price_percent': {
          let next: number | null = null;
          if (a.type === 'set_price') next = toNum(p.price);
          else if (w.price == null) {
            errors.push(`${car.name} has no price yet, so it can't be raised or lowered.`);
            break;
          } else if (a.type === 'change_price') {
            const amt = toNum(p.amount);
            if (amt !== null) next = w.price + amt;
          } else {
            const pct = toNum(p.percent);
            if (pct !== null) next = Math.round(w.price * (1 + pct / 100));
          }
          if (next === null || !Number.isFinite(next)) {
            errors.push(`I couldn't work out the new price for ${car.name}.`);
            break;
          }
          next = Math.round(next * 100) / 100;
          if (next <= 0) {
            errors.push(`${car.name}: the new price would be ${money(next)}. Skipped.`);
            break;
          }
          if (next === w.price) break;
          const diff = w.price == null ? null : next - w.price;
          add(diff == null ? 'Set price' : diff < 0 ? `Lower price by ${money(-diff)}` : `Raise price by ${money(diff)}`, money(w.price), money(next));
          w.price = next;
          ch.data.price = next;
          break;
        }
        case 'feature':
        case 'unfeature': {
          const on = a.type === 'feature';
          if (w.featured === on) break;
          add(on ? 'Feature on the home page' : 'Remove from the home page', on ? 'Not featured' : 'Featured', on ? '★ Featured' : 'Not featured');
          w.featured = on;
          ch.data.featured = on;
          break;
        }
        case 'vehicle_cargurus':
        case 'vehicle_facebook': {
          const on = bool(p.on);
          const cg = a.type === 'vehicle_cargurus';
          if ((cg ? w.cg : w.fbOn) === on) break;
          const label = cg ? 'CarGurus' : 'Facebook';
          add(`${on ? 'Send to' : 'Leave out of'} ${label}`, `${label} ${on ? 'off' : 'on'}`, `${label} ${on ? 'on' : 'off'}`);
          if (cg) ch.data.syndicateCargurus = w.cg = on;
          else ch.data.syndicateFacebook = w.fbOn = on;
          break;
        }
      }
      work.set(id, w);
      vch.set(id, ch);
    }
  }
  for (const ch of vch.values()) {
    if (!Object.keys(ch.data).length) continue;
    const { whats, befores, afters, ...rest } = ch;
    out.push({ ...rest, what: whats.join(' + '), before: befores.join(' · '), after: afters.join(' · ') });
  }
  out.push(...posts, ...deletes);

  // ---- leads ----
  const leadBy = new Map(leads.map((l) => [l.id, l]));
  const ldone = new Set<string>();
  for (const a of actions.filter((x) => ACTION_BY_TYPE.get(x.type)?.scope === 'lead')) {
    for (const id of a.lead_ids) {
      const l = leadBy.get(id);
      if (!l || ldone.has(id)) continue;
      if (a.type === 'delete_lead') {
        ldone.add(id);
        out.push({ kind: 'lead', id, target: l.name, sub: l.topic, what: 'Delete the inquiry', before: LEAD_TXT[l.status] || l.status, after: 'Deleted', destructive: true, undoable: false, data: { delete: true } });
        continue;
      }
      const st = String(a.params.status || '').toUpperCase();
      if (!LEAD_STATUS.includes(st)) {
        errors.push(`"${a.params.status}" is not an inquiry status (New, Read, Replied, Closed).`);
        break;
      }
      if (st === l.status) continue;
      ldone.add(id);
      out.push({ kind: 'lead', id, target: l.name, sub: l.topic, what: `Mark as ${LEAD_TXT[st].toLowerCase()}`, before: LEAD_TXT[l.status] || l.status, after: LEAD_TXT[st], undoable: true, data: { status: st } });
    }
  }

  // ---- the dealership ----
  const s: DealerSnap = { ...dealer, hours: dealer.hours ? JSON.parse(JSON.stringify(dealer.hours)) : undefined };
  const settingRows = new Map<string, Change>();
  const setRow = (key: string, what: string, before: string, after: string, data: Record<string, unknown>, sub = '') => {
    const prev = settingRows.get(key);
    settingRows.set(key, { kind: 'setting', id: key, target: what, sub, what, before: prev ? prev.before : before, after, undoable: true, data: { ...(prev?.data || {}), ...data } });
  };
  const show = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? '(empty)' : String(v));
  for (const a of actions.filter((x) => ACTION_BY_TYPE.get(x.type)?.scope === 'dealer')) {
    const p = a.params || {};
    switch (a.type) {
      case 'cargurus_feed':
      case 'marketplace_channel': {
        const key = a.type === 'cargurus_feed' ? 'cargurus' : 'marketplace';
        const label = key === 'cargurus' ? 'CarGurus feed' : 'Facebook Marketplace';
        const on = bool(p.on);
        const ch = channels(s.feedOperation);
        if (ch.has(key) === on) {
          notes.push(`${label} is already ${on ? 'on' : 'off'}.`);
          break;
        }
        if (on) ch.add(key);
        else ch.delete(key);
        const before = settingRows.get(`channel:${key}`)?.before ?? (on ? 'Off' : 'On');
        s.feedOperation = channelsOp(ch);
        setRow(`channel:${key}`, label, before, on ? 'On' : 'Off', { feedOperation: s.feedOperation }, 'Business details › Where your vehicles are sent');
        // both rows save the same setting: keep it in step
        for (const r of settingRows.values()) if ('feedOperation' in r.data) r.data.feedOperation = s.feedOperation;
        break;
      }
      case 'update_business': {
        const f = p.fields && typeof p.fields === 'object' ? (p.fields as Record<string, unknown>) : {};
        let any = false;
        for (const [k, v] of Object.entries(f)) {
          if (!BUSINESS_FIELDS[k] || v === undefined || v === null) continue;
          let val = String(v).trim();
          if (k === 'state') val = val.toUpperCase();
          if (String(s[k] ?? '') === val) continue;
          any = true;
          setRow(`biz:${k}`, BUSINESS_FIELDS[k], show(s[k]), show(val), { [k]: val }, 'Business details');
          s[k] = val;
        }
        if (!any && Object.keys(f).length) notes.push('Those business details are already set like that.');
        break;
      }
      case 'set_hours': {
        const next = mergeHours(s.hours, p.days);
        if (!next) {
          errors.push("I couldn't read those opening hours. Say for example: “open Saturday 10am to 4pm, closed Sunday”.");
          break;
        }
        const before = hoursTexts(s.hours || {}).hoursShort || '(not set)';
        const after = hoursTexts(next).hoursShort;
        if (before === after) {
          notes.push('Your opening hours are already like that.');
          break;
        }
        setRow('hours', 'Opening hours', before, after, { hours: next }, 'Business details');
        s.hours = next;
        break;
      }
      case 'lead_email': {
        const e = String(p.email || '').trim().toLowerCase();
        if (!e) break;
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) {
          errors.push(`"${p.email}" isn't an email address.`);
          break;
        }
        if (e === String(s.leadTo || '')) {
          notes.push(`Inquiries already go to ${e}.`);
          break;
        }
        setRow('leadTo', 'Inquiry email', show(s.leadTo), e, { leadTo: e }, 'Email & advanced settings');
        s.leadTo = e;
        break;
      }
      case 'photo_branding': {
        const on = bool(p.on);
        if (!!s.brandImages === on) {
          notes.push(`Photo branding is already ${on ? 'on' : 'off'}.`);
          break;
        }
        setRow('brandImages', 'Photo branding', s.brandImages ? 'On' : 'Off', on ? 'On' : 'Off', { brandImages: on }, 'Email & advanced settings');
        s.brandImages = on;
        break;
      }
    }
  }
  out.push(...settingRows.values());
  return { changes: out, errors, notes };
}

/** why a plan needs a click on Confirm first ('' = it can run straight away) */
export function confirmReason(changes: Change[]): string {
  const del = changes.filter((c) => c.destructive);
  if (del.length) return `This deletes ${del.length === 1 ? del[0].target : `${del.length} items`} for good.`;
  const cars = new Set(changes.filter((c) => c.kind === 'vehicle' || c.kind === 'facebook').map((c) => c.id)).size;
  if (cars > BULK_CONFIRM) return `This changes ${cars} vehicles at once.`;
  const leads = changes.filter((c) => c.kind === 'lead').length;
  if (leads > BULK_CONFIRM) return `This changes ${leads} inquiries at once.`;
  return '';
}

/** which parts of the portal show what changed (they reload their data) */
export function areasOf(changes: Change[]): string[] {
  const a = new Set<string>();
  for (const c of changes) {
    if (c.kind === 'vehicle') a.add('inventory');
    if (c.kind === 'facebook') a.add('facebook');
    if (c.kind === 'lead') a.add('leads');
    if (c.kind === 'setting') {
      a.add('business');
      if ('feedOperation' in c.data) a.add('cargurus'), a.add('inventory');
    }
  }
  return [...a];
}

/** where to look at the result */
export function linkFor(changes: Change[]): { href: string; label: string } | null {
  const kinds = new Set(changes.map((c) => c.kind));
  if (kinds.has('setting')) {
    const fo = changes.some((c) => 'feedOperation' in c.data);
    return { href: '/dealer/business', label: fo ? 'View feed settings' : 'View Business details' };
  }
  if (kinds.has('facebook')) return { href: '/dealer/facebook/marketplace', label: 'View Marketplace' };
  if (kinds.has('lead')) return { href: '/dealer/leads', label: 'View inquiries' };
  if (kinds.has('vehicle')) {
    const ids = [...new Set(changes.filter((c) => c.kind === 'vehicle' && !c.destructive).map((c) => c.id))];
    return ids.length === 1 ? { href: `/dealer/inventory/${ids[0]}`, label: 'View vehicle' } : { href: '/dealer/inventory', label: 'View inventory' };
  }
  return null;
}

/** the prompt's list of actions */
export function actionCatalog(perms: readonly string[]): string {
  const can = (a: ActDef) => perms.includes(a.perm);
  const block = (scope: Scope, title: string) =>
    `${title}\n` +
    ACTIONS.filter((a) => a.scope === scope && can(a))
      .map((a) => `  ${a.type} ${a.params} — ${a.desc}${a.destructive ? ' (destructive)' : ''}`)
      .join('\n');
  return [
    block('car', 'ON CARS (put the car numbers in "cars"):'),
    block('lead', 'ON INQUIRIES / LEADS (put the lead numbers in "leads"):'),
    block('dealer', 'ON THE DEALERSHIP (no cars, no leads):'),
  ]
    .filter((b) => b.includes('\n  '))
    .join('\n');
}
