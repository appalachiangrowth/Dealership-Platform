/**
 * POST api/lead.php — the theme forms (vehicle request, contact, test drive, trade-in, financing, Pages & SEO contact
 * forms) post here, exactly as before. Saved for the dealer first, then e-mailed (backend /public/leads).
 *
 * Sent to the backend with every inquiry:
 *  · the website host (hostOf: pinned NEXT_PUBLIC_TENANT, ?tenant= / pa_tenant cookie, or the domain)
 *  · the dealership id (X-Dealer-Slug + dealerSlug): the backend's fallback when the host matches no dealership
 *  · the visitor id of the activity tracker (pa_vid) + the visitor's browser, so the inquiry is linked to the
 *    visitor's website journey (Dealership Portal › Leads: intent, vehicles viewed, repeat visitor)
 */
import { backend, hostOf, tenantOf } from '@/lib/backend';

/** single-dealer storefront (Peerless, Happy Motors): the one dealership it is pinned to (same as lib/backend.ts) */
const FIXED_TENANT_ID = String(process.env.NEXT_PUBLIC_TENANT || process.env.TENANT || '').trim().toLowerCase();

const DEALER_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** the visitor id of the activity tracker (lib/activity-tracker.ts): sent with the form, or its pa_vid cookie */
function visitorIdOf(req: Request, b: Record<string, unknown>): string {
  const fromBody = String(b.visitorId ?? '').trim();
  if (/^[A-Za-z0-9_-]{8,80}$/.test(fromBody)) return fromBody;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)pa_vid=([A-Za-z0-9_-]{8,80})/);
  return m ? m[1] : '';
}

/** the dealership this inquiry is for: the site's pinned dealer, the ?tenant= visit, else what the design sent */
function dealerOf(req: Request, b: Record<string, unknown>): string {
  for (const v of [FIXED_TENANT_ID, tenantOf(req).id, b.dealerSlug, b.dealerId]) {
    const s = String(v ?? '').trim().toLowerCase();
    if (DEALER_ID.test(s)) return s;
  }
  return '';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b._honey) return Response.json({ ok: true }); // bots fill the hidden field: pretend success
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const dealer = dealerOf(req, b);
  const host = hostOf(req);
  let res: Response;
  try {
    res = await backend('/public/leads', host, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(fwd ? { 'X-Forwarded-For': fwd } : {}),
        'X-Visitor-User-Agent': (req.headers.get('user-agent') || '').slice(0, 400),
        ...(dealer ? { 'X-Dealer-Slug': dealer } : {}),
      },
      body: JSON.stringify({
        name: b.name ?? '',
        email: b.email ?? '',
        phone: b.phone ?? '',
        topic: b.topic ?? 'Website inquiry',
        message: b.message ?? '',
        page: b.page ?? '',
        vehicleId: b.vehicleId ?? '',
        dealerSlug: dealer,
        // links the inquiry to the visitor's website journey (Dealership Portal › Leads)
        visitorId: visitorIdOf(req, b),
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    console.error(`[lead.php] backend unreachable for host "${host}" (dealer "${dealer}"):`, (e as Error).message);
    return Response.json({ ok: false, error: 'error', message: 'Please try again in a moment.' }, { status: 502 });
  }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status !== 400 && res.status !== 429) console.error(`[lead.php] inquiry NOT saved: backend ${res.status} for host "${host}" (dealer "${dealer}")`, j.message || '');
    const error = res.status === 429 ? 'too_many_requests' : res.status === 400 ? 'missing_fields' : 'error';
    return Response.json({ ok: false, error, message: j.message }, { status: res.status });
  }
  return Response.json({ ok: true, emailed: !!j.emailed });
}
