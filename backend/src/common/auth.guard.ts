import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import { ANY_USER, IS_PUBLIC, PERMS, PLATFORM_ONLY } from './decorators.js';
import { ALL_PERMISSIONS, Permission, permsFor, DealerRoleId } from './permissions.js';
import type { AuthUser, AuthedRequest } from './auth.types.js';
import { verifyToken } from './jwt.js';

/**
 * One global guard for the whole API.
 *  - @Public()        → no login
 *  - @PlatformOnly()  → platform owner
 *  - @Perms(...)      → dealership endpoint; dealer users work on their own dealership,
 *                       platform owners pick one with the X-Tenant-Id header ("support mode").
 *  - @AnyUser()       → any login
 * Endpoints without any of these default to platform-only, so nothing is accidentally open.
 */
/** token → user, dealership id → status: kept for a few seconds so most requests need no database trip at all */
const USER_TTL = 20_000;
const userCache = new Map<string, { at: number; user: AuthUser | null; tenantStatus?: string }>();
const tenantCache = new Map<string, { at: number; status: string | null }>();
function fresh<T extends { at: number }>(m: Map<string, T>, k: string, ttl: number): T | undefined {
  const v = m.get(k);
  if (v && Date.now() - v.at < ttl) return v;
  if (v) m.delete(k);
  return undefined;
}
// keep the caches small
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of userCache) if (now - v.at > USER_TTL) userCache.delete(k);
  for (const [k, v] of tenantCache) if (now - v.at > USER_TTL) tenantCache.delete(k);
}, 60_000).unref();
/** call when a login is disabled / a dealership suspended, to apply it at once (otherwise within 20 s) */
export function forgetAuthCache() {
  userCache.clear();
  tenantCache.clear();
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.meta<boolean>(IS_PUBLIC, ctx);

    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    const token = raw?.startsWith('Bearer ') ? raw.slice(7) : '';
    if (token) req.auth = (await this.loadUser(token)) ?? undefined;

    if (isPublic) return true;
    if (!req.auth) throw new UnauthorizedException('Please log in');

    const perms = this.meta<Permission[]>(PERMS, ctx);
    const platformOnly = this.meta<boolean>(PLATFORM_ONLY, ctx);
    const anyUser = this.meta<boolean>(ANY_USER, ctx);

    if (anyUser && !perms) return true;

    if (perms) {
      const tenantId = await this.resolveTenant(req);
      req.tenantId = tenantId;
      req.auth.tenantId = tenantId;
      if (perms.length && !perms.some((p) => req.auth!.perms.includes(p))) {
        throw new ForbiddenException('You do not have permission for this');
      }
      return true;
    }

    if (platformOnly || !anyUser) {
      if (req.auth.kind !== 'owner') throw new ForbiddenException('Platform Admin only');
      return true;
    }
    return true;
  }

  private async tenantStatus(id: string): Promise<string | null> {
    const hit = fresh(tenantCache, id, USER_TTL);
    if (hit) return hit.status;
    const t = await this.prisma.tenant.findUnique({ where: { id }, select: { status: true } });
    tenantCache.set(id, { at: Date.now(), status: t ? t.status : null });
    return t ? t.status : null;
  }

  private async resolveTenant(req: AuthedRequest): Promise<string> {
    const auth = req.auth!;
    if (auth.kind === 'dealer') {
      const status = await this.tenantStatus(auth.tenantId!);
      if (!status) throw new UnauthorizedException('Dealership not found');
      if (status === 'SUSPENDED') throw new ForbiddenException('This dealership is suspended. Please contact support.');
      return auth.tenantId!;
    }
    const h = req.headers['x-tenant-id'];
    const id = (Array.isArray(h) ? h[0] : h || '').trim();
    if (!id) throw new ForbiddenException('Choose a dealership first (X-Tenant-Id header)');
    if (!(await this.tenantStatus(id))) throw new ForbiddenException('Dealership not found');
    auth.support = true;
    return id;
  }

  private async loadUser(token: string): Promise<AuthUser | null> {
    const p = verifyToken(token);
    if (!p) return null;
    const hit = fresh(userCache, token, USER_TTL);
    // a copy: the request adds tenantId / support to it
    if (hit) return hit.user ? { ...hit.user, perms: [...hit.user.perms] } : null;
    const user = await this.lookupUser(p);
    userCache.set(token, { at: Date.now(), user });
    return user ? { ...user, perms: [...user.perms] } : null;
  }

  private async lookupUser(p: NonNullable<ReturnType<typeof verifyToken>>): Promise<AuthUser | null> {
    if (p.kind === 'owner') {
      const o = await this.prisma.platformOwner.findUnique({ where: { id: p.sub } });
      if (!o || o.disabled) return null;
      return { kind: 'owner', id: o.id, login: o.login, name: o.name, email: o.email, role: 'OWNER', perms: [...ALL_PERMISSIONS] };
    }
    // the user and the dealership status in ONE database trip
    const u = await this.prisma.dealerUser.findUnique({ where: { id: p.sub }, include: { tenant: { select: { status: true } } } });
    if (!u || u.disabled || u.tenantId !== p.tenantId) return null;
    if (u.tenant) tenantCache.set(u.tenantId, { at: Date.now(), status: u.tenant.status });
    return {
      kind: 'dealer',
      id: u.id,
      login: u.login,
      name: u.name,
      email: u.email,
      role: u.role,
      perms: permsFor(u.role as DealerRoleId, u.perms),
      tenantId: u.tenantId,
    };
  }
}
