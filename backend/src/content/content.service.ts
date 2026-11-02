import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CONTENT_FIELDS, CONTENT_SCHEMA } from './content.schema.js';
import { siteTokens, substitute, withPlaceholders } from './site-tokens.js';
import { cleanMl, clean } from '../common/util.js';
import type { AuthUser } from '../common/auth.types.js';

const KEEP_VERSIONS = 40;

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
  ) {}

  async values(tenantId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.contentValue.findMany({ where: { tenantId } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** Pages > sections > fields with saved values, for the Website content editor. */
  async editor(tenantId: string) {
    const values = await this.values(tenantId);
    const t = await this.tenants.get(tenantId);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    return {
      themeId: t.themeId,
      tokens: siteTokens(s, t.name),
      pages: CONTENT_SCHEMA.map((p) => ({
        ...p,
        sections: p.sections.map((sec) => ({
          ...sec,
          fields: sec.fields.map((f) => {
            const saved = f.key in values && (values[f.key] !== '' || f.type === 'para');
            return { ...f, saved, value: saved ? values[f.key] : f.default };
          }),
        })),
      })),
    };
  }

  /** Save changed texts. A snapshot of the previous values is kept (last 40) for "earlier versions". */
  async save(tenantId: string, body: { values?: Record<string, unknown>; reset?: string[] }, user: AuthUser) {
    const before = await this.values(tenantId);
    const ops = [];
    for (const [k, v] of Object.entries(body.values || {})) {
      const f = CONTENT_FIELDS[k];
      if (!f) continue;
      const value = f.type === 'para' || f.type === 'head' ? cleanMl(v, 4000) : clean(v, f.type === 'img' ? 600 : 400);
      ops.push(
        this.prisma.contentValue.upsert({
          where: { tenantId_key: { tenantId, key: k } },
          create: { tenantId, key: k, value },
          update: { value },
        }),
      );
    }
    const reset = (body.reset || []).filter((k) => CONTENT_FIELDS[k]);
    if (reset.length) ops.push(this.prisma.contentValue.deleteMany({ where: { tenantId, key: { in: reset } } }));
    if (!ops.length) return this.editor(tenantId);

    await this.prisma.$transaction([this.prisma.contentVersion.create({ data: { tenantId, values: before, savedBy: user.login } }), ...ops]);
    const old = await this.prisma.contentVersion.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, skip: KEEP_VERSIONS, select: { id: true } });
    if (old.length) await this.prisma.contentVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    await this.audit.record('content.save', { tenantId, actor: user.login, detail: { keys: Object.keys(body.values || {}).length, reset: reset.length } });
    await this.tenants.setOnboarding(tenantId, 'content_edited');
    return this.editor(tenantId);
  }

  async history(tenantId: string) {
    const rows = await this.prisma.contentVersion.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: KEEP_VERSIONS });
    return rows.map((r) => ({ id: r.id, savedBy: r.savedBy, createdAt: r.createdAt, count: Object.keys((r.values as object) || {}).length }));
  }

  async restore(tenantId: string, versionId: string, user: AuthUser) {
    const v = await this.prisma.contentVersion.findFirst({ where: { id: versionId, tenantId } });
    if (!v) throw new NotFoundException('Version not found');
    const values = (v.values || {}) as Record<string, string>;
    const current = await this.values(tenantId);
    const reset = Object.keys(current).filter((k) => !(k in values));
    return this.save(tenantId, { values, reset }, user);
  }

  /**
   * Final texts for the public website: saved value or default, with {tokens} filled in from Business details
   * (empty details show visible placeholders like "Add phone number").
   */
  async resolved(tenantId: string, s: Parameters<typeof siteTokens>[0], fallbackName: string) {
    const values = await this.values(tenantId);
    const tokens = withPlaceholders(siteTokens(s, fallbackName));
    const out: Record<string, string> = {};
    for (const [k, f] of Object.entries(CONTENT_FIELDS)) {
      const raw = k in values && (values[k] !== '' || f.type === 'para') ? values[k] : f.default;
      out[k] = substitute(raw, tokens);
    }
    return { content: out, tokens };
  }
}
