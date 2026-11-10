import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../tenants/tenants.service.js';
import { clean, isEmail } from '../common/util.js';
import { cleanPerms, DealerRoleId, permsFor, ROLES } from '../common/permissions.js';
import type { DealerRole, DealerUser } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth.types.js';
import { forgetAuthCache } from '../common/auth.guard.js';

export function publicUser(u: DealerUser) {
  const { passwordHash: _p, ...rest } = u;
  return { ...rest, effectivePerms: permsFor(u.role as DealerRoleId, u.perms) };
}

@Injectable()
export class TeamService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(tenantId: string) {
    const users = await this.prisma.dealerUser.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    return { users: users.map(publicUser), roles: ROLES };
  }

  async create(tenantId: string, b: Record<string, unknown>, me: AuthUser, source: 'DEALER' | 'PLATFORM' = 'DEALER') {
    const login = clean(b.login || b.email, 120).toLowerCase();
    if (!/^[a-z0-9._@+-]{3,120}$/.test(login)) throw new BadRequestException('Login: 3-120 characters (letters, digits, . _ @ + -)');
    if (String(b.password || '').length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const role = String(b.role || 'STAFF').toUpperCase() as DealerRole;
    if (!(role in ROLES)) throw new BadRequestException('Unknown role');
    if (await this.prisma.dealerUser.findUnique({ where: { tenantId_login: { tenantId, login } } })) throw new ConflictException('That login already exists');
    const email = clean(b.email, 160).toLowerCase();
    const allowUsers = role === 'ADMIN';
    const perms = cleanPerms(b.perms !== undefined ? b.perms : ROLES[role as DealerRoleId]?.perms, allowUsers);
    const u = await this.prisma.dealerUser.create({
      data: {
        tenantId,
        login,
        name: clean(b.name, 120),
        email: isEmail(email) ? email : isEmail(login) ? login : '',
        phone: clean(b.phone, 40),
        role,
        perms,
        passwordHash: await hashPassword(String(b.password)),
        source,
      },
    });
    await this.audit.record('user.create', { tenantId, actor: me.login, detail: { login, role } });
    return publicUser(u);
  }

  private async activeAdmins(tenantId: string, exceptId?: string) {
    return this.prisma.dealerUser.count({ where: { tenantId, role: 'ADMIN', disabled: false, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  }

  async update(tenantId: string, id: string, b: Record<string, unknown>, me: AuthUser) {
    const u = await this.prisma.dealerUser.findFirst({ where: { id, tenantId } });
    if (!u) throw new NotFoundException('User not found');
    const self = me.kind === 'dealer' && me.id === id;
    const data: Record<string, unknown> = {};
    if ('name' in b) data.name = clean(b.name, 120);
    if ('email' in b) {
      const e = clean(b.email, 160).toLowerCase();
      if (e && !isEmail(e)) throw new BadRequestException('Invalid email');
      data.email = e;
    }
    if ('phone' in b) data.phone = clean(b.phone, 40);
    if ('role' in b || 'perms' in b) {
      if (self) throw new ForbiddenException('You cannot change your own role or permissions');
      const role = String(b.role || u.role).toUpperCase() as DealerRole;
      if (!(role in ROLES)) throw new BadRequestException('Unknown role');
      data.role = role;
      const allowUsers = role === 'ADMIN';
      const permsList = 'perms' in b ? (Array.isArray(b.perms) ? b.perms : []) : (u.perms.length > 0 ? u.perms : ROLES[role as DealerRoleId]?.perms || []);
      data.perms = cleanPerms(permsList, allowUsers);
    }
    if ('disabled' in b) {
      if (self) throw new ForbiddenException('You cannot disable your own login');
      data.disabled = !!b.disabled;
    }
    if (b.password) {
      if (String(b.password).length < 8) throw new BadRequestException('Password must be at least 8 characters');
      data.passwordHash = await hashPassword(String(b.password));
    }
    const losingAdmin = u.role === 'ADMIN' && !u.disabled && ((data.role && data.role !== 'ADMIN') || data.disabled === true);
    if (losingAdmin && (await this.activeAdmins(tenantId, id)) === 0) {
      throw new BadRequestException('At least one active Dealership admin must remain');
    }
    const out = await this.prisma.dealerUser.update({ where: { id }, data });
    forgetAuthCache(); // a new role / a disabled login applies at once
    await this.audit.record('user.update', { tenantId, actor: me.login, detail: { login: u.login, fields: Object.keys(data).filter((k) => k !== 'passwordHash').concat(b.password ? ['password'] : []) } });
    return publicUser(out);
  }

  async remove(tenantId: string, id: string, me: AuthUser) {
    const u = await this.prisma.dealerUser.findFirst({ where: { id, tenantId } });
    if (!u) throw new NotFoundException('User not found');
    if (me.kind === 'dealer' && me.id === id) throw new ForbiddenException('You cannot delete your own login');
    if (u.role === 'ADMIN' && !u.disabled && (await this.activeAdmins(tenantId, id)) === 0) {
      throw new BadRequestException('At least one active Dealership admin must remain');
    }
    await this.prisma.dealerUser.delete({ where: { id } });
    forgetAuthCache();
    await this.audit.record('user.delete', { tenantId, actor: me.login, detail: { login: u.login } });
    return { ok: true };
  }
}
