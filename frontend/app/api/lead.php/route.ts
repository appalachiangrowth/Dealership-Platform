/**
 * POST api/lead.php — the theme forms (vehicle request + contact) post here, exactly as before.
 * Saved for the dealer first, then e-mailed (backend /public/leads).
 */
import { backend, hostOf } from '@/lib/backend';

/** the visitor id of the activity tracker (lib/activity-tracker.ts): sent with the form, or its pa_vid cookie */
function visitorIdOf(req: Request, b: Record<string, unknown>): string {
  const fromBody = String(b.visitorId ?? '').trim();
  if (/^[A-Za-z0-9_-]{8,80}$/.test(fromBody)) return fromBody;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)pa_vid=([A-Za-z0-9_-]{8,80})/);
  return m ? m[1] : '';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b._honey) return Response.json({ ok: true }); // bots fill the hidden field: pretend success
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const res = await backend('/public/leads', hostOf(req), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(fwd ? { 'X-Forwarded-For': fwd } : {}),
      'X-Visitor-User-Agent': (req.headers.get('user-agent') || '').slice(0, 400),
    },
    body: JSON.stringify({
      name: b.name ?? '',
      email: b.email ?? '',
      phone: b.phone ?? '',
      topic: b.topic ?? 'Website inquiry',
      message: b.message ?? '',
      page: b.page ?? '',
      vehicleId: b.vehicleId ?? '',
      // links the inquiry to the visitor's website journey (Dealership Portal › Leads)
      visitorId: visitorIdOf(req, b),
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = res.status === 429 ? 'too_many_requests' : res.status === 400 ? 'missing_fields' : 'error';
    return Response.json({ ok: false, error, message: j.message }, { status: res.status });
  }
  return Response.json({ ok: true, emailed: !!j.emailed });
}
