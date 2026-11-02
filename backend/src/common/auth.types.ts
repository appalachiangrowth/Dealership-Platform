import type { Permission } from './permissions.js';

export interface TokenPayload {
  sub: string;
  kind: 'owner' | 'dealer';
  tenantId?: string;
}

/** Who is calling (attached to the request by AuthGuard). */
export interface AuthUser {
  kind: 'owner' | 'dealer';
  id: string;
  login: string;
  name: string;
  email: string;
  role: string; // OWNER or a DealerRole
  perms: Permission[];
  /** dealer: own dealership. owner: the dealership chosen with the X-Tenant-Id header (support mode) */
  tenantId?: string;
  support?: boolean;
}

export interface AuthedRequest {
  auth?: AuthUser;
  tenantId?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}
