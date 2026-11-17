import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Alternative text / title saved in Platform Admin › SEO & URLs › Images, per picture address:
 * { "/uploads/<dealer>/…/abc.jpeg": { a: "alt text", t: "title" } } — only pictures that have one.
 * The dealer website puts them on every <img> of that picture that has no alt text of its own
 * (frontend lib/site-extras.ts). Kept 60 s per dealership; a save in the media library clears it.
 */
export type MediaMeta = Record<string, { a?: string; t?: string }>;

const cache = new Map<string, { at: number; map: MediaMeta }>();
const TTL = 60_000;

export function invalidateMediaMeta(tenantId: string) {
  cache.delete(tenantId);
}

export async function mediaMetaFor(prisma: PrismaService, tenantId: string): Promise<MediaMeta> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL) return hit.map;
  const map: MediaMeta = {};
  try {
    const rows = await prisma.mediaFile.findMany({
      where: { tenantId, OR: [{ altText: { not: '' } }, { title: { not: '' } }] },
      select: { url: true, altText: true, title: true },
      take: 5000,
    });
    for (const r of rows) {
      const e: { a?: string; t?: string } = {};
      if (r.altText) e.a = r.altText;
      if (r.title) e.t = r.title;
      map[r.url] = e;
    }
  } catch {
    /* columns missing until `prisma db push`: no alt texts, the website keeps working */
  }
  if (cache.size > 2000) cache.clear();
  cache.set(tenantId, { at: Date.now(), map });
  return map;
}
