import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { VehiclePhotoEnhancerService } from '../media/photo-enhancer.service.js';
import { downloadPublicImage } from '../media/safe-download.js';
import type { AuthUser } from '../common/auth.types.js';

/**
 * Auto White Studio Background for IMPORTED photo links (CSV / TSV / XML import).
 * The import itself finishes at once with the links from the file. Afterwards, in the background, every web link is
 * downloaded, the vehicle is put on a white studio background and the link on the vehicle is swapped for the new photo
 * (same place in the photo order). A photo that cannot be downloaded or enhanced keeps its original link — nothing is
 * lost and no vehicle is changed in any other way. The portal shows the progress (GET /dealer/vehicles/photo-jobs).
 * Jobs live in memory: a server restart stops a running job (the vehicles keep the links not done yet).
 */

export type PhotoJob = {
  state: 'running' | 'done';
  total: number;
  done: number;
  enhanced: number;
  kept: number;
  failed: number;
  vehicles: number;
  startedAt: string;
  finishedAt: string | null;
  notes: { url: string; reason: string }[];
};

type Item = { vehicleId: string; urls: string[] };

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
   * Queue the imported photo links. Returns the job (or why nothing was started).
   * onFinished runs once when the job is done and at least one photo was swapped (CarGurus feed refresh).
   */
  async start(tenantId: string, items: Item[], user: AuthUser, onFinished: () => Promise<unknown>): Promise<{ job: PhotoJob | null; note: string }> {
    const list = items
      .map((i) => ({ vehicleId: i.vehicleId, urls: [...new Set(i.urls.filter((u) => PhotoJobsService.external(u, tenantId)))] }))
      .filter((i) => i.urls.length);
    if (!list.length) return { job: null, note: 'no photo links to enhance' };
    const st = await this.enhancer.status();
    if (!st.available) return { job: null, note: `Auto White Studio Background is not available: ${st.reason}` };

    const running = this.jobs.get(tenantId);
    const photos = list.reduce((n, i) => n + i.urls.length, 0);
    if (running?.state === 'running') {
      // a second import while one is running: add to it
      if (running.total + photos > MAX_PHOTOS_PER_JOB) return { job: running, note: `too many photos at once (the limit is ${MAX_PHOTOS_PER_JOB})` };
      running.total += photos;
      running.vehicles += list.length;
      this.pending.get(tenantId)!.push(...list);
      return { job: running, note: '' };
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
    }
    const job: PhotoJob = { state: 'running', total, done: 0, enhanced: 0, kept: 0, failed: 0, vehicles: take.length, startedAt: new Date().toISOString(), finishedAt: null, notes: [] };
    this.jobs.set(tenantId, job);
    this.pending.set(tenantId, [...take]);
    void this.run(tenantId, job, user, onFinished);
    return { job, note: total < photos ? `only the first ${total} photos are enhanced (limit ${MAX_PHOTOS_PER_JOB} per import)` : '' };
  }

  private async run(tenantId: string, job: PhotoJob, user: AuthUser, onFinished: () => Promise<unknown>) {
    const queue = this.pending.get(tenantId)!;
    let swapped = 0;
    try {
      while (queue.length) {
        const item = queue.shift()!;
        const swap = new Map<string, string>();
        for (const url of item.urls) {
          try {
            const buf = await downloadPublicImage(url);
            const r = await this.enhancer.enhance(buf, { priority: 'low' });
            if (r.enhanced) {
              const name = (url.split(/[?#]/)[0].split('/').pop() || 'photo').slice(0, 150);
              const m = await this.media.save(tenantId, { buffer: r.buffer, originalname: name, size: r.buffer.length }, user);
              swap.set(url, m.url);
              job.enhanced++;
            } else {
              job.kept++;
              this.note(job, url, r.reason);
            }
          } catch (e) {
            job.failed++;
            this.note(job, url, (e as Error).message || 'failed');
          } finally {
            job.done++;
          }
        }
        if (swap.size) swapped += await this.swapImages(tenantId, item.vehicleId, swap);
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
      this.log.log(`tenant ${tenantId}: ${job.enhanced} enhanced, ${job.kept} kept, ${job.failed} failed of ${job.total}`);
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
