import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { readFile } from 'fs/promises';
import { join, normalize } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CargurusService } from '../cargurus/cargurus.service.js';
import { UPLOAD_ROOT, sniffImage } from '../media/media.service.js';
import { isColor } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';
import type { TenantSettings } from '../generated/prisma/client.js';

/**
 * PHOTO BRANDING (port of the old platform/lib/brand.php + api/brand.php), Dealership Portal › Website content › Photo branding.
 * A top band (logo + address) and a bottom band (phone + website) on the MAIN photo of every vehicle; all other photos
 * stay clean, and when the main photo changes the bands move with it.
 *  - Bands: the dealer's own PNGs, otherwise AUTOMATIC bands drawn from Business details in the band colour.
 *  - The pictures are drawn in the dealer's browser (canvas) — this service keeps the state: which photos still need
 *    the current bands (jobs), the branded → clean-copy map, failed links, and it swaps the photos on the vehicles.
 *  - When the bands change (colour, own band, Business details), every branded main photo is redone from its clean copy.
 */
type MapEntry = { orig: string; src: string; ver: string; lay: number[] | null };
export type BrandJob = { kind: 'b' | 'p'; vehicleId: string; url: string; source: string; orig: string; src: string; lay: number[] | null };

const isUpload = (u: string) => /^\/uploads\//.test(u);
const isLink = (u: string) => /^https?:\/\//i.test(u);

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cargurus: CargurusService,
  ) {}

  private async settings(tenantId: string) {
    return this.prisma.tenantSettings.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
  }

  /** What the automatic bands are made of (Business details). */
  details(s: TenantSettings, fallbackName = '') {
    const site = String(s.siteUrl || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
    const city = (s.city || '').trim();
    const state = (s.state || '').trim();
    const cityLine = `${city}${city && state ? ', ' : ''}${state} ${(s.zip || '').trim()}`.trim();
    return {
      name: (s.name || fallbackName || '').trim(),
      street: (s.street || '').trim(),
      cityLine,
      phone: (s.phone || '').trim(),
      site,
      logo: (s.logo || '').trim(),
      color: isColor(s.brandBandColor) ? String(s.brandBandColor).toUpperCase() : '#EAF0F8',
    };
  }

  /** Version of the bands in use: changes when the dealer uploads a band, the colour or the Business details change. */
  version(s: TenantSettings) {
    const d = this.details(s);
    return createHash('md5')
      .update(JSON.stringify([s.brandHeader ? `own:${s.brandHeader}` : d, s.brandFooter ? `own:${s.brandFooter}` : d, 'bands-v1']))
      .digest('hex')
      .slice(0, 12);
  }

  private map(s: TenantSettings): Record<string, MapEntry> {
    const m = s.brandMap as Record<string, MapEntry> | null;
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  }
  private failed(s: TenantSettings): Record<string, { at: string; reason: string }> {
    const f = s.brandFailed as Record<string, { at: string; reason: string }> | null;
    return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
  }

  /** pa_brand_pending: main photos without the current bands ('b'), branded photos that are no longer the main one ('p'). */
  private async allJobs(tenantId: string, s: TenantSettings): Promise<BrandJob[]> {
    if (!s.brandImages) return [];
    const map = this.map(s);
    const failed = this.failed(s);
    const ver = this.version(s);
    const vehicles = await this.prisma.vehicle.findMany({ where: { tenantId }, select: { id: true, images: true }, orderBy: { updatedAt: 'desc' } });
    const out: BrandJob[] = [];
    const seen = new Set<string>();
    for (const v of vehicles) {
      v.images.forEach((u, i) => {
        if (!u || failed[u] || seen.has(`${v.id}|${u}`)) return;
        const e = map[u];
        if (i === 0) {
          if (e && e.ver === ver) return; // already has the current bands
          if (!isUpload(u) && !isLink(u)) return;
          seen.add(`${v.id}|${u}`);
          // redo from the clean copy when the photo was branded before, else from the photo itself
          out.push({ kind: 'b', vehicleId: v.id, url: u, source: e?.orig || e?.src || u, orig: e?.orig || '', src: e?.src || u, lay: e?.lay ?? null });
        } else if (e) {
          seen.add(`${v.id}|${u}`);
          out.push({ kind: 'p', vehicleId: v.id, url: u, source: e.orig || u, orig: e.orig || '', src: e.src || '', lay: e.lay ?? null });
        }
      });
    }
    return out;
  }

  async view(tenantId: string) {
    const s = await this.settings(tenantId);
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const jobs = await this.allJobs(tenantId, s);
    const failed = this.failed(s);
    return {
      enabled: s.brandImages,
      details: this.details(s, t?.name),
      header: { custom: !!s.brandHeader, url: s.brandHeader },
      footer: { custom: !!s.brandFooter, url: s.brandFooter },
      version: this.version(s),
      pending: jobs.length,
      failed: Object.keys(failed).length,
      failedList: Object.entries(failed)
        .slice(0, 20)
        .map(([url, x]) => ({ url, reason: x.reason })),
    };
  }

  async update(tenantId: string, b: { enabled?: boolean; color?: string }, user: AuthUser) {
    const data: Record<string, unknown> = {};
    if (typeof b.enabled === 'boolean') data.brandImages = b.enabled;
    if (b.color !== undefined) {
      const c = String(b.color).trim().toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(c)) throw new BadRequestException('Choose a colour like #EAF0F8.');
      data.brandBandColor = c;
    }
    await this.settings(tenantId);
    await this.prisma.tenantSettings.update({ where: { tenantId }, data });
    await this.audit.record('brand.update', { tenantId, actor: user.login, detail: data });
    return this.view(tenantId);
  }

  /** The dealer's own band (an uploaded PNG of this dealership), or '' = back to the automatic band. */
  async setBand(tenantId: string, b: { which?: string; url?: string }, user: AuthUser) {
    const which = b.which === 'footer' ? 'footer' : 'header';
    const url = String(b.url || '');
    if (url && !url.startsWith(`/uploads/${tenantId}/`)) throw new BadRequestException('Upload the band image first.');
    if (url && !/\.png$/i.test(url)) throw new BadRequestException('Upload a PNG image.');
    await this.settings(tenantId);
    await this.prisma.tenantSettings.update({ where: { tenantId }, data: which === 'header' ? { brandHeader: url } : { brandFooter: url } });
    await this.audit.record(url ? 'brand.upload' : 'brand.default', { tenantId, actor: user.login, detail: { which } });
    return this.view(tenantId);
  }

  async jobs(tenantId: string, max = 4) {
    const s = await this.settings(tenantId);
    const all = await this.allJobs(tenantId, s);
    return { jobs: all.slice(0, Math.min(20, Math.max(1, max))), remaining: all.length, version: this.version(s) };
  }

  /** A photo was branded (b) or went back to its clean copy (p): swap it on the vehicle and remember it. */
  async done(tenantId: string, b: { kind?: string; vehicleId?: string; from?: string; to?: string; orig?: string; src?: string; lay?: unknown; version?: string }, user: AuthUser) {
    const kind = b.kind === 'p' ? 'p' : 'b';
    const from = String(b.from || '');
    const to = String(b.to || '');
    if (!to.startsWith(`/uploads/${tenantId}/`)) throw new BadRequestException('The new photo must be one of your uploads.');
    const v = await this.prisma.vehicle.findFirst({ where: { id: String(b.vehicleId || ''), tenantId } });
    if (!v) throw new NotFoundException('Vehicle not found');
    const images = v.images.map((u, i) => (u === from && (kind === 'b' ? i === 0 : i > 0) ? to : u));
    const changed = images.some((u, i) => u !== v.images[i]);
    const s = await this.settings(tenantId);
    const map = { ...this.map(s) };
    const failed = { ...this.failed(s) };
    delete failed[from];
    if (changed) {
      if (kind === 'b') {
        const lay = Array.isArray(b.lay) ? (b.lay as unknown[]).slice(0, 4).map((x) => Math.round(Number(x) || 0)) : null;
        const orig = String(b.orig || '');
        map[to] = { orig: orig.startsWith(`/uploads/${tenantId}/`) ? orig : '', src: String(b.src || from).slice(0, 1000), ver: String(b.version || this.version(s)), lay };
        if (map[from] && from !== to) delete map[from];
      } else if (!v.images.some((u, i) => u === from && i === 0)) {
        delete map[from];
      }
      await this.prisma.vehicle.update({ where: { id: v.id }, data: { images } });
    }
    await this.prisma.tenantSettings.update({ where: { tenantId }, data: { brandMap: map as never, brandFailed: failed as never } });
    if (changed) await this.cargurus.afterInventoryChange(tenantId, user.login);
    return { ok: true, changed };
  }

  async fail(tenantId: string, b: { url?: string; reason?: string }) {
    const url = String(b.url || '').slice(0, 1000);
    if (!url) return { ok: true };
    const s = await this.settings(tenantId);
    const failed = { ...this.failed(s), [url]: { at: new Date().toISOString(), reason: String(b.reason || 'could not be branded').slice(0, 200) } };
    await this.prisma.tenantSettings.update({ where: { tenantId }, data: { brandFailed: failed as never } });
    return { ok: true };
  }

  async retry(tenantId: string) {
    await this.settings(tenantId);
    await this.prisma.tenantSettings.update({ where: { tenantId }, data: { brandFailed: {} as never } });
    return this.view(tenantId);
  }

  /**
   * A photo for the browser to draw on (its own uploads, or a web link from an import — downloaded here so the browser
   * may use it). Only public internet addresses are downloaded, never this server or the local network.
   */
  async source(tenantId: string, url: string): Promise<{ data: Buffer; mime: string }> {
    let data: Buffer;
    if (isUpload(url)) {
      const file = normalize(join(UPLOAD_ROOT, decodeURIComponent(url.slice('/uploads/'.length).split(/[?#]/)[0])));
      if (!file.startsWith(join(UPLOAD_ROOT, tenantId))) throw new BadRequestException('Not one of your photos');
      data = await readFile(file).catch(() => {
        throw new NotFoundException('file not found');
      });
    } else if (isLink(url)) {
      data = await this.download(url);
    } else throw new BadRequestException('not a web link');
    const kind = sniffImage(data);
    if (!kind) throw new BadRequestException('not a JPG, PNG, GIF or WebP photo');
    return { data, mime: kind.mime };
  }

  private async download(start: string): Promise<Buffer> {
    let url = start;
    for (let hop = 0; hop < 4; hop++) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new BadRequestException('not a web link');
      }
      if (!['http:', 'https:'].includes(u.protocol)) throw new BadRequestException('not a web link');
      const host = u.hostname.replace(/^\[|\]$/g, '');
      const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [] as { address: string }[]);
      if (!addrs.length) throw new BadRequestException(`website ${host} not found (no internet, or the link is wrong)`);
      if (addrs.some((a) => privateAddress(a.address))) throw new BadRequestException('address is not on the public internet');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 25_000);
      try {
        const res = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (DealerPlatform photo branding)' } });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          url = new URL(res.headers.get('location')!, url).toString();
          continue;
        }
        if (!res.ok) throw new BadRequestException(`the website answered ${res.status}`);
        const len = Number(res.headers.get('content-length') || 0);
        if (len > 15 * 1024 * 1024) throw new BadRequestException('photo larger than 15 MB');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 15 * 1024 * 1024) throw new BadRequestException('photo larger than 15 MB');
        return buf;
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException((e as Error).name === 'AbortError' ? 'the website took too long to answer' : 'the photo could not be downloaded');
      } finally {
        clearTimeout(timer);
      }
    }
    throw new BadRequestException('too many redirects');
  }
}

/** private, loopback, link-local and reserved addresses (IPv4 + IPv6) */
function privateAddress(ip: string): boolean {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
}
