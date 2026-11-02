import { backend, hostOf } from '@/lib/backend';

export const dynamic = 'force-dynamic';

/** Private CSV link for CarGurus, same address as before: api/feed-public.php?type=csv&key=FEED_KEY (approved feed only). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('type') === 'xml') {
    const res = await backend('/public/feeds/inventory.xml', hostOf(req));
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
  }
  const res = await backend('/public/feeds/cargurus.csv', hostOf(req), { query: { key: u.searchParams.get('key') || '' } });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.ok ? 'text/csv; charset=utf-8' : 'text/plain', 'Cache-Control': 'no-store' },
  });
}
