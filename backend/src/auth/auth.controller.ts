import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { AnyUser, ClientIp, CurrentUser, Public } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';
import { ChangePasswordDto, LoginDto, SetupDto, SignupDto } from './auth.dto.js';

@Controller(['auth', 'dealer/auth'])
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /auth/login or /dealer/auth/login { login, password, portal: 'dealer' | 'platform', tenantId? } */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @ClientIp() ip: string) {
    return this.auth.login(dto, ip);
  }

  @AnyUser()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @AnyUser()
  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user, dto);
  }

  /** DELETE /auth/account or /dealer/auth/account - self-serve account deletion/deactivation */
  @AnyUser()
  @Delete('account')
  @HttpCode(200)
  deleteAccount(@CurrentUser() user: AuthUser) {
    return this.auth.deleteAccount(user);
  }

  @Public()
  @Get('setup-status')
  setupStatus() {
    return this.auth.setupStatus();
  }

  /** Creates the first platform owner (only while none exists). */
  @Public()
  @Post('setup')
  setup(@Body() dto: SetupDto, @ClientIp() ip: string) {
    return this.auth.setup(dto, ip);
  }

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto, @ClientIp() ip: string) {
    return this.auth.signup(dto, ip);
  }
}
