import { inflateRawSync } from 'zlib';

/**
 * Small ZIP reader (no extra package): reads the central directory, then "stored" or "deflate" entries.
 * Used only for website design packages (Platform Admin › Themes & releases › Install a design package).
 * ZIP64, encrypted and multi-disk archives are refused — design packages are far below 4 GB.
 */
export interface ZipEntry {
  name: string;
  directory: boolean;
  symlink: boolean;
  encrypted: boolean;
  method: number;
  size: number;
  compressedSize: number;
  localOffset: number;
}

export class ZipError extends Error {}

export function readZip(buf: Buffer) {
  // End of central directory: the last 22 bytes (+ up to 64 KB comment)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('This file is not a readable ZIP archive.');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError('ZIP64 archives are not supported. Re-create the ZIP with a standard ZIP tool.');
  if (cdOffset + cdSize > buf.length) throw new ZipError('The ZIP archive is damaged (central directory outside the file).');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('The ZIP archive is damaged (bad central directory entry).');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    const unixMode = (extAttr >>> 16) & 0xffff;
    entries.push({
      name,
      directory: name.endsWith('/'),
      symlink: madeBy >> 8 === 3 && (unixMode & 0o170000) === 0o120000,
      encrypted: !!(flags & 0x1),
      method,
      size,
      compressedSize,
      localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  function read(e: ZipEntry): Buffer {
    if (e.encrypted) throw new ZipError(`Encrypted files are not allowed: ${e.name}`);
    const h = e.localOffset;
    if (h + 30 > buf.length || buf.readUInt32LE(h) !== 0x04034b50) throw new ZipError(`The ZIP archive is damaged near ${e.name}.`);
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const raw = buf.subarray(start, start + e.compressedSize);
    if (raw.length !== e.compressedSize) throw new ZipError(`A file inside the ZIP is incomplete: ${e.name}`);
    let out: Buffer;
    if (e.method === 0) out = Buffer.from(raw);
    else if (e.method === 8) {
      try {
        out = inflateRawSync(raw, { maxOutputLength: e.size + 1 });
      } catch {
        throw new ZipError(`A file inside the ZIP could not be unpacked: ${e.name}`);
      }
    } else throw new ZipError(`Unsupported compression in the ZIP (${e.name}). Use a standard ZIP tool.`);
    if (out.length !== e.size) throw new ZipError(`A theme file was incomplete during extraction: ${e.name}`);
    return out;
  }

  return { entries, read };
}
