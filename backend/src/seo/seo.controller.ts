import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { SeoService } from './seo.service.js';
import { PublicService } from '../public/public.service.js';
import { CurrentUser, PlatformOnly, Public } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/**
 * Platform Admin › SEO & URLs (platform owners only). Served on /platform/seo/* like the rest of Platform Admin,
 * and on /admin/seo/* as well.
 */
@Controller(['platform/seo', 'admin/seo'])
@PlatformOnly()
export class SeoAdminController {
  constructor(private readonly seo: SeoService) {}

  /** dealership address, every page's URL + meta, vehicle template, vehicles (?q= &page= &pageSize=), redirects */
  @Get(':dealerId')
  get(@Param('dealerId') dealerId: string, @Query() q: { q?: string; page?: string; pageSize?: string }) {
    return this.seo.adminGet(dealerId, q);
  }

  /** { pages: [{ key, path, metaTitle, metaDescription, ogTitle, ogDescription, ogImage, canonicalUrl }] } */
  @Put(':dealerId/pages')
  pages(@Param('dealerId') dealerId: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.seo.savePages(dealerId, b, u);
  }

  /** { inventoryBase, titleTemplate, descriptionTemplate, regenerate? } — also gives missing vehicles their slug */
  @Put(':dealerId/vehicle-template')
  template(@Param('dealerId') dealerId: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.seo.saveVehicleTemplate(dealerId, b, u);
  }

  /** rebuilds every slug that was not typed by hand (old addresses 301 to the new ones) */
  @Post(':dealerId/vehicles/regenerate')
  regenerate(@Param('dealerId') dealerId: string, @CurrentUser() u: AuthUser) {
    return this.seo.regenerate(dealerId, u);
  }

  /** { slug?, metaTitle?, metaDescription? } — slug "" = automatic clean slug again */
  @Patch(':dealerId/vehicles/:vehicleId')
  vehicle(@Param('dealerId') dealerId: string, @Param('vehicleId') vehicleId: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.seo.patchVehicle(dealerId, vehicleId, b, u);
  }
}

/** The dealer websites ask how to answer an address (?host=dealer-domain, like the other /public endpoints). */
@Controller('public/seo')
@Public()
export class SeoPublicController {
  constructor(
    private readonly seo: SeoService,
    private readonly pub: PublicService,
  ) {}

  /** ?host=…&path=/used-cars&id=<vehicle.html ?id> → page | vehicle | redirect | none, plus the link map */
  @Get('resolve')
  async resolve(@Query('host') host: string, @Headers('x-site-host') h: string, @Query('path') path: string, @Query('id') id?: string) {
    const t = await this.pub.tenantFor(host || h || '');
    return this.seo.resolve(t.id, path || '', id);
  }

  /** link map + every clean address (website link rewriting, sitemap.xml) */
  @Get('links')
  async links(@Query('host') host: string, @Headers('x-site-host') h: string) {
    const t = await this.pub.tenantFor(host || h || '');
    return this.seo.linksFor(t.id);
  }
}
