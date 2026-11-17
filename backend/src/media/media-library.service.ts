import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, open, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { clean, cleanMl, randomHex } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';
import { MediaService, UPLOAD_ROOT, sniffImage } from './media.service.js';
import { invalidateMediaMeta } from './media-meta.js';

/**
 * Platform Admin › SEO & URLs › Images: every picture and video of one dealership (vehicle photos, blog pictures,
 * logo / favicon / website images …) with its attachment details (alt text, title, caption, description).
 *
 * Every upload through the API is a MediaFile row. Files that are in the dealership's uploads folder without a row
 * (older uploads, copied files) are added the first time the library is opened (at most every 5 minutes).
 */

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ico: 'image/x-icon', avif: 'image/avif', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const VIDEO_MAX = 150 * 1024 * 1024;
const SYNC_EVERY = 5 * 60_000;
const SYNC_MAX_FILES = 20_000;
const lastSync = new Map<string, number>();

/** mp4 / mov / webm from the first bytes */
export function sniffVideo(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length > 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'qt  ') return { ext: 'mov', mime: 'video/quicktime' };
    if (/^(isom|iso[2-9]|mp4[12v]|avc1|m4v |M4V |dash|3gp\d|3g2\w|mmp4|f4v |MSNV)$/.test(brand)) return { ext: 'mp4', mime: 'video/mp4' };
  }
  if (buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: 'webm', mime: 'video/webm' };
  return null;
}

/** width / height of a picture from its first bytes (JPEG, PNG, GIF, WebP, ICO) */
export function imageSize(buf: Buffer): { width?: number; height?: number } {
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const c = buf.toString('ascii', 12, 16);
    if (c === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (c === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (c === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    return {};
  }
  if (buf.length >= 8 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return { width: buf[6] || 256, height: buf[7] || 256 };
  const k = sniffImage(buf);
  return k ? { width: k.width, height: k.height } : {};
}

async function head(file: string, bytes = 256 * 1024): Promise<Buffer> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export type MediaItem = {
  id: string;
  url: string;
  fileName: string;
  originalName: string;
  mime: string;
  kind: 'image' | 'video' | 'file';
  size: number;
  width: number | null;
  height: number | null;
  altText: string;
  title: string;
  caption: string;
  description: string;
  uploadedBy: string;
  createdAt: Date;
};

@Injectable()
export class MediaLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  private async dealer(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!t) throw new NotFoundException('Dealership not found');
    return t;
  }

  private item(m: {
    id: string; url: string; mime: string; size: number; width: number | null; height: number | null; originalName: string; uploadedBy: string; createdAt: Date;
    altText?: string; title?: string; caption?: string; description?: string;
  }): MediaItem {
    return {
      id: m.id,
      url: m.url,
      fileName: m.url.split('/').pop() || '',
      originalName: m.originalName,
      mime: m.mime,
      kind: m.mime.startsWith('image/') ? 'image' : m.mime.startsWith('video/') ? 'video' : 'file',
      size: m.size,
      width: m.width,
      height: m.height,
      altText: m.altText ?? '',
      title: m.title ?? '',
      caption: m.caption ?? '',
      description: m.description ?? '',
      uploadedBy: m.uploadedBy,
      createdAt: m.createdAt,
    };
  }

  /** files in uploads/<dealer>/ that have no MediaFile row yet (older uploads) are added */
  private async sync(tenantId: string, force = false) {
    const last = lastSync.get(tenantId) || 0;
    if (!force && Date.now() - last < SYNC_EVERY) return;
    lastSync.set(tenantId, Date.now());
    const root = join(UPLOAD_ROOT, tenantId);
    const found: string[] = [];
    const walk = async (rel: string, depth: number) => {
      if (depth > 6 || found.length >= SYNC_MAX_FILES) return;
      let entries;
      try {
        entries = await readdir(join(root, rel), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (found.length >= SYNC_MAX_FILES) return;
        if (e.name.startsWith('.')) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(r, depth + 1);
        else if (e.isFile() && MIME[(e.name.split('.').pop() || '').toLowerCase()]) found.push(r);
      }
    };
    await walk('', 0);
    if (!found.length) return;
    const known = new Set((await this.prisma.mediaFile.findMany({ where: { tenantId }, select: { path: true } })).map((m) => m.path.replace(/\\/g, '/')));
    const rows: { tenantId: string; url: string; path: string; mime: string; size: number; width: number | null; height: number | null; originalName: string; uploadedBy: string; createdAt: Date }[] = [];
    for (const r of found) {
      const path = `${tenantId}/${r}`;
      if (known.has(path)) continue;
      const ext = (r.split('.').pop() || '').toLowerCase();
      try {
        const st = await stat(join(UPLOAD_ROOT, path));
        const mime = MIME[ext];
        const dim = mime.startsWith('image/') && ext !== 'svg' ? imageSize(await head(join(UPLOAD_ROOT, path), 64 * 1024)) : {};
        rows.push({
          tenantId,
          url: `/uploads/${path}`,
          path,
          mime,
          size: st.size,
          width: dim.width ?? null,
          height: dim.height ?? null,
          originalName: r.split('/').pop() || '',
          uploadedBy: '',
          createdAt: st.mtime,
        });
      } catch {
        /* removed meanwhile */
      }
    }
    for (let i = 0; i < rows.length; i += 500) await this.prisma.mediaFile.createMany({ data: rows.slice(i, i + 500) });
  }

  /** GET ?type=image|video &q= &page= &pageSize= */
  async list(dealerId: string, q: { type?: string; q?: string; page?: string; pageSize?: string }) {
    await this.dealer(dealerId);
    await this.sync(dealerId);
    const type = q.type === 'image' || q.type === 'video' ? q.type : '';
    const search = clean(q.q, 120);
    const pageSize = Math.min(120, Math.max(12, Number(q.pageSize) || 60));
    const page = Math.max(1, Number(q.page) || 1);
    const kindWhere = type ? { mime: { startsWith: `${type}/` } } : { OR: [{ mime: { startsWith: 'image/' } }, { mime: { startsWith: 'video/' } }] };
    const where = {
      tenantId: dealerId,
      AND: [
        kindWhere,
        ...(search
          ? [
              {
                OR: [
                  { originalName: { contains: search, mode: 'insensitive' as const } },
                  { url: { contains: search, mode: 'insensitive' as const } },
                  { title: { contains: search, mode: 'insensitive' as const } },
                  { altText: { contains: search, mode: 'insensitive' as const } },
                  { caption: { contains: search, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    const [rows, total, images, videos] = await Promise.all([
      this.prisma.mediaFile.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.mediaFile.count({ where }),
      this.prisma.mediaFile.count({ where: { tenantId: dealerId, mime: { startsWith: 'image/' } } }),
      this.prisma.mediaFile.count({ where: { tenantId: dealerId, mime: { startsWith: 'video/' } } }),
    ]);
    // pictures saved without their size (WebP, older uploads): measured once from the file
    for (const r of rows) {
      if (r.width || !r.mime.startsWith('image/') || r.mime === 'image/svg+xml') continue;
      try {
        const dim = imageSize(await head(join(UPLOAD_ROOT, r.path), 64 * 1024));
        if (dim.width && dim.height) {
          r.width = dim.width;
          r.height = dim.height;
          await this.prisma.mediaFile.update({ where: { id: r.id }, data: { width: dim.width, height: dim.height } });
        }
      } catch {
        /* file missing on disk */
      }
    }
    return { items: rows.map((r) => this.item(r)), total, page, pageSize, counts: { image: images, video: videos } };
  }

  /** "Add Media File": pictures (stored like logo / website images) and videos (mp4, mov, webm ≤ 150 MB) */
  async upload(dealerId: string, files: { buffer: Buffer; originalname: string; size: number }[], user: AuthUser) {
    await this.dealer(dealerId);
    if (!files?.length) throw new BadRequestException('No file received');
    const saved: MediaItem[] = [];
    const errors: { file: string; error: string }[] = [];
    for (const f of files) {
      try {
        const video = sniffVideo(f.buffer);
        if (video) saved.push(await this.saveVideo(dealerId, f, video, user));
        else {
          const m = await this.media.save(dealerId, f, user, 'site', { skipSizeCheck: true });
          saved.push(this.item(m));
        }
      } catch (e) {
        errors.push({ file: f.originalname, error: (e as Error).message });
      }
    }
    if (saved.length) await this.audit.record('media.library.upload', { tenantId: dealerId, actor: user.login, detail: { files: saved.map((s) => s.url) } });
    return { files: saved, errors };
  }

  private async saveVideo(tenantId: string, file: { buffer: Buffer; originalname: string; size: number }, kind: { ext: string; mime: string }, user: AuthUser) {
    if (file.size > VIDEO_MAX) throw new BadRequestException('Videos can be up to 150 MB');
    const d = new Date();
    const sub = [tenantId, 'media', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')].join('/');
    const name = `${randomHex(8)}.${kind.ext}`;
    await mkdir(join(UPLOAD_ROOT, sub), { recursive: true });
    await writeFile(join(UPLOAD_ROOT, sub, name), file.buffer);
    const m = await this.prisma.mediaFile.create({
      data: {
        tenantId,
        url: `/uploads/${sub}/${name}`,
        path: `${sub}/${name}`,
        mime: kind.mime,
        size: file.buffer.length,
        originalName: (file.originalname || '').slice(0, 200),
        uploadedBy: user.login,
      },
    });
    return this.item(m);
  }

  /** PATCH { altText, title, caption, description } */
  async update(dealerId: string, id: string, b: Record<string, unknown>, user: AuthUser) {
    const m = await this.prisma.mediaFile.findFirst({ where: { id, tenantId: dealerId } });
    if (!m) throw new NotFoundException('File not found');
    const data: { altText?: string; title?: string; caption?: string; description?: string; metaUpdatedAt: Date } = { metaUpdatedAt: new Date() };
    if ('altText' in b) data.altText = clean(b.altText, 500);
    if ('title' in b) data.title = clean(b.title, 200);
    if ('caption' in b) data.caption = cleanMl(b.caption, 2000);
    if ('description' in b) data.description = cleanMl(b.description, 5000);
    const out = await this.prisma.mediaFile.update({ where: { id }, data });
    invalidateMediaMeta(dealerId);
    await this.audit.record('media.library.update', { tenantId: dealerId, actor: user.login, detail: { url: m.url } });
    return this.item(out);
  }
}
