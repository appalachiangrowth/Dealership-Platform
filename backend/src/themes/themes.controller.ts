import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ThemesService } from './themes.service.js';
import { CurrentUser, PlatformOnly } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Platform Admin › Themes & releases, pricing and unlock requests */
@Controller('platform')
@PlatformOnly()
export class ThemesController {
  constructor(private readonly themes: ThemesService) {}

  @Get('themes')
  list() {
    return this.themes.platformList();
  }

  @Patch('themes/:id')
  update(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.themes.platformUpdate(id, b, u);
  }

  @Post('themes/:id/versions')
  addVersion(@Param('id') id: string, @Body() b: { version?: string; notes?: string }, @CurrentUser() u: AuthUser) {
    return this.themes.addVersion(id, b, u);
  }

  @Get('theme-requests')
  requests(@Query('status') status?: string) {
    return this.themes.listRequests(status);
  }

  @Post('theme-requests/:id/approve')
  approve(@Param('id') id: string, @Body() b: { amount?: unknown; note?: string }, @CurrentUser() u: AuthUser) {
    return this.themes.reviewRequest(id, 'approve', b, u);
  }

  @Post('theme-requests/:id/decline')
  decline(@Param('id') id: string, @Body() b: { note?: string }, @CurrentUser() u: AuthUser) {
    return this.themes.reviewRequest(id, 'decline', b, u);
  }

  @Post('tenants/:tenantId/licenses/:themeId')
  grant(@Param('tenantId') t: string, @Param('themeId') th: string, @CurrentUser() u: AuthUser) {
    return this.themes.grant(t, th, u);
  }

  @Delete('tenants/:tenantId/licenses/:themeId')
  revoke(@Param('tenantId') t: string, @Param('themeId') th: string, @CurrentUser() u: AuthUser) {
    return this.themes.revoke(t, th, u);
  }
}
