import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
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

  /**
   * Add New Custom Theme (multipart): "file" = the theme .zip, optional "preview" = thumbnail image, and fields
   * name, key, description, visibility ("public" | "private"), allowedTenantIds (comma-separated or repeated).
   * The ZIP is installed like any theme (both storefronts get the files); key / name / description override the
   * ZIP's theme.json, and a private theme is only shown to the chosen dealerships.
   */
  @Post('themes/custom')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'preview', maxCount: 1 },
      ],
      { storage: memoryStorage(), limits: { fileSize: 41 * 1024 * 1024, files: 2 } },
    ),
  )
  installCustom(
    @UploadedFiles() files: { file?: { buffer: Buffer; originalname: string }[]; preview?: { buffer: Buffer; originalname: string; mimetype: string; size: number }[] } | undefined,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    const zip = files?.file?.[0];
    if (!zip) throw new BadRequestException('No ZIP received. Choose the theme package (.zip) first.');
    return this.installer.installCustom(zip.buffer, zip.originalname, b, files?.preview?.[0], u);
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

  /** Delete a design (refused while a dealership uses it). */
  @Delete('themes/:id')
  remove(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.installer.removeTheme(id, u);
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
