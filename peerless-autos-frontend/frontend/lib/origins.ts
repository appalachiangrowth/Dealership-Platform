/**
 * Addresses allowed to show this website inside an iframe (design / content / pages preview) and to drive
 * the live preview with postMessage. Kept dependency-free so next.config.ts can use it too.
 *
 * Peerless: the Dealer Portal runs at https://peerlessautosales1.com/admin and the website at
 * https://www.peerlessautosales1.com — two different origins, so both are allowed by default.
 * More addresses: ADMIN_URL (comma-separated), PORTAL_URL, or NEXT_PUBLIC_FRONTEND_URL.
 */
const PEERLESS_ORIGINS = ['https://peerlessautosales1.com', 'https://www.peerlessautosales1.com'];

const LOCAL_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'];

/** "https://x.com/admin/" -> "https://x.com"; anything that isn't an http(s) address is dropped */
function originOf(u: string): string {
  const m = String(u || '').trim().match(/^https?:\/\/[^/\s?#]+/i);
  return m ? m[0].toLowerCase() : '';
}

/** a bare domain and its www. twin (peerlessautosales1.com <-> www.peerlessautosales1.com); other addresses as they are */
function withWww(o: string): string[] {
  const m = o.match(/^(https?:\/\/)(www\.)?([^/:]+)(:\d+)?$/i);
  if (!m || !/^[a-z0-9-]+\.[a-z]{2,}$/i.test(m[3])) return [o];
  const port = m[4] || '';
  return [`${m[1]}${m[3]}${port}`, `${m[1]}www.${m[3]}${port}`];
}

export function adminOrigins(): string[] {
  const fromEnv = [process.env.ADMIN_URL, process.env.PORTAL_URL, process.env.NEXT_PUBLIC_FRONTEND_URL]
    .flatMap((v) => String(v || '').split(','))
    .map(originOf)
    .filter(Boolean)
    .flatMap(withWww);
  return Array.from(new Set([...LOCAL_ORIGINS, ...PEERLESS_ORIGINS, ...fromEnv]));
}

/** the CSP rule that lets the portals frame this site: frame-ancestors 'self' https://peerlessautosales1.com … */
export function frameAncestors(): string {
  return `frame-ancestors 'self' ${adminOrigins().join(' ')}`;
}
