import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import type { VehicleQuery } from './vehicles.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

@Controller('dealer/vehicles')
@Perms('inventory')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@TenantId() t: string, @Query() q: VehicleQuery) {
    return this.vehicles.list(t, q);
  }

  @Get('field-rules')
  rules(@TenantId() t: string) {
    return this.vehicles.rules(t);
  }

  @Put('field-rules')
  saveRules(@TenantId() t: string, @Body() body: { rules?: Record<string, string>; skipDraft?: boolean }) {
    return this.vehicles.saveRules(t, body);
  }

  @Post('bulk')
  bulk(@TenantId() t: string, @Body() body: { ids?: string[]; action?: string }, @CurrentUser() u: AuthUser) {
    return this.vehicles.bulk(t, body, u);
  }

  @Post('import')
  import(@TenantId() t: string, @Body() body: { rows?: Record<string, unknown>[]; mode?: 'publish' | 'draft' }, @CurrentUser() u: AuthUser) {
    return this.vehicles.import(t, body, u);
  }

  @Get(':id')
  get(@TenantId() t: string, @Param('id') id: string) {
    return this.vehicles.get(t, id);
  }

  @Post()
  create(@TenantId() t: string, @Body() body: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.vehicles.create(t, body, u);
  }

  @Patch(':id')
  update(@TenantId() t: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.vehicles.update(t, id, body, u);
  }

  @Delete(':id')
  remove(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.vehicles.remove(t, id, u);
  }
}
