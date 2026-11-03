import { Body, Controller, Get, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { BrandingService } from './branding.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Dealership Portal › Website content › Photo branding (old api/brand.php). */
@Controller('dealer/branding')
@Perms('content', 'settings', 'inventory')
export class BrandingController {
  constructor(private readonly brand: BrandingService) {}

  /** settings, bands, Business details used by the automatic bands, photos still to update, failed links */
  @Get()
  view(@TenantId() t: string) {
    return this.brand.view(t);
  }

  /** { enabled?, color? } */
  @Put()
  update(@TenantId() t: string, @Body() b: { enabled?: boolean; color?: string }, @CurrentUser() u: AuthUser) {
    return this.brand.update(t, b, u);
  }

  /** { which: header|footer, url: "/uploads/…png" | "" (= automatic band) } */
  @Put('band')
  band(@TenantId() t: string, @Body() b: { which?: string; url?: string }, @CurrentUser() u: AuthUser) {
    return this.brand.setBand(t, b, u);
  }

  /** the next photos to brand (a few at a time, like the old "apply" action) */
  @Get('jobs')
  jobs(@TenantId() t: string, @Query('max') max?: string) {
    return this.brand.jobs(t, Number(max) || 4);
  }

  @Post('done')
  done(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.brand.done(t, b as never, u);
  }

  @Post('failed')
  failed(@TenantId() t: string, @Body() b: { url?: string; reason?: string }) {
    return this.brand.fail(t, b);
  }

  @Post('retry-failed')
  retry(@TenantId() t: string) {
    return this.brand.retry(t);
  }

  /** the photo / logo / band bytes for drawing in the browser */
  @Get('source')
  async source(@TenantId() t: string, @Query('url') url: string) {
    const { data, mime } = await this.brand.source(t, String(url || ''));
    return new StreamableFile(data, { type: mime, disposition: 'inline' });
  }
}
