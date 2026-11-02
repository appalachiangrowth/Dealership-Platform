import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions.js';
import type { AuthUser, AuthedRequest } from './auth.types.js';

export const IS_PUBLIC = 'isPublic';
export const PERMS = 'perms';
export const PLATFORM_ONLY = 'platformOnly';
export const ANY_USER = 'anyUser';

/** No login needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Dealership endpoint: needs ANY of the listed permissions in the current dealership. */
export const Perms = (...perms: Permission[]) => SetMetadata(PERMS, perms);

/** Platform Admin only (platform owners). */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);

/** Any logged-in user (owner or dealer), no dealership needed. */
export const AnyUser = () => SetMetadata(ANY_USER, true);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.auth!;
});

/** The dealership the request works on (resolved and checked by AuthGuard). */
export const TenantId = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.tenantId!;
});

export const ClientIp = createParamDecorator((_d: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest & { socket?: { remoteAddress?: string } }>();
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd;
  return (first?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '').slice(0, 64);
});
