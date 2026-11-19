/**
 * POST api/lead.php — the theme forms (vehicle request + contact) post here, exactly as before.
 * Saved for the dealer first, then e-mailed (backend /public/leads).
 */
import { backend, hostOf } from '@/lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b._honey) return Response.json({ ok: true }); // bots fill the hidden field: pretend success
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const res = await backend('/public/leads', hostOf(req), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(fwd ? { 'X-Forwarded-For': fwd } : {}) },
    body: JSON.stringify({
      name: b.name ?? '',
      email: b.email ?? '',
      phone: b.phone ?? '',
      topic: b.topic ?? 'Website inquiry',
      message: b.message ?? '',
      page: b.page ?? '',
      vehicleId: b.vehicleId ?? '',
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = res.status === 429 ? 'too_many_requests' : res.status === 400 ? 'missing_fields' : 'error';
    return Response.json({ ok: false, error, message: j.message }, { status: res.status });
  }
  return Response.json({ ok: true, emailed: !!j.emailed });
}
