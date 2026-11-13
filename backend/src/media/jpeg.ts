import { Logger } from '@nestjs/common';

/**
 * UNIVERSAL JPEG for vehicle photos.
 * Every vehicle photo — uploaded (JPG, PNG, WebP, AVIF, HEIC/HEIF, GIF, BMP, TIFF) or downloaded from an imported link —
 * is stored as a clean baseline .jpeg:
 *   sharp(buffer).rotate()                       EXIF orientation applied (phone photos stand upright)
 *         .flatten({ background: '#FFFFFF' })    transparency → white, never black
 *         .jpeg({ quality: 90, mozjpeg: true })
 * Very large photos are scaled down to 4000 px on the longest side (CarGurus and the websites never use more).
 * Animated GIF / WebP: the first frame is used.
 * HEIC / HEIF (iPhone): the standard sharp build cannot decode HEVC, so those are decoded with the "heic-convert"
 * package first (pure JavaScript, no system libraries needed).
 * BMP: the standard sharp build has no BMP reader either, so BMP is read by decodeBmp() below.
 */

export const JPEG_OPTIONS = { quality: 90, mozjpeg: true } as const;
const MAX_SIDE = 4000;

type SharpImg = {
  rotate(): SharpImg;
  flatten(o: { background: string }): SharpImg;
  resize(w: number, h: number, o: Record<string, unknown>): SharpImg;
  toColourspace(c: string): SharpImg;
  jpeg(o: Record<string, unknown>): SharpImg;
  metadata(): Promise<{ format?: string; width?: number; height?: number }>;
  toBuffer(o: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; format: string } }>;
};
type SharpFn = (input: Buffer, o?: Record<string, unknown>) => SharpImg;
type Raw = { data: Buffer; width: number; height: number; channels: 3 | 4 };
type HeicConvert = (o: { buffer: Buffer | Uint8Array; format: 'JPEG' | 'PNG'; quality?: number }) => Promise<ArrayBuffer | Buffer | Uint8Array>;

/* module names in variables: TypeScript compiles without the packages; they are loaded when first needed */
const SHARP = 'sharp';
const HEIC = 'heic-convert';
const log = new Logger('Jpeg');

let sharpP: Promise<SharpFn | null> | null = null;
export function loadSharp(): Promise<SharpFn | null> {
  sharpP ??= import(SHARP)
    .then((m: { default?: SharpFn }) => (m.default ?? (m as unknown as SharpFn)) as SharpFn)
    .catch(() => {
      log.error('the "sharp" package is not installed: run npm install in backend/ (photos cannot be converted to JPEG)');
      return null;
    });
  return sharpP;
}

let heicP: Promise<HeicConvert | null> | null = null;
function loadHeic(): Promise<HeicConvert | null> {
  heicP ??= import(HEIC)
    .then((m: { default?: HeicConvert }) => (m.default ?? (m as unknown as HeicConvert)) as HeicConvert)
    .catch(() => null);
  return heicP;
}

/** HEIC / HEIF / AVIF container ("ftyp" box) — brand tells which */
export function isoBrand(buf: Buffer): string {
  if (buf.length < 12 || buf.subarray(4, 8).toString('ascii') !== 'ftyp') return '';
  return buf.subarray(8, 12).toString('ascii');
}
export function isHeic(buf: Buffer): boolean {
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(isoBrand(buf));
}

export class JpegError extends Error {}

/**
 * Any image → JPEG. Throws JpegError with a plain-language message when the data is not a readable image.
 * Returns null only when sharp itself is not installed (the caller then keeps the original file).
 */
export async function toJpeg(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  let src = input;
  if (isHeic(input)) {
    // try sharp first (a server with a full libvips can read HEIC), then heic-convert
    const ok = await sharp(input, { failOn: 'none' })
      .metadata()
      .then((m) => !!m.width)
      .catch(() => false);
    if (!ok) {
      const heic = await loadHeic();
      if (!heic) throw new JpegError('HEIC photos need the "heic-convert" package on the server (npm install in backend/)');
      try {
        const out = await heic({ buffer: input, format: 'JPEG', quality: 1 });
        src = Buffer.from(out instanceof ArrayBuffer ? new Uint8Array(out) : out);
      } catch {
        throw new JpegError('this HEIC photo could not be read');
      }
    }
  }
  let raw: Raw | null = null;
  if (src[0] === 0x42 && src[1] === 0x4d) {
    raw = decodeBmp(src);
    if (!raw) throw new JpegError('this BMP file could not be read');
  }
  try {
    const input = raw
      ? sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
      : sharp(src, { failOn: 'none', animated: false, limitInputPixels: 268_402_689 });
    const { data, info } = await input
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#FFFFFF' })
      .toColourspace('srgb')
      .jpeg(JPEG_OPTIONS)
      .toBuffer({ resolveWithObject: true });
    if (info.format !== 'jpeg' || !data.length) throw new Error('no output');
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw new JpegError('this file is not a photo that can be read (use JPG, PNG, WebP, AVIF, HEIC, GIF or BMP)');
  }
}

/**
 * Windows BMP → raw pixels (sharp's standard build cannot read BMP). Uncompressed 24 / 32-bit (BI_RGB, BI_BITFIELDS
 * with the usual masks) and 1 / 4 / 8-bit palette images, bottom-up or top-down. Anything else → null.
 */
export function decodeBmp(b: Buffer): Raw | null {
  try {
    if (b.length < 54 || b[0] !== 0x42 || b[1] !== 0x4d) return null;
    const offset = b.readUInt32LE(10);
    const header = b.readUInt32LE(14);
    if (header < 40) return null;
    const width = b.readInt32LE(18);
    const hRaw = b.readInt32LE(22);
    const bpp = b.readUInt16LE(28);
    const compression = b.readUInt32LE(30);
    const height = Math.abs(hRaw);
    const topDown = hRaw < 0;
    if (width <= 0 || height <= 0 || width * height > 100_000_000) return null;
    if (!(compression === 0 || (compression === 3 && bpp === 32))) return null;
    if (![1, 4, 8, 24, 32].includes(bpp)) return null;
    const stride = Math.floor((bpp * width + 31) / 32) * 4;
    if (offset + stride * height > b.length) return null;
    let palette: number[][] = [];
    if (bpp <= 8) {
      const colors = b.readUInt32LE(46) || 1 << bpp;
      const p0 = 14 + header;
      palette = Array.from({ length: colors }, (_, i) => [b[p0 + i * 4 + 2], b[p0 + i * 4 + 1], b[p0 + i * 4]]);
    }
    // 32-bit: alpha only when the file really has some (many BMPs leave the 4th byte at 0)
    let alpha = false;
    if (bpp === 32) {
      for (let y = 0; y < height && !alpha; y++) for (let x = 0; x < width; x++) if (b[offset + y * stride + x * 4 + 3]) { alpha = true; break; }
    }
    const ch = alpha ? 4 : 3;
    const out = Buffer.alloc(width * height * ch);
    for (let y = 0; y < height; y++) {
      const row = offset + (topDown ? y : height - 1 - y) * stride;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * ch;
        let r: number, g: number, bl: number, a = 255;
        if (bpp === 24 || bpp === 32) {
          const i = row + x * (bpp / 8);
          bl = b[i];
          g = b[i + 1];
          r = b[i + 2];
          if (bpp === 32) a = b[i + 3];
        } else {
          const bit = x * bpp;
          const byte = b[row + (bit >> 3)];
          const idx = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          [r, g, bl] = palette[idx] || [0, 0, 0];
        }
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = bl;
        if (ch === 4) out[o + 3] = a;
      }
    }
    return { data: out, width, height, channels: ch };
  } catch {
    return null;
  }
}
