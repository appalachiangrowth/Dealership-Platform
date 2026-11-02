import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { randomHex } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';

export const UPLOAD_ROOT = join(process.cwd(), 'uploads');

/** Detects the real image type from the first bytes (the file name and browser type are not trusted). */
export function sniffImage(buf: Buffer): { ext: string; mime: string; width?: number; height?: number } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg', ...jpegSize(buf) };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { ext: 'png', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')
    return { ext: 'gif', mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

function jpegSize(buf: Buffer): { width?: number; height?: number } {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return {};
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return {};
}

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async save(tenantId: string, file: { buffer: Buffer; originalname: string; size: number }, user: AuthUser, folder = '') {
    if (!file?.buffer?.length) throw new BadRequestException('No file received');
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId }, select: { maxUploadMb: true } });
    const maxMb = s?.maxUploadMb || 12;
    if (file.size > maxMb * 1024 * 1024) throw new BadRequestException(`The photo is larger than ${maxMb} MB`);
    const kind = sniffImage(file.buffer);
    if (!kind) throw new BadRequestException('Only JPG, PNG, GIF or WebP images can be uploaded');
    const d = new Date();
    const sub = [tenantId, folder === 'site' ? 'site' : '', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0')].filter(Boolean).join('/');
    const name = `${randomHex(8)}.${kind.ext}`;
    await mkdir(join(UPLOAD_ROOT, sub), { recursive: true });
    await writeFile(join(UPLOAD_ROOT, sub, name), file.buffer);
    const rel = `${sub}/${name}`;
    const m = await this.prisma.mediaFile.create({
      data: {
        tenantId,
        url: `/uploads/${rel}`,
        path: rel,
        mime: kind.mime,
        size: file.size,
        width: kind.width ?? null,
        height: kind.height ?? null,
        originalName: (file.originalname || '').slice(0, 200),
        uploadedBy: user.login,
      },
    });
    return m;
  }

  list(tenantId: string) {
    return this.prisma.mediaFile.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  async remove(tenantId: string, id: string, user: AuthUser) {
    const m = await this.prisma.mediaFile.findFirst({ where: { id, tenantId } });
    if (!m) throw new NotFoundException('File not found');
    await this.prisma.mediaFile.delete({ where: { id } });
    await unlink(join(UPLOAD_ROOT, m.path)).catch(() => undefined);
    await this.audit.record('media.delete', { tenantId, actor: user.login, detail: { url: m.url } });
    return { ok: true };
  }
}
