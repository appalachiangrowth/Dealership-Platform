import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DesignRequestsService } from './design-requests.service.js';
import { CurrentUser, Perms, PlatformOnly, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Dealer Portal › Design & colours › "Request extra page or section" (permission "design"). */
@Controller('dealer/design-requests')
@Perms('design')
export class DealerDesignRequestsController {
  constructor(private readonly requests: DesignRequestsService) {}

  /** this dealership's requests (status + team reply), support contact, contact details to pre-fill */
  @Get()
  list(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.requests.listForDealer(t, u);
  }

  /** { requestType, title, targetPage?, description, referenceUrl?, contactPreference, contactEmail?, contactPhone? } */
  @Post()
  create(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.requests.create(t, b, u);
  }
}

/** Platform Admin › Design requests (platform owners only). */
@Controller('platform/design-requests')
@PlatformOnly()
export class PlatformDesignRequestsController {
  constructor(private readonly requests: DesignRequestsService) {}

  /** ?status=&requestType=&dealerId=&q=&page=&pageSize= — plus counts per status and the NEW count */
  @Get()
  list(@Query() q: { status?: string; requestType?: string; dealerId?: string; q?: string; page?: string; pageSize?: string }) {
    return this.requests.listForPlatform(q);
  }

  /** { new } — sidebar badge */
  @Get('count')
  count() {
    return this.requests.newCount();
  }

  /** { status?, adminNotes? } */
  @Patch(':id')
  update(@Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.requests.update(id, b, u);
  }
}
