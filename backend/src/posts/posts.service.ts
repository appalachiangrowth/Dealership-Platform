import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { clean, cleanMl, slugify, strArray } from '../common/util.js';
import type { PostStatus, Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';

function cleanPost(b: Record<string, unknown>): Prisma.BlogPostUncheckedUpdateInput {
  const d: Record<string, unknown> = {};
  if ('title' in b) d.title = clean(b.title, 200);
  if ('excerpt' in b) d.excerpt = cleanMl(b.excerpt, 600);
  if ('body' in b) d.body = cleanMl(b.body, 60000);
  if ('coverImage' in b) {
    const c = clean(b.coverImage, 600);
    d.coverImage = c.startsWith('/uploads/') || /^https?:\/\//.test(c) ? c : '';
  }
  if ('category' in b) d.category = clean(b.category, 80);
  if ('tags' in b) d.tags = strArray(b.tags, 20, 40);
  if ('author' in b) d.author = clean(b.author, 80);
  if ('metaTitle' in b) d.metaTitle = clean(b.metaTitle, 200);
  if ('metaDescription' in b) d.metaDescription = clean(b.metaDescription, 320);
  if ('status' in b) {
    const s = String(b.status).toUpperCase();
    if (s !== 'PUBLISHED' && s !== 'DRAFT') throw new BadRequestException('Unknown status');
    d.status = s as PostStatus;
  }
  if ('publishedAt' in b && b.publishedAt) {
    const t = new Date(String(b.publishedAt));
    if (!isNaN(t.getTime())) d.publishedAt = t;
  }
  return d as Prisma.BlogPostUncheckedUpdateInput;
}

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list(tenantId: string, status?: string) {
    const s = (status || '').toUpperCase();
    return this.prisma.blogPost.findMany({
      where: { tenantId, ...(s === 'PUBLISHED' || s === 'DRAFT' ? { status: s as PostStatus } : {}) },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async get(tenantId: string, id: string) {
    const p = await this.prisma.blogPost.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Post not found');
    return p;
  }

  private async uniqueSlug(tenantId: string, base: string, exceptId?: string) {
    const root = slugify(base, 80);
    let slug = root;
    for (let i = 2; ; i++) {
      const hit = await this.prisma.blogPost.findFirst({ where: { tenantId, slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
      if (!hit) return slug;
      slug = `${root}-${i}`;
    }
  }

  async create(tenantId: string, b: Record<string, unknown>, user: AuthUser) {
    const d = cleanPost(b) as Record<string, unknown>;
    if (!d.title) throw new BadRequestException('A title is required');
    if (d.status === 'PUBLISHED' && !d.publishedAt) d.publishedAt = new Date();
    if (!d.author) d.author = user.name;
    const slug = await this.uniqueSlug(tenantId, String(b.slug || d.title));
    const p = await this.prisma.blogPost.create({ data: { ...(d as Prisma.BlogPostUncheckedCreateInput), tenantId, slug } });
    await this.audit.record('post.create', { tenantId, actor: user.login, detail: { id: p.id, title: p.title } });
    return p;
  }

  async update(tenantId: string, id: string, b: Record<string, unknown>, user: AuthUser) {
    const cur = await this.get(tenantId, id);
    const d = cleanPost(b) as Record<string, unknown>;
    if (d.status === 'PUBLISHED' && !cur.publishedAt && !d.publishedAt) d.publishedAt = new Date();
    if (b.slug) d.slug = await this.uniqueSlug(tenantId, String(b.slug), id);
    const p = await this.prisma.blogPost.update({ where: { id }, data: d });
    await this.audit.record('post.update', { tenantId, actor: user.login, detail: { id, title: p.title } });
    return p;
  }

  async remove(tenantId: string, id: string, user: AuthUser) {
    const p = await this.get(tenantId, id);
    await this.prisma.blogPost.delete({ where: { id } });
    await this.audit.record('post.delete', { tenantId, actor: user.login, detail: { id, title: p.title } });
    return { ok: true };
  }
}
