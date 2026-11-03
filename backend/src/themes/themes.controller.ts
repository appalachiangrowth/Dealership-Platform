import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ThemeInstallerService } from './theme-installer.service.js';
import { ThemesService } from './themes.service.js';
import { CurrentUser, PlatformOnly } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Platform Admin › Themes & releases, pricing and unlock requests */
@Controller('platform')
@PlatformOnly()
export class ThemesController {
  constructor(
    private readonly themes: ThemesService,
    private readonly installer: ThemeInstallerService,
  ) {}

  /** Install a design package (multipart "file", .zip). Installed as a new version; nothing is activated. */
  @Post('themes/install')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 41 * 1024 * 1024 } }))
  install(@UploadedFile() file: { buffer: Buffer; originalname: string } | undefined, @CurrentUser() u: AuthUser) {
    if (!file) throw new BadRequestException('No ZIP received. Choose a theme ZIP file first.');
    return this.installer.install(file.buffer, file.originalname, u);
  }

  /** Switch one dealership's design (pinned to a version). */
  @Post('themes/activate-tenant')
  activateTenant(@Body() b: { tenantId?: string; themeId?: string; version?: string }, @CurrentUser() u: AuthUser) {
    return this.installer.activateForTenant(b, u);
  }

  /** Restore that dealership's previous design. */
  @Post('themes/rollback-tenant')
  rollbackTenant(@Body() b: { tenantId?: string }, @CurrentUser() u: AuthUser) {
    return this.installer.rollbackTenant(b, u);
  }

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
