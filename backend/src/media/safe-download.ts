import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Downloads a photo from a web link (CSV / feed imports). Only public internet addresses are fetched — never this
 * server or the local network (every redirect is checked again), at most 15 MB, 25 s.
 * Same rules as the photo-branding downloader.
 */
export async function downloadPublicImage(start: string, maxBytes = 15 * 1024 * 1024): Promise<Buffer> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error('not a web link');
    }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('not a web link');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [] as { address: string }[]);
    if (!addrs.length) throw new Error(`website ${host} not found`);
    if (addrs.some((a) => privateAddress(a.address))) throw new Error('address is not on the public internet');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    try {
      const res = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (DealerPlatform photo import)' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url).toString();
        continue;
      }
      if (!res.ok) throw new Error(`the website answered ${res.status}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > maxBytes) throw new Error('photo larger than 15 MB');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('photo larger than 15 MB');
      return buf;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('the website took too long to answer');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('too many redirects');
}

/** private, loopback, link-local and reserved addresses (IPv4 + IPv6) */
export function privateAddress(ip: string): boolean {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('ff');
}
