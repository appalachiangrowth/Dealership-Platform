import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, join, relative, resolve, sep } from 'path';
import { randomBytes } from 'crypto';
import { loadSharp } from './jpeg.js';

/**
 * Card-size vehicle photos for the dealer websites (iOS memory guard).
 *   /uploads/<dealer>/…/photo.jpeg?w=600  →  the same photo, at most 600 px wide (kept in uploads/.thumbs/600/…)
 * A full 1600×1200 photo needs ~7.7 MB of memory once the phone decodes it; a 600 px card ~1.1 MB. The original
 * file is untouched and still served without ?w= (vehicle page gallery, CarGurus, Facebook).
 * Only these widths are made (no unlimited variants): 320, 480, 600, 900, 1200. Anything unexpected (other widths,
 * non-JPEG files, missing photo, sharp not installed) falls through to the normal /uploads file.
 */
const WIDTHS = new Set([320, 480, 600, 900, 1200]);
const log = new Logger('Thumbs');

type Req = { method: string; path: string; query?: Record<string, unknown> };
type Res = { setHeader(k: string, v: string): void; sendFile(p: string, cb?: (e?: Error) => void): void; headersSent?: boolean };

export function thumbnailMiddleware(uploadsDir: string) {
  const root = resolve(uploadsDir);
  const cacheRoot = join(root, '.thumbs');
  const inflight = new Map<string, Promise<boolean>>();

  async function make(src: string, out: string, w: number): Promise<boolean> {
    const sharp = await loadSharp();
    if (!sharp) return false;
    const input = await readFile(src);
    const { data } = await sharp(input)
      .rotate()
      .flatten({ background: '#FFFFFF' })
      .resize(w, w * 4, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    await mkdir(dirname(out), { recursive: true });
    const tmp = `${out}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, out); // never serve a half-written file
    return true;
  }

  return (req: Req, res: Res, next: () => void) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const w = Number(req.query?.w);
    if (!WIDTHS.has(w)) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(req.path || '');
    } catch {
      return next();
    }
    if (!/\.jpe?g$/i.test(rel) || rel.includes('\0') || rel.split('/').some((p) => p.startsWith('.'))) return next();
    const src = resolve(root, '.' + rel);
    if (!src.startsWith(root + sep) || !existsSync(src)) return next();
    const out = join(cacheRoot, String(w), relative(root, src));

    const send = () => {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.sendFile(out, (e) => {
        if (e && !res.headersSent) next();
      });
    };
    if (existsSync(out)) return send();

    let job = inflight.get(out);
    if (!job) {
      job = make(src, out, w)
        .catch((e) => {
          log.warn(`could not make a ${w}px copy of ${rel}: ${(e as Error).message}`);
          return false;
        })
        .finally(() => inflight.delete(out));
      inflight.set(out, job);
    }
    job.then((ok) => (ok ? send() : next()), () => next());
  };
}
