import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { VehiclePhotoEnhancerService } from '../media/photo-enhancer.service.js';
import type { AuthUser } from '../common/auth.types.js';

/**
 * WEB PHOTO LINKS → the dealer's own .jpeg photos (CSV / TSV / XML import, pasted links, vehicles saved with links).
 * The import (or save) itself finishes at once with the links. Afterwards, in the background, every web link is
 * downloaded and saved as a .jpeg (any format: WebP, PNG, AVIF, HEIC, extension-less CDN links …), optionally with
 * the Auto White Studio Background, and the link on the vehicle is swapped for the new photo (same place in the
 * photo order) — so CarGurus and Facebook Marketplace always get .jpeg links on this server.
 * A link that cannot be downloaded or read keeps its original link (a warning is logged) and the rest go on.
 * The portal shows the progress (GET /dealer/vehicles/photo-jobs).
 * Jobs live in memory: a server restart stops a running job (the vehicles keep the links not done yet; they are
 * picked up again the next time the vehicle is saved or imported).
 */

export type PhotoJob = {
  state: 'running' | 'done';
  total: number;
  done: number;
  /** saved as .jpeg on this server (enhanced ones included) */
  converted: number;
  /** of those, put on the white studio background */
  enhanced: number;
  /** white background asked for but the photo was kept as it is (interior, close-up …) — still converted */
  kept: number;
  /** could not be downloaded / read: the original link stays */
  failed: number;
  vehicles: number;
  startedAt: string;
  finishedAt: string | null;
  notes: { url: string; reason: string }[];
};

type Item = { vehicleId: string; urls: string[]; enhance: boolean };

const MAX_PHOTOS_PER_JOB = 3000;

@Injectable()
export class PhotoJobsService {
  private readonly log = new Logger('PhotoJobs');
  private readonly jobs = new Map<string, PhotoJob>();
  private readonly pending = new Map<string, Item[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly enhancer: VehiclePhotoEnhancerService,
  ) {}

  status(tenantId: string): PhotoJob | null {
    return this.jobs.get(tenantId) ?? null;
  }

  /** A web link this server should download (not one of the dealer's own uploads). */
  static external(url: string, tenantId: string): boolean {
    return /^https?:\/\//i.test(url) && !url.includes(`/uploads/${tenantId}/`);
  }

  /**
   * Queue web photo links. opts.enhance = also the white studio background (when installed on the server).
   * onFinished runs once when the job is done and at least one photo was swapped (CarGurus feed refresh).
   */
  async start(
    tenantId: string,
    items: { vehicleId: string; urls: string[] }[],
    user: AuthUser,
    opts: { enhance?: boolean },
    onFinished: () => Promise<unknown>,
  ): Promise<{ job: PhotoJob | null; note: string }> {
    let note = '';
    let enhance = !!opts.enhance;
    if (enhance) {
      const st = await this.enhancer.status();
      if (!st.available) {
        enhance = false;
        note = `Auto White Studio Background is not available (${st.reason}); the photos are only converted to JPEG`;
      }
    }
    const list: Item[] = items
      .map((i) => ({ vehicleId: i.vehicleId, urls: [...new Set(i.urls.filter((u) => PhotoJobsService.external(u, tenantId)))], enhance }))
      .filter((i) => i.urls.length);
    const current = this.jobs.get(tenantId);
    if (!list.length) return { job: current?.state === 'running' ? current : null, note: '' };

    const photos = list.reduce((n, i) => n + i.urls.length, 0);
    if (current?.state === 'running') {
      // another import / save while one is running: add to it
      if (current.total + photos > MAX_PHOTOS_PER_JOB) return { job: current, note: `too many photos at once (the limit is ${MAX_PHOTOS_PER_JOB}); the other links stay as they are` };
      current.total += photos;
      current.vehicles += list.length;
      this.pending.get(tenantId)!.push(...list);
      return { job: current, note };
    }
    let take = list;
    let total = photos;
    if (photos > MAX_PHOTOS_PER_JOB) {
      take = [];
      total = 0;
      for (const i of list) {
        if (total + i.urls.length > MAX_PHOTOS_PER_JOB) break;
        take.push(i);
        total += i.urls.length;
      }
      note = [note, `only the first ${total} photos are converted now (limit ${MAX_PHOTOS_PER_JOB}); save or import again for the rest`].filter(Boolean).join(' · ');
    }
    const job: PhotoJob = {
      state: 'running',
      total,
      done: 0,
      converted: 0,
      enhanced: 0,
      kept: 0,
      failed: 0,
      vehicles: take.length,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      notes: [],
    };
    this.jobs.set(tenantId, job);
    const queue = [...take];
    this.pending.set(tenantId, queue);
    void this.run(tenantId, job, queue, user, onFinished);
    return { job, note };
  }

  private async run(tenantId: string, job: PhotoJob, queue: Item[], user: AuthUser, onFinished: () => Promise<unknown>) {
    let swapped = 0;
    try {
      while (queue.length) {
        const item = queue.shift()!;
        const swap = new Map<string, string>();
        for (const url of item.urls) {
          try {
            const m = (await this.media.saveFromUrl(tenantId, url, user, { enhance: item.enhance, priority: 'low' })) as { url: string; enhanced?: boolean; enhanceNote?: string };
            swap.set(url, m.url);
            job.converted++;
            if (m.enhanced) job.enhanced++;
            else if (item.enhance) {
              job.kept++;
              this.note(job, url, `converted to JPEG, white background not applied: ${m.enhanceNote || 'kept as it is'}`);
            }
          } catch (e) {
            job.failed++;
            const reason = (e as Error).message || 'failed';
            this.log.warn(`tenant ${tenantId}: photo link kept as it is (${reason}): ${url.slice(0, 200)}`);
            this.note(job, url, reason);
          } finally {
            job.done++;
          }
        }
        if (swap.size)
          swapped += await this.swapImages(tenantId, item.vehicleId, swap).catch((e: Error) => {
            this.log.warn(`could not update vehicle ${item.vehicleId}: ${e.message}`);
            return 0;
          });
      }
      // finished before the feed refresh below, so an import started meanwhile begins a new job instead of joining this one
      job.state = 'done';
      if (this.pending.get(tenantId) === queue) this.pending.delete(tenantId);
      if (swapped) await onFinished().catch((e: Error) => this.log.warn(`feed refresh after photo job: ${e.message}`));
    } catch (e) {
      this.log.error(`photo job stopped: ${(e as Error).message}`);
    } finally {
      job.state = 'done';
      job.finishedAt = new Date().toISOString();
      if (this.pending.get(tenantId) === queue) this.pending.delete(tenantId);
      this.log.log(`tenant ${tenantId}: ${job.converted} converted to JPEG (${job.enhanced} white background), ${job.failed} kept as links, of ${job.total}`);
    }
  }

  /** Swap the links on the vehicle as it is NOW (the dealer may have edited it meanwhile); same photo order. */
  private async swapImages(tenantId: string, vehicleId: string, swap: Map<string, string>): Promise<number> {
    const v = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId }, select: { id: true, images: true } });
    if (!v) return 0;
    let n = 0;
    const images = v.images.map((u: string) => {
      const to = swap.get(u);
      if (to) n++;
      return to ?? u;
    });
    if (n) await this.prisma.vehicle.update({ where: { id: v.id }, data: { images } });
    return n;
  }

  private note(job: PhotoJob, url: string, reason: string) {
    if (job.notes.length < 20) job.notes.push({ url: url.slice(0, 300), reason: reason.slice(0, 200) });
  }
}
