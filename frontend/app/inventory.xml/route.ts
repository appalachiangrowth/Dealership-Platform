import { backend, hostOf, siteErrorPage } from '@/lib/backend';

export const dynamic = 'force-dynamic';

/** https://DEALER-DOMAIN/inventory.xml — public inventory feed for marketplaces. */
export async function GET(req: Request) {
  const res = await backend('/public/feeds/inventory.xml', hostOf(req));
  if (res.status === 403) return siteErrorPage(res);
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.ok ? 'application/xml; charset=utf-8' : 'text/plain', 'Cache-Control': 'no-cache, must-revalidate' },
  });
}
