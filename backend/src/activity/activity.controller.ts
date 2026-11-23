import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ActivityService, type TrackInput } from './activity.service.js';
import { ClientIp, Perms, PlatformOnly, Public, TenantId } from '../common/decorators.js';

/** first value of a header that may be URL-encoded (Vercel) */
const hv = (v?: string) => {
  const s = String(v || '').split(',')[0].trim();
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Storefront tracker (frontend app/api/track → here). The dealership comes from the website host (?host= /
 * X-Site-Host, like every /public endpoint) or the dealer slug in the body; unknown sites are ignored.
 * City / region only come from headers a proxy already added (Cloudflare, Vercel, Nginx GeoIP2) — nothing is looked up.
 */
@Controller('public')
@Public()
export class ActivityPublicController {
  constructor(private readonly activity: ActivityService) {}

  @Post('track')
  @HttpCode(202)
  track(
    @Query('host') host: string,
    @Headers() h: Record<string, string | undefined>,
    @Body() b: TrackInput,
    @ClientIp() ip: string,
  ) {
    return this.activity.track(b || {}, {
      host: host || h['x-site-host'] || '',
      ip,
      userAgent: h['x-visitor-user-agent'] || h['user-agent'] || '',
      city: hv(h['x-visitor-city'] || h['cf-ipcity'] || h['x-vercel-ip-city'] || h['x-geoip-city']),
      region: hv(h['x-visitor-region'] || h['cf-region'] || h['x-vercel-ip-country-region'] || h['x-geoip-region']),
    });
  }
}

/** Dealership Portal: a lead's website journey (only the dealership's own leads). */
@Controller('dealer/leads')
@Perms('leads')
export class ActivityDealerController {
  constructor(private readonly activity: ActivityService) {}

  @Get(':id/activity')
  leadActivity(@TenantId() t: string, @Param('id') id: string) {
    return this.activity.leadActivity(t, id);
  }
}

/** Platform Admin › Visitor Intelligence (platform owners only). */
@Controller('platform/visitors')
@PlatformOnly()
export class ActivityPlatformController {
  constructor(private readonly activity: ActivityService) {}

  @Get('overview')
  overview(@Query() q: { tenantId?: string; days?: string; eventType?: string }) {
    return this.activity.overview(q);
  }

  @Get('feed')
  feed(@Query() q: { tenantId?: string; eventType?: string; linked?: string; page?: string; pageSize?: string }) {
    return this.activity.feed(q);
  }
}
