import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ThemesService } from './themes.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Dealership Portal › Design & colours */
@Controller('dealer/design')
@Perms('design')
export class DesignController {
  constructor(private readonly themes: ThemesService) {}

  @Get()
  view(@TenantId() t: string) {
    return this.themes.dealerView(t);
  }

  @Post('activate')
  activate(@TenantId() t: string, @Body() b: { themeId: string }, @CurrentUser() u: AuthUser) {
    return this.themes.activate(t, b.themeId, u);
  }

  @Put('colors')
  colors(@TenantId() t: string, @Body() b: { colors?: Record<string, string>; themeId?: string }, @CurrentUser() u: AuthUser) {
    return this.themes.saveColors(t, b, u);
  }

  /** Ask the platform to unlock a paid design. */
  @Post('request')
  request(@TenantId() t: string, @Body() b: { themeId?: string; note?: string }, @CurrentUser() u: AuthUser) {
    return this.themes.request(t, b, u);
  }
}
