import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { VehiclesService } from '../vehicles/vehicles.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CargurusService } from '../cargurus/cargurus.service.js';
import { LeadsService } from '../leads/leads.service.js';
import { FacebookService } from '../facebook/facebook.service.js';
import { cleanSettingsPatch, type Hours } from '../tenants/settings.fields.js';
import type { AuthUser } from '../common/auth.types.js';
import {
  PAGES, actionCatalog, areasOf, cleanActions, confirmReason, linkFor, money, planActions, settingLabel,
  type Action, type Car, type Change, type DealerSnap, type LeadRow,
} from './ai.actions.js';
import { aiAllowed, aiConfig, AiError, aiText, claudeCall, claudeText, extractJson, httpJson, oaiCall } from './ai.provider.js';
import { CLOSEUP_PROMPT, FAST_RULES, FAST_SHAPE, mapNhtsa, normalize, normFrames, VIDEO_RULES, VIDEO_SHAPE, vinOk } from './ai.vehicle.js';

type Img = { data?: string; media_type?: string; kind?: string };

/** base64 pictures from the browser: only JPEG / PNG / WebP, size-capped */
function images(list: unknown, max: number, maxChars = 4_000_000): { data: string; media_type: string; kind: string }[] {
  if (!Array.isArray(list)) return [];
  return (list as Img[])
    .slice(0, max)
    .filter((x) => x && typeof x.data === 'string' && x.data.length > 100 && x.data.length <= maxChars && /^[A-Za-z0-9+/=\r\n]+$/.test(x.data.slice(0, 200)))
    .map((x) => ({
      data: String(x.data),
      media_type: ['image/jpeg', 'image/png', 'image/webp'].includes(String(x.media_type)) ? String(x.media_type) : 'image/jpeg',
      kind: String(x.kind || 'photo').slice(0, 60),
    }));
}

/* ---------- "Just tell it" command bar: actions, plans and undo (see ai.actions.ts) ---------- */
const STATUS_TXT = { PUBLISHED: 'For sale', DRAFT: 'Draft', SOLD: 'Sold' } as const;
/** a plan waiting for a click on Confirm (10 minutes) */
type StoredPlan = { tenantId: string; user: string; actions: Action[]; at: number };
/** what Undo puts back (30 minutes) */
type UndoEntry = {
  at: number;
  vehicles: { id: string; data: Record<string, unknown> }[];
  leads: { id: string; status: string }[];
  settings: Record<string, unknown>;
};
const DEALER_KEYS = ['name', 'legalName', 'tagline', 'phone', 'email', 'street', 'city', 'state', 'zip', 'country', 'siteUrl', 'facebook', 'instagram', 'google', 'googleReviews', 'youtube', 'tiktok', 'messenger', 'hours', 'hoursShort', 'feedOperation', 'leadTo', 'brandImages'] as const;

@Injectable()
export class AiService {
  /** last command per dealership user, for Undo (30 minutes) */
  private undoStore = new Map<string, UndoEntry>();
  /** plans waiting for Confirm, by id */
  private plans = new Map<string, StoredPlan>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly cargurus: CargurusService,
    private readonly leadsSvc: LeadsService,
    private readonly facebook: FacebookService,
  ) {}

  private guard(tenantId: string) {
    const c = aiConfig();
    if (!c.key) throw new AiError(`AI is not set up yet: add ${c.keyEnv} to the backend .env file and restart the API.`, 503);
    if (!aiAllowed(tenantId, c.maxPerHour)) throw new AiError('The hourly limit of AI requests has been reached. Try again later.', 429);
    return c;
  }

  /** turns AI errors into normal HTTP answers with a readable message */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof AiError) throw new HttpException({ statusCode: e.status, message: e.message }, e.status);
      throw new HttpException({ statusCode: 500, message: (e as Error).message || 'Something went wrong' }, 500);
    }
  }

  status() {
    const c = aiConfig();
    return { hasKey: !!c.key, provider: c.id, model: `${c.name} · ${c.model}`, video: c.oai, voice: c.oai };
  }

  async decodeVin(vinIn: unknown) {
    const vin = String(vinIn || '').trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw new BadRequestException('A VIN has exactly 17 letters and numbers, and never I, O or Q.');
    const r = await httpJson(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`, undefined, {}, 30_000);
    if (r.code >= 400 || !r.json) throw new AiError(`The VIN database answered with error ${r.code}. Try again in a moment.`, 502);
    const rec = r.json?.Results?.[0] || {};
    return { ...mapNhtsa(rec), checkDigitOk: vinOk(vin) };
  }

  /** Photos → colours, interior, transmission, mileage, features, photo angles, cover, description (one request). */
  async analyze(tenantId: string, body: { images?: unknown; vehicle?: unknown }) {
    const t0 = Date.now();
    const imgs = images(body.images, 40, 2_000_000);
    if (!imgs.length) throw new BadRequestException('Add at least one photo first.');
    const c = this.guard(tenantId);
    const vehicle = body.vehicle && typeof body.vehicle === 'object' ? body.vehicle : {};
    const prompt = `${FAST_RULES}\n\nVehicle from the official VIN record: ${JSON.stringify(vehicle)}\n\nReply with ONLY this JSON (no other text):\n${FAST_SHAPE}`;
    let raw: any;
    let usage: unknown = null;
    if (c.oai) {
      const parts: unknown[] = [];
      imgs.forEach((im, i) => {
        parts.push({ type: 'text', text: `Photo ${i + 1}` });
        parts.push({ type: 'image_url', image_url: { url: `data:${im.media_type};base64,${im.data}` } });
      });
      parts.push({ type: 'text', text: prompt });
      const r = await oaiCall([{ role: 'user', content: parts }], 1800, true);
      raw = extractJson(r.text);
      usage = r.usage;
    } else {
      const content: unknown[] = [];
      imgs.forEach((im, i) => {
        content.push({ type: 'text', text: `Photo ${i + 1}` });
        content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } });
      });
      content.push({ type: 'text', text: prompt });
      const j = await claudeCall({ max_tokens: 1800, messages: [{ role: 'user', content }] });
      raw = extractJson(claudeText(j));
      usage = j.usage ?? null;
    }
    const f = normalize(raw);
    f.description = String(raw?.description ?? '').trim();
    f.photos = normFrames(raw?.photos, imgs.length);
    f.best_cover_photo = Number.isFinite(Number(raw?.best_cover_photo)) && raw?.best_cover_photo !== null ? Math.trunc(Number(raw.best_cover_photo)) : null;
    return { findings: f, usage, model: c.model, ms: Date.now() - t0 };
  }

  /** One part (≤ 12 frames) of a walkaround video, plus the dealer's voice on the first part. */
  async analyzeVideo(tenantId: string, body: { frames?: unknown; audio?: unknown }) {
    const t0 = Date.now();
    const frames = images(body.frames, 12, 1_000_000);
    if (!frames.length) throw new BadRequestException('No pictures received from the video.');
    const c = this.guard(tenantId);
    if (!c.oai) throw new BadRequestException('The video feature needs Gemini, OpenRouter or Qwen. Set AI_PROVIDER=gemini in the backend .env.');
    const audio = typeof body.audio === 'string' && body.audio.length < 12_000_000 ? body.audio : '';
    const prompt = `${VIDEO_RULES}\n\nReply with ONLY this JSON (no other text):\n${VIDEO_SHAPE}`;
    const build = (withAudio: boolean) => {
      const parts: unknown[] = [];
      frames.forEach((im, i) => {
        parts.push({ type: 'text', text: `Frame ${i + 1}` });
        parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.data}` } });
      });
      if (withAudio) {
        parts.push({ type: 'text', text: 'Audio of the dealer talking while filming:' });
        parts.push({ type: 'input_audio', input_audio: { data: audio, format: 'wav' } });
      }
      parts.push({ type: 'text', text: prompt + (withAudio ? '' : '\n(No audio available: spoken_notes must be [].)') });
      return [{ role: 'user', content: parts }];
    };
    let audioUsed = audio !== '';
    const maxTok = Math.min(5000, 1400 + 45 * frames.length);
    let r: { text: string; usage: unknown };
    try {
      r = await oaiCall(build(audioUsed), maxTok, true);
    } catch (e) {
      if (!audioUsed) throw e;
      audioUsed = false; // the model refused the sound: read the pictures only
      r = await oaiCall(build(false), maxTok, true);
    }
    const raw = extractJson(r.text);
    const f = normalize(raw);
    delete f.vehicle_matches_vin;
    delete f.vin_in_photo;
    delete f.best_cover_photo;
    const vin = raw?.vin_in_video;
    f.vin_in_video =
      vin && typeof vin === 'object'
        ? { value: vin.value ? String(vin.value).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null, confidence: vin.confidence || 'low', evidence: String(vin.evidence ?? '') }
        : { value: null, confidence: 'low', evidence: 'not visible' };
    if (f.vin_in_video.value && !vinOk(f.vin_in_video.value)) f.vin_in_video.confidence = 'low';
    f.seen_vehicle = String(raw?.seen_vehicle ?? '').replace(/^null$/i, '');
    f.spoken_notes = audioUsed ? (Array.isArray(raw?.spoken_notes) ? raw.spoken_notes : []).map(String).filter(Boolean) : [];
    const nf = frames.length;
    f.frames = normFrames(raw?.frames, nf);
    const nums = (a: unknown) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= nf))];
    f.vin_frames = nums(raw?.vin_frames);
    f.odometer_frames = nums(raw?.odometer_frames);
    f.audio_used = audioUsed;
    return { findings: f, usage: r.usage, ms: Date.now() - t0 };
  }

  /** Second, focused pass: sharp full-size pictures of the VIN sticker and the odometer. */
  async readCloseups(tenantId: string, body: { images?: unknown }) {
    const imgs = images(body.images, 4, 4_000_000);
    if (!imgs.length) return { vin: null, odometer_miles: null };
    const c = this.guard(tenantId);
    if (!c.oai) return { vin: null, odometer_miles: null };
    const parts: unknown[] = [];
    imgs.forEach((im, i) => {
      parts.push({ type: 'text', text: `Close-up ${i + 1} (${im.kind})` });
      parts.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im.data}` } });
    });
    parts.push({ type: 'text', text: CLOSEUP_PROMPT });
    const r = await oaiCall([{ role: 'user', content: parts }], 1500, true);
    const raw = extractJson(r.text);
    let vin: { value: string; confidence: string; evidence: string; valid: boolean } | null = null;
    if (raw?.vin && typeof raw.vin === 'object') {
      const cands = [String(raw.vin.value ?? ''), ...(Array.isArray(raw.vin.candidates) ? raw.vin.candidates.map(String) : [])]
        .map((x) => x.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
        .filter((x) => x && x !== 'NULL');
      const good = cands.find((x) => vinOk(x)) || null;
      const val = good || cands[0] || null;
      if (val) vin = { value: val, confidence: good ? raw.vin.confidence || 'medium' : 'low', evidence: String(raw.vin.evidence ?? ''), valid: !!good };
    }
    let odo: { value: number; confidence: string; evidence: string } | null = null;
    const ov = raw?.odometer_miles?.value;
    if (ov !== null && ov !== undefined) {
      const n = String(ov).replace(/[^0-9]/g, '');
      if (n) odo = { value: Number(n), confidence: raw.odometer_miles.confidence || 'medium', evidence: String(raw.odometer_miles.evidence ?? '') };
    }
    return { vin, odometer_miles: odo };
  }

  async writeDescription(tenantId: string, body: { facts?: unknown }) {
    this.guard(tenantId);
    const facts = body.facts && typeof body.facts === 'object' ? body.facts : {};
    const prompt = `Write a vehicle listing description for a car dealership website.

RULES
- 70 to 120 words, friendly and professional, plain text, no headings, no emojis.
- Use ONLY the facts in the JSON below. Do not add features, condition claims, history, warranty, financing or anything not listed.
- If previous owners or accidents are given, you may mention them exactly as given; if missing, do not mention them.
- Do not mention the price or VIN.
- End with one short invitation to contact or visit the dealership named in the facts.

FACTS:
${JSON.stringify(facts, null, 2).slice(0, 8000)}

Reply with the description only.`;
    const r = await aiText(prompt, 4000);
    return { text: r.text.trim() };
  }

  /** Voice (browsers without speech recognition): the recording is turned into words by the AI. */
  async transcribe(tenantId: string, body: { audio?: unknown }) {
    const audio = typeof body.audio === 'string' ? body.audio : '';
    if (!audio || audio.length > 6_000_000) throw new BadRequestException('Voice could not be turned into text here. Please type instead.');
    const c = this.guard(tenantId);
    if (!c.oai) throw new BadRequestException('Voice could not be turned into text here. Please type instead.');
    const r = await oaiCall(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe exactly what this car dealer says (a command for their inventory system). Reply with the words only, no quotes.' },
            { type: 'input_audio', input_audio: { data: audio, format: 'wav' } },
          ],
        },
      ],
      300,
    );
    return { text: r.text.trim() };
  }

  /* ================= "Just tell it" ================= */

  private async cars(tenantId: string): Promise<Car[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 600,
      select: {
        id: true, year: true, make: true, model: true, trim: true, exteriorColor: true, bodyStyle: true, stockNumber: true, vin: true,
        price: true, mileage: true, status: true, featured: true, images: true, extra: true, createdAt: true,
        syndicateCargurus: true, syndicateFacebook: true,
        fbListing: { select: { status: true } },
      },
    });
    const now = Date.now();
    return rows.map((v, i) => ({
      n: i + 1,
      id: v.id,
      name: [v.year || '', v.make, v.model, v.trim].join(' ').replace(/\s+/g, ' ').trim() || 'Vehicle',
      ext: v.exteriorColor,
      body: v.bodyStyle,
      stock: v.stockNumber,
      vin: v.vin,
      price: v.price == null ? null : Number(v.price),
      mileage: v.mileage,
      status: v.status as Car['status'],
      days: Math.max(0, Math.floor((now - v.createdAt.getTime()) / 86_400_000)),
      photos: v.images.length,
      featured: v.featured,
      fb: !!v.fbListing && ['published', 'awaiting_publish', 'unconfirmed', 'publishing', 'queued'].includes(v.fbListing.status),
      cg: v.syndicateCargurus !== false,
      fbOn: v.syndicateFacebook !== false,
      extra: v.extra && typeof v.extra === 'object' && !Array.isArray(v.extra) ? (v.extra as Record<string, unknown>) : {},
    }));
  }

  /** the latest inquiries (only for users who may see them) */
  private async leadRows(tenantId: string, user: AuthUser): Promise<LeadRow[]> {
    if (!user.perms.includes('leads')) return [];
    const rows = await this.prisma.lead.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: { id: true, name: true, email: true, phone: true, topic: true, status: true, createdAt: true, vehicle: { select: { year: true, make: true, model: true } } },
    });
    const now = Date.now();
    return rows.map((l, i) => ({
      n: i + 1,
      id: l.id,
      name: l.name || 'Customer',
      topic: l.topic,
      vehicle: l.vehicle ? [l.vehicle.year || '', l.vehicle.make, l.vehicle.model].join(' ').trim() : '',
      status: l.status,
      days: Math.max(0, Math.floor((now - l.createdAt.getTime()) / 86_400_000)),
      contact: l.email || l.phone || '',
    }));
  }

  /** the dealership's settings the bar can read and change */
  private async dealer(tenantId: string): Promise<DealerSnap> {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const raw: Record<string, unknown> = {};
    for (const k of DEALER_KEYS) raw[k] = s ? (s as unknown as Record<string, unknown>)[k] : undefined;
    raw.hours = (s?.hours && typeof s.hours === 'object' ? s.hours : {}) as Hours;
    return raw as DealerSnap;
  }

  private async context(tenantId: string, user: AuthUser) {
    const [cars, leads, dealer] = await Promise.all([
      user.perms.includes('inventory') ? this.cars(tenantId) : Promise.resolve([] as Car[]),
      this.leadRows(tenantId, user),
      this.dealer(tenantId),
    ]);
    return { cars, leads, dealer };
  }

  async command(tenantId: string, body: { text?: unknown }, user: AuthUser) {
    const text = String(body.text || '').trim().slice(0, 600);
    if (!text) throw new BadRequestException('Type or say what you want to do.');
    const c = aiConfig();
    // no AI configured: the bar still works as a normal inventory search
    if (!c.key) return { intent: 'search', reply: 'Searching your inventory…', search: text, car_ids: [], cars: [], actions: [], changes: [], errors: [], noAi: true };
    this.guard(tenantId);
    const { cars, leads, dealer } = await this.context(tenantId, user);
    const carLines = cars
      .map((x) =>
        [x.n, x.name, x.ext || '-', x.body || '-', `stock ${x.stock || '-'}`, x.vin ? `VIN …${x.vin.slice(-6)}` : 'VIN -', money(x.price), x.mileage == null ? '- mi' : `${x.mileage.toLocaleString('en-US')} mi`,
          STATUS_TXT[x.status].toLowerCase(), `${x.days} days listed`, `${x.photos} photos`, x.featured ? 'featured' : 'not featured', x.fb ? 'on Facebook' : 'not on Facebook',
          `CarGurus ${x.cg ? 'on' : 'off'}`, `Facebook ${x.fbOn ? 'allowed' : 'off'}`].join(' | '),
      )
      .join('\n');
    const leadLines = leads.map((l) => [`L${l.n}`, l.name, l.topic, l.vehicle || '-', l.status.toLowerCase(), `${l.days} days ago`, l.contact || '-'].join(' | ')).join('\n');
    const ch = String(dealer.feedOperation || '').trim() ? String(dealer.feedOperation) : 'cargurus,marketplace (default)';
    const dealerLines = [
      `name: ${dealer.name || '-'}`, `phone: ${dealer.phone || '-'}`, `public email: ${dealer.email || '-'}`,
      `address: ${[dealer.street, dealer.city, dealer.state, dealer.zip].filter(Boolean).join(', ') || '-'}`,
      `opening hours: ${dealer.hoursShort || '-'}`, `channels (where vehicles are sent besides the website): ${ch}`,
      ...(user.perms.includes('settings') ? [`inquiry email: ${dealer.leadTo || '-'}`, `photo branding: ${dealer.brandImages ? 'on' : 'off'}`] : []),
    ].join('\n');
    const prompt = `You are the assistant inside a car dealership's portal. The dealer typed or said a request. Do what they ask: you can change things directly with the actions below. Today is ${new Date().toISOString().slice(0, 10)}.

DEALERSHIP
${dealerLines}

INVENTORY (${cars.length} cars, one per line: number | vehicle | colour | body | stock | VIN end | price | mileage | status | days listed | photos | featured | Facebook | CarGurus | Facebook allowed):
${carLines || '(no cars, or no access)'}
${leads.length ? `\nINQUIRIES (latest ${leads.length}, one per line: number | name | topic | vehicle | status | received | contact):\n${leadLines}\n` : ''}
REQUEST: ${JSON.stringify(text)}

Decide what the dealer wants:
- "action": DO something. Use one or more of these actions:
${actionCatalog(user.perms)}
- "question": a question about the inventory, inquiries or the dealership. Put the matching car numbers in cars and the answer in reply.
- "search": they only want to find or look at cars; put a short search text (make, model, VIN or stock number) in search, and the matching car numbers in cars.
- "navigate": ONLY when they ask to see / open / go to a page ("show me my leads", "open CarGurus settings"), or for something no action can do (adding a new car, uploading a logo, writing content). page = one of: ${PAGES.join(', ')}.
- "unclear": you can't tell which car or what to do. Ask one short question in reply and list the possible cars in cars.

RULES
- Prefer "action" over "navigate" whenever an action can do it: "turn off CarGurus" = action cargurus_feed {on:false}; "post the Escape to Marketplace" = action post_marketplace on that car; "change our phone to …" = action update_business.
- Only use car / lead numbers from the lists. Never invent cars or leads. Lead numbers are written L1, L2 … — put just the number in leads.
- Match cars by year, make, model, trim, colour, body, stock number, VIN or status. "listed over 60 days" means days listed > 60. "under $5,000" means price < 5000.
- An action on "the Corolla" when several cars match and the dealer didn't say "all" → intent unclear.
- Sold cars are not "for sale". Price changes and unpublishing normally apply to cars for sale only, unless the dealer says otherwise.
- reply: one short friendly sentence saying what you are doing (e.g. "Turning off your CarGurus feed.", "Lowering the price by $300 on 4 cars listed over 60 days.").

Reply with ONLY this JSON:
{"intent":"action|question|search|navigate|unclear","reply":"","cars":[],"leads":[],"actions":[{"type":"","cars":[],"leads":[],"params":{}}],"search":"","page":""}`;
    const r = await aiText(prompt, 3000);
    const raw = extractJson(r.text);
    const carByN = new Map(cars.map((x) => [x.n, x.id]));
    const leadByN = new Map(leads.map((x) => [x.n, x.id]));
    const carId = (x: unknown) => carByN.get(Math.trunc(Number(x))) || null;
    const leadId = (x: unknown) => leadByN.get(Math.trunc(Number(String(x).replace(/^L/i, '')))) || null;
    let intent = ['action', 'question', 'search', 'navigate', 'unclear'].includes(raw?.intent) ? raw.intent : 'unclear';
    const ids = [...new Set((Array.isArray(raw?.cars) ? raw.cars : []).map(carId).filter(Boolean) as string[])];
    const { actions, denied } = intent === 'action' ? cleanActions(raw?.actions, carId, leadId, user.perms) : { actions: [], denied: [] as string[] };
    if (intent === 'action' && !actions.length && !denied.length) intent = 'unclear';
    const { changes, errors, notes } = planActions(cars, leads, dealer, actions);
    errors.unshift(...denied);
    const pick = new Set([...ids, ...actions.flatMap((a) => a.car_ids)]);
    const base = {
      reply: String(raw?.reply || '').slice(0, 400) || (intent === 'unclear' ? 'Could you say that a bit more specifically?' : 'Done.'),
      search: String(raw?.search || '').slice(0, 120),
      page: PAGES.includes(raw?.page) ? raw.page : '',
      car_ids: ids,
      cars: cars.filter((x) => pick.has(x.id)).slice(0, 60).map(({ id, name, stock, ext, price, status, photos }) => ({ id, name, stock, ext, price, status, photos })),
      notes,
    };
    if (intent !== 'action') return { intent, ...base, actions: [], changes: [], errors };
    if (!changes.length) return { intent: 'action', ...base, actions, changes: [], errors, executed: false };

    // low-risk: do it straight away (Undo is offered); deleting or changing many things at once: one click on Confirm
    const reason = confirmReason(changes);
    if (!reason && body && (body as { auto?: unknown }).auto !== false) {
      const done = await this.exec(tenantId, user, actions);
      return { intent: 'action', ...base, ...done, errors: [...errors, ...done.errors], notes: [...notes, ...done.notes] };
    }
    const planId = this.storePlan(tenantId, user, actions);
    return { intent: 'action', ...base, actions, planId, needsConfirm: true, confirmReason: reason, changes: changes.map(view), errors, executed: false };
  }

  private storePlan(tenantId: string, user: AuthUser, actions: Action[]) {
    const now = Date.now();
    for (const [k, p] of this.plans) if (now - p.at > 10 * 60_000) this.plans.delete(k);
    const id = randomUUID();
    this.plans.set(id, { tenantId, user: user.id, actions, at: now });
    return id;
  }

  /** Confirm: runs a plan from command() (planId), or the actions the portal sends (older portals) */
  async apply(tenantId: string, body: { planId?: unknown; actions?: unknown }, user: AuthUser) {
    let actions: Action[];
    if (body.planId) {
      const p = this.plans.get(String(body.planId));
      // a plan only runs for the same dealership and user, once, within 10 minutes
      if (!p || p.tenantId !== tenantId || p.user !== user.id || Date.now() - p.at > 10 * 60_000) throw new BadRequestException('This request has expired. Please ask again.');
      this.plans.delete(String(body.planId));
      actions = p.actions;
    } else {
      const { cars, leads } = await this.context(tenantId, user);
      const knownC = new Set(cars.map((c) => c.id));
      const knownL = new Set(leads.map((l) => l.id));
      // the portal sends ids (not numbers): only this dealership's
      actions = cleanActions(
        body.actions,
        (x) => (typeof x === 'string' && knownC.has(x) ? x : null),
        (x) => (typeof x === 'string' && knownL.has(x) ? x : null),
        user.perms,
      ).actions;
    }
    return this.exec(tenantId, user, actions);
  }

  /** Runs the actions on the current data (scoped to this dealership; every change goes through the normal services). */
  private async exec(tenantId: string, user: AuthUser, actions: Action[]) {
    const { cars, leads, dealer } = await this.context(tenantId, user);
    const { changes, errors, notes } = planActions(cars, leads, dealer, actions);
    const may = (perm: string) => user.perms.includes(perm as never);
    const done: Change[] = [];
    const undo: UndoEntry = { at: Date.now(), vehicles: [], leads: [], settings: {} };
    const carBy = new Map(cars.map((c) => [c.id, c]));
    const leadBy = new Map(leads.map((l) => [l.id, l]));

    // vehicles: the normal vehicle service (validation, CarGurus feed refresh, audit)
    for (const ch of changes.filter((x) => x.kind === 'vehicle')) {
      if (!may('inventory')) continue;
      const cur = carBy.get(ch.id)!;
      try {
        if (ch.data.delete) {
          await this.vehicles.remove(tenantId, ch.id, user);
        } else {
          await this.vehicles.update(tenantId, ch.id, ch.data, user);
          const prev: Record<string, unknown> = {};
          if ('status' in ch.data) prev.status = cur.status;
          if ('price' in ch.data) prev.price = cur.price;
          if ('featured' in ch.data) prev.featured = cur.featured;
          if ('extra' in ch.data) prev.extra = cur.extra;
          if ('syndicateCargurus' in ch.data) prev.syndicateCargurus = cur.cg;
          if ('syndicateFacebook' in ch.data) prev.syndicateFacebook = cur.fbOn;
          undo.vehicles.push({ id: ch.id, data: prev });
        }
        done.push(ch);
      } catch (e) {
        errors.push(`${ch.target}: ${(e as Error).message}`);
      }
    }

    // Facebook Marketplace: queued one after another (the progress bar at the top shows it)
    const posts = changes.filter((x) => x.kind === 'facebook');
    if (posts.length && may('inventory')) {
      try {
        const r = await this.facebook.publish(tenantId, user, posts.map((p) => p.id));
        const bad = new Map((r.rejected || []).map((x) => [x.id, x.error]));
        for (const p of posts) (bad.has(p.id) ? errors.push(bad.get(p.id)!) : done.push(p));
        if (r.queued) notes.push(`${r.queued} vehicle${r.queued === 1 ? ' is' : 's are'} queued for Facebook Marketplace — the bar at the top shows the progress.`);
      } catch (e) {
        errors.push(`Facebook Marketplace: ${(e as Error).message}`);
      }
    }

    // leads
    for (const ch of changes.filter((x) => x.kind === 'lead')) {
      if (!may('leads')) continue;
      try {
        if (ch.data.delete) await this.leadsSvc.remove(tenantId, ch.id, user);
        else {
          await this.leadsSvc.update(tenantId, ch.id, { status: String(ch.data.status) }, user);
          undo.leads.push({ id: ch.id, status: leadBy.get(ch.id)!.status });
        }
        done.push(ch);
      } catch (e) {
        errors.push(`${ch.target}: ${(e as Error).message}`);
      }
    }

    // dealership settings: one save, same rules as Business details / Email & advanced settings
    const settingCh = changes.filter((x) => x.kind === 'setting');
    if (settingCh.length) {
      const patch: Record<string, unknown> = Object.assign({}, ...settingCh.map((c) => c.data));
      const { data, denied, invalid } = cleanSettingsPatch(patch, { business: may('business'), settings: may('settings') });
      if (denied.length) errors.push(`You may not change: ${denied.map(settingLabel).join(', ')}`);
      if (invalid.length) errors.push(`${invalid.map(settingLabel).join(', ')}: that value isn't valid.`);
      const keys = Object.keys(data);
      if (keys.length) {
        try {
          for (const k of keys) {
            if (k === 'hoursWeek' || k === 'hoursWeekend' || k === 'hoursShort') continue; // follow "hours"
            undo.settings[k] = dealer[k] ?? (k === 'brandImages' ? false : '');
          }
          const s = await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
          if (typeof data.name === 'string' && data.name) await this.prisma.tenant.update({ where: { id: tenantId }, data: { name: data.name } });
          if (s.name && s.phone && (s.street || s.city)) await this.tenants.setOnboarding(tenantId, 'business_done');
          if ('feedOperation' in data) await this.cargurus.afterInventoryChange(tenantId, user.login);
          await this.audit.record('settings.save', { tenantId, actor: user.login, detail: { keys, via: 'ai-command' } });
          for (const c of settingCh) if (Object.keys(c.data).every((k) => k in data)) done.push(c);
        } catch (e) {
          errors.push((e as Error).message);
        }
      }
    }

    const undoable = undo.vehicles.length + undo.leads.length + Object.keys(undo.settings).length > 0;
    if (undoable) this.undoStore.set(`${tenantId}:${user.id}`, undo);
    if (done.length) await this.audit.record('ai.command', { tenantId, actor: user.login, detail: { actions: actions.map((a) => a.type), changes: done.length } });
    return {
      executed: done.length > 0,
      changes: done.map(view),
      errors,
      notes,
      undo: undoable,
      summary: summary(done),
      areas: areasOf(done),
      link: linkFor(done),
    };
  }

  async undo(tenantId: string, user: AuthUser) {
    const key = `${tenantId}:${user.id}`;
    const u = this.undoStore.get(key);
    if (!u || Date.now() - u.at > 30 * 60_000) throw new BadRequestException('There is nothing to undo any more.');
    this.undoStore.delete(key);
    const errors: string[] = [];
    let count = 0;
    for (const it of u.vehicles) {
      try {
        await this.vehicles.update(tenantId, it.id, it.data, user);
        count++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    for (const it of u.leads) {
      try {
        await this.leadsSvc.update(tenantId, it.id, { status: it.status }, user);
        count++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    const areas = new Set<string>();
    if (u.vehicles.length) areas.add('inventory');
    if (u.leads.length) areas.add('leads');
    if (Object.keys(u.settings).length) {
      const { data } = cleanSettingsPatch(u.settings, { business: user.perms.includes('business'), settings: user.perms.includes('settings') });
      // an empty setting that was empty before ("feedOperation": "") goes back to empty
      for (const [k, v] of Object.entries(u.settings)) if ((v === '' || v === null || v === undefined) && !(k in data)) data[k] = '';
      try {
        await this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
        if (typeof data.name === 'string' && data.name) await this.prisma.tenant.update({ where: { id: tenantId }, data: { name: data.name } });
        if ('feedOperation' in data) await this.cargurus.afterInventoryChange(tenantId, user.login);
        await this.audit.record('settings.save', { tenantId, actor: user.login, detail: { keys: Object.keys(data), via: 'ai-command undo' } });
        count += Object.keys(u.settings).length;
        areas.add('business');
        if ('feedOperation' in data) areas.add('cargurus').add('inventory');
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { undone: count, errors, areas: [...areas] };
  }
}

/** a change as the portal shows it (without what is saved) */
function view(c: Change) {
  const { data: _d, ...rest } = c;
  void _d;
  return { ...rest, car: rest.target, stock: rest.sub };
}

/** "CarGurus feed turned off" / "3 changes saved" */
function summary(done: Change[]): string {
  if (!done.length) return '';
  if (done.length === 1) {
    const c = done[0];
    if (c.kind === 'setting') {
      if (c.after === 'On' || c.after === 'Off') return `${c.target} is now ${c.after.toUpperCase()}`;
      return `${c.target} changed to ${c.after}`;
    }
    if (c.kind === 'facebook') return `${c.target} is queued for Facebook Marketplace`;
    if (c.destructive) return `${c.target} deleted`;
    return `${c.target}: ${c.what.charAt(0).toLowerCase()}${c.what.slice(1)}`;
  }
  const kinds = new Set(done.map((c) => c.kind));
  if (kinds.size === 1 && kinds.has('vehicle')) return `${done.length} vehicles updated`;
  if (kinds.size === 1 && kinds.has('setting')) return `${done.length} settings changed`;
  return `${done.length} changes saved`;
}
