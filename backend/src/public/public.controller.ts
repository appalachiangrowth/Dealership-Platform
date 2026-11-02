import { Body, Controller, ForbiddenException, Get, Header, Headers, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { PublicService } from './public.service.js';
import type { PublicVehicleQuery } from './public.service.js';
import { LeadsService } from '../leads/leads.service.js';
import type { PublicLeadInput } from '../leads/leads.service.js';
import { FeedsService } from '../feeds/feeds.service.js';
import { CargurusService } from '../cargurus/cargurus.service.js';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientIp, Public } from '../common/decorators.js';

/**
 * Endpoints the public dealer websites (frontend) call. The dealership is chosen by the website's host name:
 * ?host=bluemotors.com  (or the X-Site-Host header).
 */
@Controller('public')
@Public()
export class PublicController {
  constructor(
    private readonly pub: PublicService,
    private readonly leads: LeadsService,
    private readonly feeds: FeedsService,
    private readonly cargurus: CargurusService,
    private readonly platform: PlatformSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  private host(q?: string, h?: string) {
    return q || h || '';
  }

  @Get('site')
  site(@Query('host') host: string, @Headers('x-site-host') h: string, @Query('theme') theme?: string) {
    return this.pub.site(this.host(host, h), theme);
  }

  @Get('vehicles')
  vehicles(@Query() q: PublicVehicleQuery & { host?: string }, @Headers('x-site-host') h: string) {
    return this.pub.vehicles(this.host(q.host, h), q);
  }

  @Get('vehicles/:slug')
  vehicle(@Param('slug') slug: string, @Query('host') host: string, @Headers('x-site-host') h: string) {
    return this.pub.vehicle(this.host(host, h), slug);
  }

  @Get('posts')
  posts(@Query('host') host: string, @Headers('x-site-host') h: string, @Query('page') page?: string) {
    return this.pub.posts(this.host(host, h), Math.max(1, parseInt(page || '1', 10) || 1));
  }

  @Get('posts/:slug')
  post(@Param('slug') slug: string, @Query('host') host: string, @Headers('x-site-host') h: string) {
    return this.pub.post(this.host(host, h), slug);
  }

  /** Template-engine context for the original theme files (frontend). */
  @Get('theme-context')
  themeContext(@Query('host') host: string, @Headers('x-site-host') h: string, @Query('theme') theme?: string) {
    return this.pub.themeContext(this.host(host, h), theme);
  }

  /** /inventory.json in the original format. */
  @Get('inventory.json')
  inventoryJson(@Query('host') host: string, @Headers('x-site-host') h: string) {
    return this.pub.inventoryJson(this.host(host, h));
  }

  @Get('sitemap')
  sitemap(@Query('host') host: string, @Headers('x-site-host') h: string) {
    return this.pub.sitemap(this.host(host, h));
  }

  /** Inquiry from the contact form / vehicle request form. */
  @Post('leads')
  async lead(@Query('host') host: string, @Headers('x-site-host') h: string, @Body() b: PublicLeadInput, @ClientIp() ip: string) {
    const t = await this.pub.tenantFor(this.host(host, h));
    return this.leads.submit(t.id, b, ip);
  }

  @Get('feeds/inventory.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  async xml(@Query('host') host: string, @Headers('x-site-host') h: string) {
    if (!(await this.platform.get('feeds', 'inventoryXml', true))) throw new NotFoundException();
    const t = await this.pub.tenantFor(this.host(host, h));
    return (await this.feeds.xml(t.id)).xml;
  }

  /** Private CSV link for CarGurus: only the approved live feed, only with the dealer's feed key. */
  @Get('feeds/cargurus.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async cgCsv(@Query('host') host: string, @Headers('x-site-host') h: string, @Query('key') key: string) {
    const t = await this.pub.tenantFor(this.host(host, h));
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId: t.id }, select: { feedToken: true } });
    if (!s?.feedToken || !key || key !== s.feedToken) throw new ForbiddenException('Private feed');
    const csv = await this.cargurus.liveFeed(t.id);
    if (!csv) throw new NotFoundException('No approved CarGurus feed yet');
    return csv;
  }
}
