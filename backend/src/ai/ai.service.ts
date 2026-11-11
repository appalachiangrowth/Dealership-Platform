import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { VehiclesService } from '../vehicles/vehicles.service.js';
import type { AuthUser } from '../common/auth.types.js';
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

/* ---------- "Just tell it" command bar ---------- */
type Car = {
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
  extra: Record<string, unknown>;
};
type Action = { type: string; car_ids: string[]; params: Record<string, unknown> };
type Change = { id: string; car: string; stock: string; what: string; before: string; after: string; data: Record<string, unknown> };

const ACTION_TYPES = ['mark_sold', 'mark_for_sale', 'mark_draft', 'set_price', 'change_price', 'change_price_percent', 'feature', 'unfeature'];
const PAGES = ['inventory', 'add_vehicle', 'ai_add', 'facebook', 'leads', 'cargurus', 'business', 'design', 'content', 'blog', 'team', 'overview'];
const STATUS_TXT = { PUBLISHED: 'For sale', DRAFT: 'Draft', SOLD: 'Sold' } as const;
const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-US')}`);
const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null;
};

@Injectable()
export class AiService {
  /** last confirmed command per dealership, for Undo (30 minutes) */
  private undoStore = new Map<string, { at: number; items: { id: string; data: Record<string, unknown> }[] }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly vehicles: VehiclesService,
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
      extra: v.extra && typeof v.extra === 'object' && !Array.isArray(v.extra) ? (v.extra as Record<string, unknown>) : {},
    }));
  }

  /** What would change (nothing is saved here). */
  private plan(cars: Car[], actions: Action[]) {
    const byId = new Map(cars.map((c) => [c.id, c]));
    // working copy, so several actions on one car add up
    const work = new Map<string, { status: Car['status']; price: number | null; featured: boolean; extra: Record<string, unknown> }>();
    const changes = new Map<string, Change>();
    const errors: string[] = [];
    for (const a of actions) {
      for (const id of a.car_ids) {
        const car = byId.get(id);
        if (!car) continue;
        const w = work.get(id) || { status: car.status, price: car.price, featured: car.featured, extra: { ...car.extra } };
        const ch = changes.get(id) || { id, car: car.name, stock: car.stock, what: '', before: '', after: '', data: {} };
        const whats: string[] = ch.what ? [ch.what] : [];
        const befores: string[] = ch.before ? [ch.before] : [];
        const afters: string[] = ch.after ? [ch.after] : [];
        const p = a.params || {};
        switch (a.type) {
          case 'mark_sold': {
            if (w.status === 'SOLD') break;
            const sp = toNum(p.sold_price);
            befores.push(STATUS_TXT[w.status]);
            w.status = 'SOLD';
            ch.data.status = 'SOLD';
            if (sp && sp > 0) {
              w.extra = { ...w.extra, soldPrice: sp };
              ch.data.extra = w.extra;
            }
            whats.push('Mark as sold');
            afters.push(`Sold${sp && sp > 0 ? ` for ${money(sp)}` : ''}`);
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
            befores.push(STATUS_TXT[w.status]);
            w.status = 'PUBLISHED';
            ch.data.status = 'PUBLISHED';
            whats.push('Put on sale');
            afters.push('For sale');
            break;
          case 'mark_draft':
            if (w.status === 'DRAFT') break;
            befores.push(STATUS_TXT[w.status]);
            w.status = 'DRAFT';
            ch.data.status = 'DRAFT';
            whats.push('Move to drafts (hidden from the website)');
            afters.push('Draft');
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
            befores.push(money(w.price));
            const diff = w.price == null ? null : next - w.price;
            whats.push(diff == null ? 'Set price' : diff < 0 ? `Lower price by ${money(-diff)}` : `Raise price by ${money(diff)}`);
            w.price = next;
            ch.data.price = next;
            afters.push(money(next));
            break;
          }
          case 'feature':
          case 'unfeature': {
            const on = a.type === 'feature';
            if (w.featured === on) break;
            befores.push(on ? 'Not featured' : 'Featured');
            w.featured = on;
            ch.data.featured = on;
            whats.push(on ? 'Feature on the home page' : 'Remove from the home page');
            afters.push(on ? '★ Featured' : 'Not featured');
            break;
          }
        }
        work.set(id, w);
        ch.what = whats.join(' + ');
        ch.before = befores.join(' · ');
        ch.after = afters.join(' · ');
        if (Object.keys(ch.data).length) changes.set(id, ch);
      }
    }
    return { changes: [...changes.values()], errors };
  }

  private cleanActions(input: unknown, idOf: (x: unknown) => string | null): Action[] {
    return (Array.isArray(input) ? input : [])
      .filter((a) => a && typeof a === 'object' && ACTION_TYPES.includes((a as any).type))
      .slice(0, 10)
      .map((a: any) => ({
        type: String(a.type),
        car_ids: [...new Set((Array.isArray(a.car_ids ?? a.cars) ? (a.car_ids ?? a.cars) : []).map(idOf).filter(Boolean) as string[])].slice(0, 300),
        params: a.params && typeof a.params === 'object' ? a.params : {},
      }))
      .filter((a) => a.car_ids.length);
  }

  async command(tenantId: string, body: { text?: unknown }) {
    const text = String(body.text || '').trim().slice(0, 600);
    if (!text) throw new BadRequestException('Type or say what you want to do.');
    const c = aiConfig();
    // no AI configured: the bar still works as a normal inventory search
    if (!c.key) return { intent: 'search', reply: 'Searching your inventory…', search: text, car_ids: [], cars: [], actions: [], changes: [], errors: [], noAi: true };
    this.guard(tenantId);
    const cars = await this.cars(tenantId);
    const lines = cars
      .map((x) =>
        [x.n, x.name, x.ext || '-', x.body || '-', `stock ${x.stock || '-'}`, x.vin ? `VIN …${x.vin.slice(-6)}` : 'VIN -', money(x.price), x.mileage == null ? '- mi' : `${x.mileage.toLocaleString('en-US')} mi`,
          STATUS_TXT[x.status].toLowerCase(), `${x.days} days listed`, `${x.photos} photos`, x.featured ? 'featured' : 'not featured', x.fb ? 'on Facebook' : 'not on Facebook'].join(' | '),
      )
      .join('\n');
    const prompt = `You are the assistant inside a car dealership's inventory system. The dealer typed or said a request. Today is ${new Date().toISOString().slice(0, 10)}.

INVENTORY (${cars.length} cars, one per line: number | vehicle | colour | body | stock | VIN end | price | mileage | status | days listed | photos | featured | Facebook):
${lines || '(no cars yet)'}

REQUEST: ${JSON.stringify(text)}

Decide what the dealer wants:
- "action": change cars. Allowed action types (and params):
  mark_sold {sold_price?: number}, mark_for_sale {}, mark_draft {}, set_price {price: number}, change_price {amount: number, negative = lower},
  change_price_percent {percent: number, negative = lower}, feature {} (show on the website home page), unfeature {}.
- "question": a question about the inventory (counts, which cars, totals, averages). Put the matching car numbers in cars and the answer in reply.
- "search": they only want to find or look at cars; put a short search text (make, model, VIN or stock number) in search, and the matching car numbers in cars.
- "navigate": open a part of the portal. page = one of: ${PAGES.join(', ')}. Posting a car on Facebook or Marketplace = navigate, page facebook, with that car's number in cars. Adding a car with AI / by photos / by video = ai_add.
- "unclear": you can't tell which car or what to do. Ask one short question in reply and list the possible cars in cars.

RULES
- Only use car numbers from the list. Never invent cars.
- Match cars by year, make, model, trim, colour, body, stock number, VIN or status. "listed over 60 days" means days listed > 60.
- An action on "the Corolla" when several cars match and the dealer didn't say "all" → intent unclear.
- Sold cars are not "for sale". Price changes normally apply to cars for sale only, unless the dealer says otherwise.
- reply: one short friendly sentence. For actions say what WILL happen (e.g. "I'll lower the price by $300 on 4 cars listed over 60 days.").

Reply with ONLY this JSON:
{"intent":"action|question|search|navigate|unclear","reply":"","cars":[],"actions":[{"type":"","cars":[],"params":{}}],"search":"","page":""}`;
    const r = await aiText(prompt, 2500);
    const raw = extractJson(r.text);
    const byN = new Map(cars.map((x) => [x.n, x.id]));
    const idOf = (x: unknown) => byN.get(Math.trunc(Number(x))) || null;
    let intent = ['action', 'question', 'search', 'navigate', 'unclear'].includes(raw?.intent) ? raw.intent : 'unclear';
    const ids = [...new Set((Array.isArray(raw?.cars) ? raw.cars : []).map(idOf).filter(Boolean) as string[])];
    const actions = intent === 'action' ? this.cleanActions(raw?.actions, idOf) : [];
    if (intent === 'action' && !actions.length) intent = 'unclear';
    const { changes, errors } = this.plan(cars, actions);
    const pick = new Set([...ids, ...actions.flatMap((a) => a.car_ids)]);
    return {
      intent,
      reply: String(raw?.reply || '').slice(0, 400) || (intent === 'unclear' ? 'Could you say that a bit more specifically?' : 'Done.'),
      search: String(raw?.search || '').slice(0, 120),
      page: PAGES.includes(raw?.page) ? raw.page : '',
      car_ids: ids,
      cars: cars.filter((x) => pick.has(x.id)).slice(0, 60).map(({ id, name, stock, ext, price, status, photos }) => ({ id, name, stock, ext, price, status, photos })),
      actions,
      changes: changes.map(({ data: _d, ...rest }) => rest),
      errors,
    };
  }

  async apply(tenantId: string, body: { actions?: unknown }, user: AuthUser) {
    const cars = await this.cars(tenantId);
    const known = new Set(cars.map((c) => c.id));
    const actions = this.cleanActions(body.actions, (x) => (typeof x === 'string' && known.has(x) ? x : null));
    const { changes, errors } = this.plan(cars, actions);
    if (!changes.length) return { changes: [], errors: errors.length ? errors : ['Nothing needed changing.'] };
    const byId = new Map(cars.map((c) => [c.id, c]));
    const done: typeof changes = [];
    const undo: { id: string; data: Record<string, unknown> }[] = [];
    for (const ch of changes) {
      const cur = byId.get(ch.id)!;
      try {
        await this.vehicles.update(tenantId, ch.id, ch.data, user);
        done.push(ch);
        const prev: Record<string, unknown> = {};
        if ('status' in ch.data) prev.status = cur.status;
        if ('price' in ch.data) prev.price = cur.price;
        if ('featured' in ch.data) prev.featured = cur.featured;
        if ('extra' in ch.data) prev.extra = cur.extra;
        undo.push({ id: ch.id, data: prev });
      } catch (e) {
        errors.push(`${ch.car}: ${(e as Error).message}`);
      }
    }
    if (undo.length) this.undoStore.set(tenantId, { at: Date.now(), items: undo });
    return { changes: done.map(({ data: _d, ...rest }) => rest), errors };
  }

  async undo(tenantId: string, user: AuthUser) {
    const u = this.undoStore.get(tenantId);
    if (!u || Date.now() - u.at > 30 * 60_000) throw new BadRequestException('There is nothing to undo any more.');
    this.undoStore.delete(tenantId);
    const errors: string[] = [];
    let count = 0;
    for (const it of u.items) {
      try {
        await this.vehicles.update(tenantId, it.id, it.data, user);
        count++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { undone: count, errors };
  }
}
