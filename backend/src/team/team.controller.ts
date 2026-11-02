import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TeamService } from './team.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** Dealership Portal › Team & permissions (Dealership admins only) */
@Controller('dealer/team')
@Perms('users')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@TenantId() t: string) {
    return this.team.list(t);
  }

  @Post()
  create(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.team.create(t, b, u, u.kind === 'owner' ? 'PLATFORM' : 'DEALER');
  }

  @Patch(':id')
  update(@TenantId() t: string, @Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.team.update(t, id, b, u);
  }

  @Delete(':id')
  remove(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.team.remove(t, id, u);
  }
}
