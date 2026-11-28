import { backend, hostOf } from '@/lib/backend';
import { cleanInventoryPosts, hideCertified } from '@/lib/site-extras';

export const dynamic = 'force-dynamic';

/** query parameters of the paged storefront feed (passed to the backend's /public/feed) */
const FEED_PARAMS = ['page', 'limit', 'make', 'model', 'body', 'minPrice', 'maxPrice', 'minYear', 'maxYear', 'maxMileage', 'fuel', 'drive', 'q', 'sort', 'featured', 'facets', 'posts', 'id'] as const;

/**
 * api/feed-public.php
 *  · Storefront feed for the designs (JSON, never the whole inventory — iOS memory guard for big dealerships):
 *      ?page=1&limit=16&make=&model=&body=&minPrice=&maxPrice=&q=&sort=   one page (≤ 16 vehicles) + total + pages
 *      ?featured=1&limit=12                                              featured / newest vehicles (≤ 12)
 *      ?facets=1                                                         makes, models, body styles, price range
 *      ?id=<vehicle id>                                                  one vehicle with all photos
 *      ?posts=1                                                          the blog posts (no vehicles)
 *  · Private CSV link for CarGurus, same address as before: ?type=csv&key=FEED_KEY (approved feed only)
 *  · ?type=xml: the inventory XML feed
 * Without any of these parameters the address answers exactly as before (the CarGurus CSV, which needs its key).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const type = u.searchParams.get('type');
  if (type === 'xml') {
    const res = await backend('/public/feeds/inventory.xml', hostOf(req));
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }
  if (type !== 'csv' && !u.searchParams.has('key') && FEED_PARAMS.some((p) => u.searchParams.has(p))) {
    const query: Record<string, string> = {};
    for (const p of FEED_PARAMS) {
      const v = u.searchParams.get(p);
      if (v !== null && v !== '') query[p] = v.slice(0, 120);
    }
    const res = await backend('/public/feed', hostOf(req), { query });
    return new Response(res.ok ? cleanFeed(await res.text()) : await res.text(), {
      status: res.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // short browser cache: paging back and forth does not refetch, new vehicles show within a minute
        'Cache-Control': res.ok ? 'public, max-age=60' : 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  const res = await backend('/public/feeds/cargurus.csv', hostOf(req), { query: { key: u.searchParams.get('key') || '' } });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.ok ? 'text/csv; charset=utf-8' : 'text/plain', 'Cache-Control': 'no-store' },
  });
}

/** same clean-up as /inventory.json: no certified / CPO details, rich article HTML sanitized */
function cleanFeed(json: string): string {
  const out = cleanInventoryPosts(json);
  try {
    const data = JSON.parse(out) as { vehicle?: Record<string, unknown> };
    if (!data || typeof data !== 'object' || !data.vehicle || typeof data.vehicle !== 'object') return out;
    hideCertified(data.vehicle);
    return JSON.stringify(data);
  } catch {
    return out;
  }
}
