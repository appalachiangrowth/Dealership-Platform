import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { TenantsService, checkPassword, hashPassword } from '../tenants/tenants.service.js';
import { signToken } from '../common/jwt.js';
import { clean, rateLimit } from '../common/util.js';
import { PERMISSIONS, ROLES, CUSTOM_ALLOWED } from '../common/permissions.js';
import type { AuthUser } from '../common/auth.types.js';
import type { ChangePasswordDto, LoginDto, SetupDto, SignupDto } from './auth.dto.js';
import { forgetAuthCache } from '../common/auth.guard.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
    private readonly platform: PlatformSettingsService,
  ) {}

  private tooMany() {
    return new HttpException('Too many attempts. Please wait a few minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
  }

  async login(dto: LoginDto, ip: string) {
    const login = clean(dto.login, 160).toLowerCase();
    if (!rateLimit(`login|${ip}`, 20, 600) || !rateLimit(`login|${login}`, 10, 600)) throw this.tooMany();

    if (dto.portal === 'platform') {
      const o = await this.prisma.platformOwner.findUnique({ where: { login } });
      if (!o || o.disabled || !(await checkPassword(dto.password, o.passwordHash))) {
        await this.prisma.loginEvent.create({ data: { login, success: false, ip, ownerId: o?.id } });
        throw new UnauthorizedException('Wrong login or password');
      }
      await this.prisma.platformOwner.update({ where: { id: o.id }, data: { lastLoginAt: new Date() } });
      await this.prisma.loginEvent.create({ data: { login, success: true, ip, ownerId: o.id } });
      await this.audit.record('login', { actor: login, ip });
      return { token: signToken({ sub: o.id, kind: 'owner' }), kind: 'owner' as const };
    }

    const candidates = await this.prisma.dealerUser.findMany({
      where: { login, ...(dto.tenantId ? { tenantId: dto.tenantId } : {}) },
      include: { tenant: { select: { id: true, name: true, status: true } } },
    });
    const matches = [];
    for (const u of candidates) if (!u.disabled && (await checkPassword(dto.password, u.passwordHash))) matches.push(u);

    if (!matches.length) {
      for (const u of candidates) {
        await this.prisma.loginEvent.create({ data: { login, success: false, ip, tenantId: u.tenantId, userId: u.id } });
        await this.audit.record('login.failed', { tenantId: u.tenantId, actor: login, ip });
      }
      throw new UnauthorizedException('Wrong login or password');
    }
    if (matches.length > 1) {
      throw new ConflictException({
        message: 'This login belongs to several dealerships. Choose one.',
        dealerships: matches.map((m) => ({ id: m.tenant.id, name: m.tenant.name })),
      });
    }
    const u = matches[0];
    if (u.tenant.status === 'SUSPENDED') throw new ForbiddenException('This dealership is suspended. Please contact support.');
    await this.prisma.dealerUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
    await this.prisma.loginEvent.create({ data: { login, success: true, ip, tenantId: u.tenantId, userId: u.id } });
    await this.audit.record('login', { tenantId: u.tenantId, actor: login, ip });
    return { token: signToken({ sub: u.id, kind: 'dealer', tenantId: u.tenantId }), kind: 'dealer' as const, tenantId: u.tenantId };
  }

  /** Everything the admin app needs after login. */
  async me(user: AuthUser) {
    const support = await this.platform.all();
    const base = {
      user: { id: user.id, kind: user.kind, login: user.login, name: user.name, email: user.email, role: user.role, perms: user.perms },
      support: support.support,
      catalog: { permissions: PERMISSIONS, roles: ROLES, customAllowed: CUSTOM_ALLOWED },
    };
    if (user.kind === 'owner') return { ...base, tenant: null };
    const t = await this.tenants.get(user.tenantId!);
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: t.id }, select: { logo: true, name: true, siteUrl: true } });
    return {
      ...base,
      tenant: {
        id: t.id,
        name: s?.name || t.name,
        logo: s?.logo || '',
        dealerCode: t.dealerCode,
        status: t.status,
        domains: t.domains.map((d) => d.domain),
        siteUrl: s?.siteUrl || '',
        features: await this.tenants.features(t),
      },
    };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    if (user.kind === 'owner') {
      const o = await this.prisma.platformOwner.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await checkPassword(dto.current, o.passwordHash))) throw new BadRequestException('Your current password is not correct');
      await this.prisma.platformOwner.update({ where: { id: o.id }, data: { passwordHash: await hashPassword(dto.password) } });
    } else {
      const u = await this.prisma.dealerUser.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await checkPassword(dto.current, u.passwordHash))) throw new BadRequestException('Your current password is not correct');
      await this.prisma.dealerUser.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(dto.password) } });
    }
    forgetAuthCache();
    await this.audit.record('account.password', { tenantId: user.tenantId, actor: user.login });
    return { ok: true };
  }

  async setupStatus() {
    const owners = await this.prisma.platformOwner.count();
    const signup = (await this.platform.all()).signup;
    return { needsSetup: owners === 0, setupKeyRequired: !!process.env.SETUP_KEY, signup: { enabled: !!signup.enabled } };
  }

  /** First platform owner. Only works while there is no owner yet. */
  async setup(dto: SetupDto, ip: string) {
    if ((await this.prisma.platformOwner.count()) > 0) throw new ForbiddenException('Setup is already done');
    if (process.env.SETUP_KEY && dto.setupKey !== process.env.SETUP_KEY) throw new ForbiddenException('Wrong setup key');
    const login = clean(dto.login, 120).toLowerCase();
    const o = await this.prisma.platformOwner.create({
      data: { login, name: clean(dto.name, 120), email: login.includes('@') ? login : '', passwordHash: await hashPassword(dto.password) },
    });
    await this.audit.record('setup.owner', { actor: login, ip });
    return { token: signToken({ sub: o.id, kind: 'owner' }), kind: 'owner' as const };
  }

  /** "New dealer? Create your dealership account" */
  async signup(dto: SignupDto, ip: string) {
    if (dto.website) return { ok: true }; // honeypot
    const settings = (await this.platform.all()).signup as { enabled: boolean; baseDomain: string; theme: string };
    if (!settings.enabled) throw new ForbiddenException('New sign-ups are closed. Please contact us.');
    if (!rateLimit(`signup|${ip}`, 5, 3600)) throw this.tooMany();
    const email = clean(dto.email, 160).toLowerCase();
    if (await this.prisma.dealerUser.findFirst({ where: { login: email } })) {
      throw new ConflictException('An account with this email already exists. Please log in.');
    }
    const id = await this.tenants.uniqueId(dto.dealershipName);
    const domains = settings.baseDomain ? [`${id}.${settings.baseDomain}`] : [];
    const t = await this.tenants.create({
      id,
      name: dto.dealershipName,
      domains,
      themeId: settings.theme,
      notes: `Self sign-up on ${new Date().toISOString().slice(0, 10)} by ${email}`,
      admin: { login: email, password: dto.password, name: dto.name, email, phone: dto.phone, source: 'SIGNUP', signupIp: ip },
    });
    await this.audit.record('signup', { tenantId: t.id, actor: email, ip });
    const r = await this.login({ login: email, password: dto.password, portal: 'dealer', tenantId: t.id }, ip);
    return { ...r, websiteDomain: domains[0] || (process.env.SITES_DOMAIN ? `${id}.${process.env.SITES_DOMAIN}` : `${id}.localhost`) };
  }
}
