import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { extname, join, normalize } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlink, writeFileSync } from 'fs';
import { freemem, totalmem } from 'os';
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { BrandingService } from '../branding/branding.service.js';
import { UPLOAD_ROOT } from '../media/media.service.js';
import type { AuthUser } from '../common/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { createFbSession, parseProxy, VIEW_H, VIEW_W } from './fb-session.js';
import { DEFAULT_SETTINGS, aiCopy, cleanTags, fbDescription, templateCopy, validate } from './fb-copy.js';

/** Everything the poster keeps on disk: Chrome profiles (= Facebook logins), problem screenshots, temp media. */
export const FB_STORAGE = process.env.FB_STORAGE_DIR || join(process.cwd(), 'storage', 'facebook');
const PROFILES = join(FB_STORAGE, 'profiles');
const DEBUG = join(FB_STORAGE, 'debug');
export const FB_TMP = join(FB_STORAGE, 'tmp');
mkdirSync(FB_TMP, { recursive: true });

const MB = 1024 * 1024;
/**
 * Chromes at the same time. Default: what the server's memory allows (about 450 MB per Facebook browser after
 * ~1.5 GB for the database, the API and the websites) — e.g. 8 GB → 12, 4 GB → 5. FB_MAX_BROWSERS overrides it.
 */
const MAX_BROWSERS = Math.max(1, Number(process.env.FB_MAX_BROWSERS) || Math.min(12, Math.floor((totalmem() / MB - 1536) / 450)) || 1);
/** no new Chrome when the server has less free memory than this (idle ones are closed first) */
const MIN_FREE_MB = Math.max(150, Number(process.env.FB_MIN_FREE_MB) || 400);
/** close a browser nobody is looking at (portal closed) after this many minutes — the login stays saved */
const IDLE_UNSEEN_MIN = Math.max(2, Number(process.env.FB_IDLE_MINUTES) || 10);
/** …and one that is open in the portal but not used */
const IDLE_UNUSED_MIN = 45;
/** an idle Chrome older than this is restarted (Chrome grows over the hours; a fresh one is lighter) */
const RECYCLE_HOURS = Math.max(1, Number(process.env.FB_RECYCLE_HOURS) || 6);
/** the live-view picture stream stops when nobody has asked for a picture for this long */
const VIEW_IDLE_MS = 60_000;

const FB_URL = /^https:\/\/(www\.|m\.|web\.)?facebook\.com\/.+/i;
const MAX_MEDIA = 20;

type Session = ReturnType<typeof createFbSession>;
type Item = { name: string; url: string };
type MpSettings = typeof DEFAULT_SETTINGS;
type Listing = {
  status: string; url: string; fbId: string; postedPrice: number | null; error: string;
  publishedAt: string | null; checkedAt: string | null; postedBy: string; history: { at: string; note: string }[];
};

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const nowIso = () => new Date().toISOString();
const isoOrNull = (v: unknown) => (v ? new Date(String(v)) : null);

export function userKey(u: AuthUser) {
  return u.kind === 'dealer' ? u.id : `owner-${u.id}`;
}

function cleanItems(items: unknown, max = 500): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const it of Array.isArray(items) ? items : []) {
    const url = String((it && (it as Item).url) || '').trim();
    if (!FB_URL.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ name: String((it as Item).name || url).replace(/\s+/g, ' ').trim().slice(0, 200), url });
    if (out.length >= max) break;
  }
  return out;
}

function cleanPage(p: unknown): Item | Record<string, never> {
  const url = String((p && (p as Item).url) || '').trim();
  if (!FB_URL.test(url)) return {};
  return { url, name: String((p as Item).name || url).slice(0, 200) };
}

const num = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

@Injectable()
export class FacebookService implements OnModuleInit, OnModuleDestroy {
  private sessions = new Map<string, Session & { tenantId: string; userKey: string }>();
  private proxies = new Map<string, string>();
  private settingsCache = new Map<string, MpSettings>();
  private nameFetched = new Set<string>();
  /** temp copies of web photos per vehicle task */
  private tempPhotos = new Map<string, string[]>();
  private writes: Promise<unknown> = Promise.resolve();
  private reaper?: NodeJS.Timeout;
  private lastHealth = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly branding: BrandingService,
  ) {}

  async onModuleInit() {
    cleanupStaleTemp(); // media left from a run that was cut off by a restart
    await cleanupStaleChrome(); // Chromes / profile locks left by a crash or a hard restart
    // Anything left "publishing" from before a restart cannot still be in progress
    await this.prisma.fbListing
      .updateMany({
        where: { status: { in: ['queued', 'publishing', 'awaiting_publish'] } },
        data: { status: 'failed', error: 'The server was restarted before this listing was confirmed. If it was published, paste the link; otherwise post again.' },
      })
      .catch(() => undefined);
    this.reaper = setInterval(() => void this.reap(), 60_000);
    this.reaper.unref?.();
  }

  async onModuleDestroy() {
    if (this.reaper) clearInterval(this.reaper);
    await Promise.all([...this.sessions.values()].map((s) => s.close().catch(() => undefined)));
  }

  // ───────────────────────── sessions (one Chrome per dealer user) ─────────────────────────

  private key(tenantId: string, uk: string) {
    return `${tenantId}::${uk}`;
  }

  private session(tenantId: string, uk: string) {
    const k = this.key(tenantId, uk);
    let s = this.sessions.get(k);
    if (s) return s;
    const made = createFbSession({
      profileDir: join(PROFILES, safe(tenantId), safe(uk)),
      debugDir: join(DEBUG, safe(tenantId)),
      hooks: {
        proxy: () => this.proxies.get(k) || '',
        autoPublish: () => (this.settingsCache.get(tenantId) || DEFAULT_SETTINGS).autoPublish,
        gapSeconds: () => (this.settingsCache.get(tenantId) || DEFAULT_SETTINGS).gapSeconds,
        getVehicle: (id: string) => this.engineVehicle(tenantId, id),
        setListing: (id: string, patch: Partial<Listing>, note?: string) => this.queueListingWrite(tenantId, id, patch, note),
        releaseVehicle: (id: string) => this.releasePhotos(id),
        onJobDone: (job: { runId?: string; results: unknown[]; ok: number; failed: number; cancelled: boolean }) => {
          if (!job.runId) return;
          void this.prisma.fbPostRun
            .update({
              where: { id: job.runId },
              data: { results: job.results as Prisma.InputJsonValue, ok: job.ok, failed: job.failed, cancelled: job.cancelled, finishedAt: new Date() },
            })
            .catch(() => undefined);
        },
      },
    });
    s = Object.assign(made, { tenantId, userKey: uk });
    this.sessions.set(k, s);
    return s;
  }

  /**
   * Make room before a new Chrome starts: below the browser limit and with enough free memory.
   * Idle Chromes of other users are closed first (their logins stay saved); when every Chrome is busy posting,
   * wait up to ~40 s for one to finish before giving up with a friendly message.
   */
  private async makeRoom(except: string) {
    for (let attempt = 0; ; attempt++) {
      const open = [...this.sessions.entries()].filter(([, s]) => s.isOpen());
      const lowMem = freemem() / MB < MIN_FREE_MB;
      if (open.length < MAX_BROWSERS && !lowMem) return;
      const idle = open.filter(([k, s]) => k !== except && s.idle()).sort((a, b) => a[1].S.lastAction - b[1].S.lastAction);
      if (idle.length) {
        idle[0][1].log('Browser closed to make room for another user (the login is kept).');
        await idle[0][1].close().catch(() => undefined);
        await new Promise((r) => setTimeout(r, 400)); // let Chrome give its memory back
        continue;
      }
      if (attempt >= 20) {
        throw new ServiceUnavailableException(
          lowMem
            ? 'The server is short of memory right now (other dealers are posting). Try again in a few minutes.'
            : `The server is already posting for ${MAX_BROWSERS} other users. Try again in a few minutes.`,
        );
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  /** every minute: close unused Chromes, stop unwatched live views, restart frozen or old ones */
  private async reap() {
    const now = Date.now();
    const checkHealth = now - this.lastHealth > 5 * 60_000;
    if (checkHealth) this.lastHealth = now;
    for (const [k, s] of this.sessions) {
      try {
        if (s.isOpen() && s.viewOn() && now - s.S.lastFrame > VIEW_IDLE_MS && now - s.S.lastAction > VIEW_IDLE_MS) await s.viewStop().catch(() => undefined);
        if (!s.isOpen() || !s.idle()) {
          if (!s.isOpen() && now - s.S.lastSeen > 6 * 3600_000) this.sessions.delete(k);
          continue;
        }
        const unseen = now - s.S.lastSeen > IDLE_UNSEEN_MIN * 60_000;
        const unused = now - s.S.lastAction > IDLE_UNUSED_MIN * 60_000;
        const old = s.S.startedAt && now - s.S.startedAt > RECYCLE_HOURS * 3600_000 && now - s.S.lastAction > 2 * 60_000;
        if (unseen || unused) {
          s.log(`Browser closed after ${unseen ? IDLE_UNSEEN_MIN : IDLE_UNUSED_MIN} minutes without use (the login is kept; it starts again by itself).`);
          await s.close().catch(() => undefined);
        } else if (old) {
          s.log(`Browser restarted after ${RECYCLE_HOURS} hours to keep the server fast (the login is kept).`);
          await s.close().catch(() => undefined);
        } else if (checkHealth && !(await s.healthy())) {
          s.log('The Facebook browser stopped responding and was closed. It starts again by itself on the next post.');
          await s.close().catch(() => undefined);
        }
      } catch {
        await s.close().catch(() => undefined);
      }
    }
  }

  // ───────────────────────── access ─────────────────────────

  /** the dealership must have the Facebook feature switched on */
  private async ctx(tenantId: string, u: AuthUser) {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { features: true } });
    if (!t) throw new NotFoundException('Dealership not found');
    const f = await this.tenants.features(t);
    if (!f.facebook) throw new ForbiddenException('FB Poster is not switched on for this dealership. Ask the platform owner.');
    const uk = userKey(u);
    // read first: this runs on every status poll, so no write unless the row is new
    const account =
      (await this.prisma.fbAccount.findUnique({ where: { tenantId_userKey: { tenantId, userKey: uk } } })) ??
      (await this.prisma.fbAccount.upsert({
        where: { tenantId_userKey: { tenantId, userKey: uk } },
        create: { tenantId, userKey: uk },
        update: {},
      }));
    this.proxies.set(this.key(tenantId, uk), account.proxy);
    return { uk, account };
  }

  /** a session whose browser may be started (respects the browser limit) */
  private async live(tenantId: string, u: AuthUser) {
    const c = await this.ctx(tenantId, u);
    const k = this.key(tenantId, c.uk);
    const s = this.session(tenantId, c.uk);
    if (!s.isOpen()) await this.makeRoom(k);
    return { ...c, s };
  }

  private wrap<T>(p: Promise<T>): Promise<T> {
    return p.catch((e: Error) => {
      if (e && (e as { status?: number }).status) throw e;
      throw new BadRequestException(e?.message || String(e));
    });
  }

  private accountView(a: {
    fbUserId: string; fbName: string; connectedAt: Date | null; actingAs: unknown; pages: unknown; groups: unknown; proxy: string;
  }) {
    const p = parseProxy(a.proxy);
    return {
      fbUserId: a.fbUserId,
      fbName: a.fbName,
      connectedAt: a.connectedAt,
      actingAs: a.actingAs || {},
      pages: a.pages || [],
      groups: a.groups || [],
      proxy: p ? p.server.replace(/^\w+:\/\//, '') + (p.username ? ' (with login)' : '') : '',
    };
  }

  // ───────────────────────── connection & live view ─────────────────────────

  async state(tenantId: string, u: AuthUser, logAfter: number, peek = false) {
    const { uk, account } = await this.ctx(tenantId, u);
    const s = this.session(tenantId, uk);
    const st = await s.state(logAfter, peek);
    let a = account;
    if (st.loggedIn) {
      const id = await s.fbUserId().catch(() => '');
      if (id && id !== a.fbUserId) {
        a = await this.prisma.fbAccount.update({
          where: { id: a.id },
          data: { fbUserId: id, fbName: '', connectedAt: new Date(), actingAs: {}, pages: [], groups: [] },
        });
      }
      if (id && !a.fbName && !this.nameFetched.has(`${a.id}:${id}`) && s.idle()) {
        this.nameFetched.add(`${a.id}:${id}`);
        void s.fetchName().then((name: string) => {
          if (name) void this.prisma.fbAccount.update({ where: { id: a.id }, data: { fbName: name } }).catch(() => undefined);
        });
      }
      if (!a.lastActiveAt || Date.now() - a.lastActiveAt.getTime() > 5 * 60_000) {
        void this.prisma.fbAccount.update({ where: { id: a.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
      }
    }
    return { ...st, account: this.accountView(a), screen: { width: VIEW_W, height: VIEW_H } };
  }

  async connect(tenantId: string, u: AuthUser) {
    const { s } = await this.live(tenantId, u);
    await this.wrap(s.viewStart());
    return this.wrap(s.connect());
  }

  async disconnect(tenantId: string, u: AuthUser) {
    const { uk } = await this.ctx(tenantId, u);
    const s = this.session(tenantId, uk);
    if (!s.idle()) throw new BadRequestException('A task is running. Press Stop first.');
    await s.close();
    s.log('Browser closed. Your login is kept: "Connect Facebook" opens it again.');
    return { ok: true };
  }

  async switchAccount(tenantId: string, u: AuthUser) {
    const { s, account } = await this.live(tenantId, u);
    await this.wrap(s.viewStart());
    await this.wrap(s.switchAccount());
    await this.prisma.fbAccount.update({
      where: { id: account.id },
      data: { fbUserId: '', fbName: '', connectedAt: null, actingAs: {}, pages: [], groups: [] },
    });
    return { ok: true };
  }

  /** log out for good and delete the saved login from the server */
  async forget(tenantId: string, u: AuthUser) {
    const { uk, account } = await this.ctx(tenantId, u);
    const s = this.session(tenantId, uk);
    await this.wrap(s.forget());
    await this.prisma.fbAccount.update({
      where: { id: account.id },
      data: { fbUserId: '', fbName: '', connectedAt: null, actingAs: {}, pages: [], groups: [] },
    });
    return { ok: true };
  }

  async setProxy(tenantId: string, u: AuthUser, raw: string) {
    const { uk, account } = await this.ctx(tenantId, u);
    const v = String(raw || '').trim();
    if (v && !parseProxy(v)) throw new BadRequestException('Use the form host:port or http://user:password@host:port');
    await this.prisma.fbAccount.update({ where: { id: account.id }, data: { proxy: v } });
    this.proxies.set(this.key(tenantId, uk), v);
    const s = this.session(tenantId, uk);
    if (s.isOpen() && s.idle()) await s.close(); // the next start uses the new proxy
    return { ok: true, restarted: true };
  }

  async viewStart(tenantId: string, u: AuthUser) {
    const { s } = await this.live(tenantId, u);
    await this.wrap(s.viewStart());
    return { ok: true, width: VIEW_W, height: VIEW_H };
  }

  async viewStop(tenantId: string, u: AuthUser) {
    const { uk } = await this.ctx(tenantId, u);
    await this.session(tenantId, uk).viewStop();
    return { ok: true };
  }

  /** the next screen picture (long-poll) */
  async frame(tenantId: string, u: AuthUser, after: number) {
    const uk = userKey(u);
    const s = this.sessions.get(this.key(tenantId, uk));
    if (!s) return null;
    return s.frame(after, 8000);
  }

  async input(tenantId: string, u: AuthUser, ev: Record<string, unknown>) {
    const s = this.sessions.get(this.key(tenantId, userKey(u)));
    if (!s) throw new BadRequestException('The browser is not open. Click "Connect Facebook".');
    await this.wrap(s.input(ev));
    return { ok: true };
  }

  async nav(tenantId: string, u: AuthUser, action: string, url?: string) {
    const { s } = await this.live(tenantId, u);
    await this.wrap(s.nav(action, url));
    return { ok: true };
  }

  debugFile(tenantId: string, file: string) {
    if (!/^[\w-]+\.png$/.test(file)) throw new NotFoundException();
    const p = join(DEBUG, safe(tenantId), file);
    if (!existsSync(p)) throw new NotFoundException('Screenshot not found (screenshots are kept until the server is cleaned up).');
    return readFileSync(p);
  }

  // ───────────────────────── Pages, groups, collections ─────────────────────────

  async loadPages(tenantId: string, u: AuthUser) {
    const { s, account } = await this.live(tenantId, u);
    const pages = cleanItems(await this.wrap(s.loadPages()));
    await this.prisma.fbAccount.update({ where: { id: account.id }, data: { pages } });
    return { pages };
  }

  async loadGroups(tenantId: string, u: AuthUser) {
    const { s, account } = await this.live(tenantId, u);
    const groups = cleanItems(await this.wrap(s.loadGroups()), 2000);
    await this.prisma.fbAccount.update({ where: { id: account.id }, data: { groups } });
    return { groups };
  }

  async switchToPage(tenantId: string, u: AuthUser, b: { url?: string; name?: string }) {
    const { s, account } = await this.live(tenantId, u);
    const url = String(b.url || '').trim();
    const r = await this.wrap(s.switchToPage(url, String(b.name || '')));
    await this.prisma.fbAccount.update({ where: { id: account.id }, data: { actingAs: { url, name: r.name || b.name || url, verified: !!r.verified } } });
    return r;
  }

  /** "Post as my personal profile again" just forgets the Page here (switch back in the browser view if needed) */
  async clearActingAs(tenantId: string, u: AuthUser) {
    const { account } = await this.ctx(tenantId, u);
    await this.prisma.fbAccount.update({ where: { id: account.id }, data: { actingAs: {} } });
    return { ok: true };
  }

  /** add / remove Pages and groups by hand (links pasted by the dealer) */
  async saveTargets(tenantId: string, u: AuthUser, b: { pages?: unknown; groups?: unknown }) {
    const { account } = await this.ctx(tenantId, u);
    const data: { pages?: Item[]; groups?: Item[] } = {};
    if (b.pages !== undefined) data.pages = cleanItems(b.pages);
    if (b.groups !== undefined) data.groups = cleanItems(b.groups, 2000);
    const a = await this.prisma.fbAccount.update({ where: { id: account.id }, data });
    return { pages: a.pages, groups: a.groups };
  }

  async collections(tenantId: string, u: AuthUser) {
    const { uk } = await this.ctx(tenantId, u);
    const list = await this.prisma.fbCollection.findMany({ where: { tenantId, userKey: uk }, orderBy: { updatedAt: 'desc' } });
    return { collections: list };
  }

  async saveCollection(tenantId: string, u: AuthUser, id: string | null, b: Record<string, unknown>) {
    const { uk } = await this.ctx(tenantId, u);
    const name = String(b.name || '').trim().slice(0, 80);
    if (!name) throw new BadRequestException('Give the collection a name.');
    const items = cleanItems(b.items);
    if (!items.length) throw new BadRequestException('Add at least one group.');
    const data = { name, items, page: cleanPage(b.page), includePage: b.includePage !== false };
    if (!id) return this.prisma.fbCollection.create({ data: { tenantId, userKey: uk, ...data } });
    const c = await this.prisma.fbCollection.findFirst({ where: { id, tenantId, userKey: uk } });
    if (!c) throw new NotFoundException('Collection not found');
    return this.prisma.fbCollection.update({ where: { id }, data });
  }

  async deleteCollection(tenantId: string, u: AuthUser, id: string) {
    const { uk } = await this.ctx(tenantId, u);
    await this.prisma.fbCollection.deleteMany({ where: { id, tenantId, userKey: uk } });
    return { ok: true };
  }

  async getQuickConfig(tenantId: string, u: AuthUser) {
    const { account, uk } = await this.ctx(tenantId, u);
    const live = this.sessions.get(this.key(tenantId, uk));
    const ts = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const s = (ts?.fbSettings && typeof ts.fbSettings === 'object' ? ts.fbSettings : {}) as Record<string, unknown>;
    const quick = (s.quickPost && typeof s.quickPost === 'object' ? s.quickPost : {}) as Record<string, unknown>;
    return {
      quickPost: quick,
      account: this.accountView(account),
      // for the "Post to Facebook" popup: is there a saved Facebook login? (Chrome may be asleep — it starts by itself)
      connection: { connected: !!account.fbUserId && !live?.S.loginLost, loginLost: !!live?.S.loginLost, fbName: account.fbName },
    };
  }

  async saveQuickConfig(tenantId: string, u: AuthUser, b: Record<string, unknown>) {
    await this.ctx(tenantId, u);
    const ts = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const cur = (ts?.fbSettings && typeof ts.fbSettings === 'object' ? ts.fbSettings : {}) as Record<string, unknown>;
    const next = { ...cur, quickPost: b };
    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, fbSettings: next as Prisma.InputJsonValue },
      update: { fbSettings: next as Prisma.InputJsonValue },
    });
    return { ok: true, quickPost: b };
  }

  // ───────────────────────── posting to groups / Pages ─────────────────────────

  /** a vehicle photo URL → a file on disk (+ whether it is a temp copy) */
  private async photoFile(tenantId: string, url: string): Promise<{ path: string; temp: boolean } | null> {
    if (url.startsWith('/uploads/')) {
      const p = normalize(join(UPLOAD_ROOT, decodeURIComponent(url.slice('/uploads/'.length).split(/[?#]/)[0])));
      if (!p.startsWith(join(UPLOAD_ROOT, tenantId)) || !existsSync(p)) return null;
      return { path: p, temp: false };
    }
    if (/^https?:\/\//i.test(url)) {
      const { data, mime } = await this.branding.source(tenantId, url);
      const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg';
      const p = join(FB_TMP, `${Date.now()}_${randomBytes(4).toString('hex')}${ext}`);
      writeFileSync(p, data);
      return { path: p, temp: true };
    }
    return null;
  }

  /**
   * Start posting. `order` lists the media in posting order (first = featured):
   *   "f:<n>" = the n-th uploaded file, "v:<url>" = a vehicle photo.
   */
  async post(tenantId: string, u: AuthUser, b: Record<string, string>, files: { path: string }[]) {
    // uploaded files and downloaded vehicle photos: deleted here on error, by the job when it finishes
    const tempFiles: string[] = files.map((f) => f.path);
    let started = false;
    try {
      const { s, uk, account } = await this.live(tenantId, u);
      const parse = <T>(v: string | undefined, d: T): T => {
        try {
          return v ? (JSON.parse(v) as T) : d;
        } catch {
          return d;
        }
      };
      const targets = [...new Set(parse<string[]>(b.targets, []).map(String))].filter((x) => FB_URL.test(x)).slice(0, 300);
      const names = parse<Record<string, string>>(b.names, {});
      const tags = cleanTags(b.hashtags || '');
      const caption = [String(b.caption || '').trim(), tags].filter(Boolean).join('\n\n').slice(0, 60000);
      if (!targets.length) throw new BadRequestException('Select at least one group or Page.');

      const order = parse<string[]>(b.order, files.map((_, i) => `f:${i}`)).slice(0, MAX_MEDIA);
      const mediaPaths: string[] = [];
      for (const o of order) {
        if (o.startsWith('f:')) {
          const f = files[Number(o.slice(2))];
          if (f) mediaPaths.push(f.path);
        } else if (o.startsWith('v:')) {
          const got = await this.photoFile(tenantId, o.slice(2)).catch(() => null);
          if (got) {
            mediaPaths.push(got.path);
            if (got.temp) tempFiles.push(got.path);
          }
        }
      }
      if (!caption.trim() && !mediaPaths.length) throw new BadRequestException('Add a photo/video, a description or hashtags.');

      const clamp = (v: unknown, lo: number, hi: number, d: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
      };
      const delayMin = clamp(b.delayMin, 20, 600, 45) * 1000;
      const delayMax = Math.max(delayMin + 1000, clamp(b.delayMax, 20, 900, 90) * 1000);

      const run = await this.prisma.fbPostRun.create({
        data: {
          tenantId, userKey: uk, caption: caption.slice(0, 4000), media: mediaPaths.length,
          results: targets.map((url) => ({ url, name: names[url] || url, status: 'waiting' })),
        },
      });
      const job = await this.wrap(s.startPost({
          targets, names, mediaPaths, tempFiles, caption, delayMin, delayMax, runId: run.id,
          // the Page chosen in FB Poster ("Post as"): groups are posted as that Page, otherwise as the personal profile
          actAs: (account.actingAs || {}) as { url?: string; name?: string },
        })).catch(async (e) => {
        await this.prisma.fbPostRun.delete({ where: { id: run.id } }).catch(() => undefined);
        throw e;
      });
      started = true;
      return { ok: true, runId: run.id, count: targets.length, media: mediaPaths.length, job };
    } finally {
      if (!started) for (const p of tempFiles) unlink(p, () => undefined);
    }
  }

  async stopPosting(tenantId: string, u: AuthUser) {
    const s = this.sessions.get(this.key(tenantId, userKey(u)));
    s?.stopPosting();
    return { ok: true };
  }

  async history(tenantId: string, u: AuthUser) {
    const { uk } = await this.ctx(tenantId, u);
    const runs = await this.prisma.fbPostRun.findMany({ where: { tenantId, userKey: uk }, orderBy: { startedAt: 'desc' }, take: 25 });
    return { runs };
  }

  // ───────────────────────── Marketplace settings ─────────────────────────

  private async mpSettings(tenantId: string): Promise<MpSettings & { business: Record<string, string> }> {
    const ts = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const own = (ts?.fbSettings && typeof ts.fbSettings === 'object' ? ts.fbSettings : {}) as Partial<MpSettings>;
    const s = { ...DEFAULT_SETTINGS, ...own };
    // dealer details come from Business details (not typed twice)
    const business = {
      dealerName: ts?.name || '',
      phone: ts?.phone || '',
      address: ts?.street || '',
      city: [ts?.city, ts?.state].filter(Boolean).join(', '),
      website: ts?.siteUrl || '',
    };
    const full = { ...s, ...business, business };
    this.settingsCache.set(tenantId, full);
    return full;
  }

  async getSettings(tenantId: string, u: AuthUser) {
    await this.ctx(tenantId, u);
    const s = await this.mpSettings(tenantId);
    return { settings: { ...s, aiKey: s.aiKey ? '••••' + s.aiKey.slice(-4) : '' } };
  }

  async saveSettings(tenantId: string, u: AuthUser, b: Record<string, unknown>) {
    await this.ctx(tenantId, u);
    const cur = await this.mpSettings(tenantId);
    const next: Record<string, unknown> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof MpSettings)[]) {
      if (['dealerName', 'phone', 'address', 'city', 'website'].includes(k)) continue;
      const v = b[k] === undefined ? cur[k] : b[k];
      if (k === 'aiKey') next.aiKey = b.aiKey === undefined || String(b.aiKey).startsWith('••••') ? cur.aiKey : String(b.aiKey).trim();
      else if (k === 'dailyLimit') next.dailyLimit = Math.max(1, Math.min(100, num(v) || 5));
      else if (k === 'gapSeconds') next.gapSeconds = Math.max(10, Math.min(900, num(v) || 45));
      else if (k === 'autoPublish') next.autoPublish = v === 'off' ? 'off' : 'on';
      else next[k] = String(v ?? '').slice(0, 6000);
    }
    if (!['none', 'openai', 'anthropic'].includes(String(next.aiProvider))) next.aiProvider = 'none';
    await this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, fbSettings: next as Prisma.InputJsonValue },
      update: { fbSettings: next as Prisma.InputJsonValue },
    });
    return this.getSettings(tenantId, u);
  }

  // ───────────────────────── Marketplace vehicles ─────────────────────────

  private emptyListing() {
    return {
      status: 'none', url: '', fbId: '', postedPrice: null as number | null, error: '', publishedAt: null as Date | null, checkedAt: null as Date | null,
      postedBy: '', title: '', description: '', hashtags: '', copySource: '', fbCondition: '', cleanTitle: true, history: [] as unknown[],
    };
  }

  /** inventory vehicle → the old marketplace.js vehicle shape */
  private toMp(v: {
    id: string; year: number | null; make: string; model: string; trim: string; price: unknown; mileage: number | null; condition: string; certified: boolean;
    bodyStyle: string; vehicleType: string; exteriorColor: string; interiorColor: string; transmission: string; fuelType: string; drivetrain: string;
    engine: string; features: string[]; vin: string; stockNumber: string; images: string[];
    horsepower?: string; mpg?: string; doors?: string; seats?: string; owners?: string; accidents?: string; description?: string; safetyFeatures?: string[];
  }, l: ReturnType<FacebookService['emptyListing']> | null) {
    const listing = l || this.emptyListing();
    const cond = /new/i.test(v.condition) ? 'new' : v.certified || /cert|cpo/i.test(v.condition) ? 'cpo' : 'used';
    return {
      id: v.id, stock: v.stockNumber, vin: v.vin, year: v.year, make: v.make, model: v.model, trim: v.trim,
      price: v.price === null || v.price === undefined ? null : Math.round(Number(v.price)), mileage: v.mileage, condition: cond,
      fbCondition: listing.fbCondition, cleanTitle: listing.cleanTitle, bodyStyle: v.bodyStyle || v.vehicleType,
      exteriorColor: v.exteriorColor, interiorColor: v.interiorColor, transmission: v.transmission, fuelType: v.fuelType,
      drivetrain: v.drivetrain, engine: v.engine, features: v.features,
      // details Facebook's form has no box for: they go into the description
      horsepower: v.horsepower || '', mpg: v.mpg || '', doors: v.doors || '', seats: v.seats || '', owners: v.owners || '', accidents: v.accidents ?? '',
      comments: v.description || '', safetyFeatures: v.safetyFeatures || [], certified: !!v.certified, conditionText: v.condition || '',
      title: listing.title, description: listing.description, hashtags: listing.hashtags, copySource: listing.copySource,
      photos: v.images,
    };
  }

  async mpVehicles(tenantId: string, u: AuthUser) {
    const { uk } = await this.ctx(tenantId, u);
    const settings = await this.mpSettings(tenantId);
    const rows = await this.prisma.vehicle.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      include: { fbListing: true },
      take: 2000,
    });
    const s = this.sessions.get(this.key(tenantId, uk));
    const st = s ? await s.state(Number.MAX_SAFE_INTEGER) : null;
    const queued = new Set(s ? s.mpQueued() : []);
    const vehicles = rows.map((r) => {
      const l = r.fbListing as unknown as ReturnType<FacebookService['emptyListing']> | null;
      const mp = this.toMp(r, l);
      return {
        id: r.id,
        status: r.status,
        title: r.title || [r.year, r.make, r.model, r.trim].filter(Boolean).join(' '),
        year: r.year, make: r.make, model: r.model, trim: r.trim, stock: r.stockNumber, vin: r.vin,
        price: mp.price, mileage: r.mileage, photo: r.images[0] || '', photos: r.images.length,
        missing: [...validate(mp), ...(r.images.length ? [] : ['photos'])],
        copy: { title: mp.title, description: mp.description, hashtags: mp.hashtags, copySource: mp.copySource, fbCondition: mp.fbCondition, cleanTitle: mp.cleanTitle },
        listing: l
          ? {
              status: l.status, url: l.url, fbId: l.fbId, postedPrice: l.postedPrice === null ? null : Number(l.postedPrice), error: l.error,
              publishedAt: l.publishedAt, checkedAt: l.checkedAt, postedBy: l.postedBy, mine: !l.postedBy || l.postedBy === uk, history: l.history,
            }
          : { status: 'none', url: '', fbId: '', postedPrice: null, error: '', publishedAt: null, checkedAt: null, postedBy: '', mine: true, history: [] },
        queued: queued.has(r.id),
      };
    });
    return {
      vehicles,
      publishedToday: await this.publishedToday(tenantId, uk),
      dailyLimit: settings.dailyLimit,
      autoPublish: settings.autoPublish,
      active: st?.mp.active || null,
      queue: st?.mp.queue || [],
      report: st?.mp.report || null,
    };
  }

  private async publishedToday(tenantId: string, uk: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return this.prisma.fbListing.count({ where: { tenantId, postedBy: uk, publishedAt: { gte: start } } });
  }

  private async vehicleWithListing(tenantId: string, id: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId }, include: { fbListing: true } });
    if (!v) throw new NotFoundException('Vehicle not found');
    return v;
  }

  private async upsertListing(tenantId: string, vehicleId: string, data: Record<string, unknown>) {
    return this.prisma.fbListing.upsert({
      where: { vehicleId },
      create: { tenantId, vehicleId, ...data },
      update: data,
    });
  }

  async saveCopy(tenantId: string, u: AuthUser, id: string, b: Record<string, unknown>) {
    await this.ctx(tenantId, u);
    await this.vehicleWithListing(tenantId, id);
    const data: Record<string, unknown> = {};
    if (b.title !== undefined) data.title = String(b.title).replace(/\s+/g, ' ').trim().slice(0, 100);
    if (b.description !== undefined) data.description = String(b.description).slice(0, 8000).trim();
    if (b.hashtags !== undefined) data.hashtags = cleanTags(String(b.hashtags));
    if (b.title !== undefined || b.description !== undefined || b.hashtags !== undefined) data.copySource = 'manual';
    if (b.fbCondition !== undefined) data.fbCondition = ['', 'Excellent', 'Very good', 'Good', 'Fair', 'Poor'].includes(String(b.fbCondition)) ? String(b.fbCondition) : '';
    if (b.cleanTitle !== undefined) data.cleanTitle = !!b.cleanTitle;
    await this.upsertListing(tenantId, id, data);
    return { ok: true };
  }

  private async makeCopy(tenantId: string, id: string, ai: boolean, save = true) {
    const s = await this.mpSettings(tenantId);
    const v = await this.vehicleWithListing(tenantId, id);
    const mp = this.toMp(v, v.fbListing as never);
    if (ai && (s.aiProvider === 'none' || !s.aiKey)) throw new BadRequestException('AI is not set up. Add an OpenAI or Anthropic key in Marketplace settings, or use "Template".');
    const c = ai ? await aiCopy(mp, s) : templateCopy(mp, s);
    if (save) await this.upsertListing(tenantId, id, { title: c.title, description: c.description, hashtags: c.hashtags, copySource: c.source });
    return c;
  }

  /** save=false: only return the text (FB Poster › "Start from a vehicle") */
  async generate(tenantId: string, u: AuthUser, id: string, ai: boolean, save = true) {
    await this.ctx(tenantId, u);
    const c = await this.wrap(this.makeCopy(tenantId, id, ai, save));
    const s = await this.mpSettings(tenantId);
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId }, select: { images: true } });
    return { ok: true, copy: c, text: fbDescription(c, s), photos: v?.images || [] };
  }

  async generateBulk(tenantId: string, u: AuthUser, ids: string[], ai: boolean) {
    await this.ctx(tenantId, u);
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids.slice(0, 500)) {
      try {
        await this.makeCopy(tenantId, String(id), ai);
        ok++;
      } catch (e) {
        errors.push((e as Error).message);
        if (/not set up/.test((e as Error).message)) break;
      }
    }
    return { ok: true, generated: ok, errors };
  }

  /** the text that will go into Facebook's Description box (preview) */
  async preview(tenantId: string, u: AuthUser, id: string) {
    await this.ctx(tenantId, u);
    const s = await this.mpSettings(tenantId);
    const v = await this.vehicleWithListing(tenantId, id);
    const mp = this.toMp(v, v.fbListing as never);
    return { text: fbDescription(mp, s) };
  }

  /** what the engine gets for one task: photo files, Facebook text, ids of other listings */
  private async engineVehicle(tenantId: string, id: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId }, include: { fbListing: true } });
    if (!v) return null;
    const s = await this.mpSettings(tenantId);
    const mp = this.toMp(v, v.fbListing as never);
    const files: string[] = [];
    const temps: string[] = [];
    for (const url of v.images.slice(0, 20)) {
      const got = await this.photoFile(tenantId, url).catch(() => null);
      if (got) {
        files.push(got.path);
        if (got.temp) temps.push(got.path);
      }
    }
    this.tempPhotos.set(id, temps);
    const others = await this.prisma.fbListing.findMany({ where: { tenantId, fbId: { not: '' }, vehicleId: { not: id } }, select: { fbId: true } });
    const l = v.fbListing;
    return {
      ...mp,
      photos: files,
      fbText: fbDescription(mp, s),
      knownIds: others.map((o) => o.fbId),
      listing: l
        ? { status: l.status, url: l.url, fbId: l.fbId, postedPrice: l.postedPrice === null ? null : Number(l.postedPrice), error: l.error }
        : { status: 'none', url: '', fbId: '', postedPrice: null, error: '' },
    };
  }

  private releasePhotos(id: string) {
    for (const p of this.tempPhotos.get(id) || []) unlink(p, () => undefined);
    this.tempPhotos.delete(id);
  }

  /** listing updates from the engine are written one after another (keeps them in order) */
  private queueListingWrite(tenantId: string, vehicleId: string, patch: Partial<Listing>, note?: string) {
    this.writes = this.writes
      .then(() => this.writeListing(tenantId, vehicleId, patch, note))
      .catch((e) => console.error('FB listing save failed:', (e as Error).message));
  }

  private async writeListing(tenantId: string, vehicleId: string, patch: Partial<Listing>, note?: string) {
    const cur = await this.prisma.fbListing.findUnique({ where: { vehicleId } });
    const data: Record<string, unknown> = {};
    for (const k of ['status', 'url', 'fbId', 'error', 'postedBy'] as const) if (patch[k] !== undefined) data[k] = String(patch[k] ?? '');
    if (patch.postedPrice !== undefined) data.postedPrice = patch.postedPrice === null ? null : Number(patch.postedPrice);
    if (patch.publishedAt !== undefined) data.publishedAt = isoOrNull(patch.publishedAt);
    if (patch.checkedAt !== undefined) data.checkedAt = isoOrNull(patch.checkedAt);
    if (note) data.history = [{ at: nowIso(), note }, ...((cur?.history as { at: string; note: string }[]) || [])].slice(0, 30);
    const exists = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true } });
    if (!exists) return;
    await this.upsertListing(tenantId, vehicleId, data);
  }

  async publish(tenantId: string, u: AuthUser, ids: string[]) {
    const { s, uk } = await this.live(tenantId, u);
    const settings = await this.mpSettings(tenantId);
    let used = await this.publishedToday(tenantId, uk);
    const accepted: { id: string; action: string }[] = [];
    const rejected: { id: string; error: string }[] = [];
    for (const id of ids.map(String).slice(0, 200)) {
      const v = await this.prisma.vehicle.findFirst({ where: { id, tenantId }, include: { fbListing: true } });
      if (!v) {
        rejected.push({ id, error: 'not found' });
        continue;
      }
      const mp = this.toMp(v, v.fbListing as never);
      const label = `${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim();
      const errs = validate(mp);
      if (errs.length) {
        rejected.push({ id, error: `${label}: missing ${errs.join(', ')} (fix it in Inventory)` });
        continue;
      }
      if (!v.images.length) {
        rejected.push({ id, error: `${label}: add at least one photo in Inventory` });
        continue;
      }
      const st = v.fbListing?.status || 'none';
      if (['published', 'awaiting_publish', 'publishing', 'queued'].includes(st)) {
        rejected.push({ id, error: `${label}: already ${st.replace('_', ' ')}` });
        continue;
      }
      if (used >= settings.dailyLimit) {
        rejected.push({ id, error: `${label}: daily limit of ${settings.dailyLimit} new listings reached (Marketplace settings)` });
        continue;
      }
      // no listing text yet: write it from the template (same as pressing "Template")
      // no text yet, or text made by the template earlier: write it again from the vehicle as it is now
      // (text the dealer edited or the AI wrote is kept)
      if ((!mp.title && !mp.description) || mp.copySource === 'template' || !mp.copySource) await this.makeCopy(tenantId, id, false);
      used++;
      await this.upsertListing(tenantId, id, { status: 'queued', error: '', postedBy: uk });
      this.queueListingWrite(tenantId, id, {}, 'Queued for publishing');
      accepted.push({ id, action: 'publish' });
    }
    s.mpEnqueue(accepted);
    return { ok: true, queued: accepted.length, rejected };
  }

  private async ownListing(tenantId: string, uk: string, id: string, needUrl: boolean) {
    const v = await this.vehicleWithListing(tenantId, id);
    const l = v.fbListing;
    if (!l || (needUrl ? !l.url : !l.fbId)) throw new BadRequestException(needUrl ? 'No Facebook link saved for this vehicle.' : 'No Facebook listing saved for this vehicle. Paste the listing link first.');
    if (l.postedBy && l.postedBy !== uk) throw new BadRequestException('This listing was posted with another team member\'s Facebook login. Only that login can change it on Facebook.');
    return { v, l };
  }

  async updateListing(tenantId: string, u: AuthUser, id: string, b: { price?: unknown }) {
    const { s, uk } = await this.live(tenantId, u);
    await this.mpSettings(tenantId);
    const { v } = await this.ownListing(tenantId, uk, id, false);
    const price = num(b.price) || (v.price === null ? null : Math.round(Number(v.price)));
    if (!price) throw new BadRequestException('Enter a price.');
    s.mpEnqueue([{ id, action: 'update', opts: { price } }]);
    return { ok: true, queued: true };
  }

  async removeListing(tenantId: string, u: AuthUser, id: string, mode: string) {
    const { s, uk } = await this.live(tenantId, u);
    await this.ownListing(tenantId, uk, id, true);
    s.mpEnqueue([{ id, action: mode === 'sold' ? 'sold' : 'delete' }]);
    return { ok: true, queued: true };
  }

  async verifyListing(tenantId: string, u: AuthUser, id: string) {
    const { s } = await this.live(tenantId, u);
    const v = await this.vehicleWithListing(tenantId, id);
    if (!v.fbListing?.url) throw new BadRequestException('No Facebook link saved for this vehicle.');
    s.mpEnqueue([{ id, action: 'verify' }]);
    return { ok: true, queued: true };
  }

  /** manual corrections (always recorded as "entered by you", never as detected) */
  async manualListing(tenantId: string, u: AuthUser, id: string, b: { action?: string; url?: string }) {
    const { uk } = await this.ctx(tenantId, u);
    const v = await this.vehicleWithListing(tenantId, id);
    const l = v.fbListing;
    const hist = (note: string) => [{ at: nowIso(), note }, ...((l?.history as unknown[]) || [])].slice(0, 30);
    if (b.action === 'set_url') {
      const m = String(b.url || '').match(/^https:\/\/(?:www\.|m\.|web\.)?facebook\.com\/marketplace\/item\/(\d+)/i);
      if (!m) throw new BadRequestException('Paste a Marketplace listing link like https://www.facebook.com/marketplace/item/1234567890/');
      await this.upsertListing(tenantId, id, {
        status: 'published', url: `https://www.facebook.com/marketplace/item/${m[1]}/`, fbId: m[1],
        postedPrice: l?.postedPrice ?? (v.price === null ? null : Number(v.price)), error: '',
        publishedAt: l?.publishedAt || new Date(), postedBy: l?.postedBy || uk, history: hist('Listing link entered by you'),
      });
    } else if (b.action === 'mark_removed') {
      await this.upsertListing(tenantId, id, { status: 'removed', error: '', history: hist('Marked removed by you') });
    } else if (b.action === 'mark_sold') {
      await this.upsertListing(tenantId, id, { status: 'sold', error: '', history: hist('Marked sold by you') });
    } else if (b.action === 'reset') {
      if (['queued', 'publishing', 'awaiting_publish'].includes(l?.status || '')) throw new BadRequestException('This vehicle is being posted right now. Press Stop first.');
      await this.upsertListing(tenantId, id, {
        status: 'none', url: '', fbId: '', postedPrice: null, error: '', publishedAt: null, checkedAt: null, postedBy: '', history: hist('Listing record cleared by you'),
      });
    } else throw new BadRequestException('Unknown action.');
    return { ok: true };
  }

  async mpStop(tenantId: string, u: AuthUser) {
    const s = this.sessions.get(this.key(tenantId, userKey(u)));
    s?.mpStop();
    return { ok: true };
  }
}

/** multer: uploaded post media goes to storage/facebook/tmp and is deleted after posting */
export function fbUploadName(original: string) {
  const ext = extname(original).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 6) || '.bin';
  return `${Date.now()}_${randomBytes(5).toString('hex')}${ext}`;
}

export function cleanupStaleTemp() {
  try {
    rmSync(FB_TMP, { recursive: true, force: true });
    mkdirSync(FB_TMP, { recursive: true });
  } catch {
    /* ignore */
  }
}


/**
 * After a crash or a hard restart, Chrome processes of the old run can still be alive and hold the profile locks:
 * end them (Linux / macOS: only Chromes started with our profiles folder) and remove the lock files.
 */
async function cleanupStaleChrome() {
  if (process.platform !== 'win32') {
    await new Promise<void>((r) => execFile('pkill', ['-f', `user-data-dir=${PROFILES}`], () => r()));
  }
  const walk = (dir: string, depth: number) => {
    let list: string[] = [];
    try {
      list = readdirSync(dir);
    } catch {
      return;
    }
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) if (list.includes(f)) rmSync(join(dir, f), { force: true });
    if (depth < 2) for (const d of list) if (!d.startsWith('Singleton')) walk(join(dir, d), depth + 1);
  };
  walk(PROFILES, 0);
}
