import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: an audit failure must not break the action itself. */
  async record(action: string, opts: { tenantId?: string | null; actor?: string; detail?: unknown; ip?: string } = {}) {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          tenantId: opts.tenantId ?? null,
          actor: opts.actor ?? '',
          ip: opts.ip ?? '',
          detail: (opts.detail ?? undefined) as never,
        },
      });
    } catch (e) {
      this.log.warn(`audit failed for ${action}: ${(e as Error).message}`);
    }
  }
}
