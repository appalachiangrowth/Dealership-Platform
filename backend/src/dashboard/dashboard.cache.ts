/**
 * Dealership Portal › Overview numbers, kept in memory for a short time per dealership.
 * The overview is opened (and re-opened) a lot; without a cache every visit runs a dozen queries against a database
 * that may be far away. Changes made through the portal clear the dealership's entry at once
 * (DashboardInvalidator); changes from elsewhere (website inquiries, feed imports) show within TTL_MS.
 */
const TTL_MS = 20_000;
const MAX_ENTRIES = 2000;

type Entry = { data: unknown; expiresAt: number };
const cache = new Map<string, Entry>();
/** one computation per dealership at a time: concurrent requests share it */
const pending = new Map<string, Promise<unknown>>();
/** bumped on every invalidation, so a computation that started before a change is not stored afterwards */
const version = new Map<string, number>();

export function invalidateDashboard(tenantId: string | undefined) {
  if (!tenantId) return;
  cache.delete(tenantId);
  version.set(tenantId, (version.get(tenantId) || 0) + 1);
}

export async function cachedDashboard<T>(tenantId: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return hit.data as T;
  const running = pending.get(tenantId);
  if (running) return running as Promise<T>;
  const v = version.get(tenantId) || 0;
  const p = compute()
    .then((data) => {
      if ((version.get(tenantId) || 0) === v) {
        if (cache.size >= MAX_ENTRIES) cache.clear();
        cache.set(tenantId, { data, expiresAt: Date.now() + TTL_MS });
      }
      return data;
    })
    .finally(() => pending.delete(tenantId));
  pending.set(tenantId, p);
  return p;
}
