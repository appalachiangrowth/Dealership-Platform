/**
 * POST /api/track — visitor activity from the tracker on every page (lib/activity-tracker.ts), single or batched:
 *   { dealerSlug, visitorId, events: [{ eventType, vehicleId, pagePath, scrollDepth, durationSec }] }
 * Passed on to the backend (/public/track) with the website host, so each dealership only ever gets its own
 * visitors. Location comes only from headers a proxy in front already added (Cloudflare, Vercel, Nginx GeoIP2);
 * nothing is looked up. Always answers fast and never with an error the visitor could notice.
 */
import { backend, hostOf } from '@/lib/backend';

export const dynamic = 'force-dynamic';

const MAX_BODY = 64 * 1024;

export async function POST(req: Request) {
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > MAX_BODY) return new Response(null, { status: 204 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204 });
  }
  const h = req.headers;
  const fwd = (h.get('x-forwarded-for') || '').split(',')[0].trim();
  const city = h.get('cf-ipcity') || h.get('x-vercel-ip-city') || h.get('x-geoip-city') || '';
  const region = h.get('cf-region') || h.get('x-vercel-ip-country-region') || h.get('x-geoip-region') || '';
  try {
    const res = await backend('/public/track', hostOf(req), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fwd ? { 'X-Forwarded-For': fwd } : {}),
        'X-Visitor-User-Agent': (h.get('user-agent') || '').slice(0, 400),
        ...(city ? { 'X-Visitor-City': city.slice(0, 120) } : {}),
        ...(region ? { 'X-Visitor-Region': region.slice(0, 120) } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return new Response(null, { status: res.status === 429 ? 429 : 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
