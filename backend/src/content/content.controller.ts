import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ContentService } from './content.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

@Controller('dealer/content')
@Perms('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  editor(@TenantId() t: string) {
    return this.content.editor(t);
  }

  /** PUT /dealer/content { values: { "home.hero.title": "…" }, reset: ["home.hero.text"] } */
  @Put()
  save(@TenantId() t: string, @Body() b: { values?: Record<string, unknown>; reset?: string[] }, @CurrentUser() u: AuthUser) {
    return this.content.save(t, b, u);
  }

  @Get('history')
  history(@TenantId() t: string) {
    return this.content.history(t);
  }

  @Post('history/:id/restore')
  restore(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.content.restore(t, id, u);
  }
}
