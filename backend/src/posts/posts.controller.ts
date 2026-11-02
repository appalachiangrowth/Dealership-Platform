import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PostsService } from './posts.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

@Controller('dealer/posts')
@Perms('blog')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list(@TenantId() t: string, @Query('status') status?: string) {
    return this.posts.list(t, status);
  }

  @Get(':id')
  get(@TenantId() t: string, @Param('id') id: string) {
    return this.posts.get(t, id);
  }

  @Post()
  create(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.posts.create(t, b, u);
  }

  @Patch(':id')
  update(@TenantId() t: string, @Param('id') id: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.posts.update(t, id, b, u);
  }

  @Delete(':id')
  remove(@TenantId() t: string, @Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.posts.remove(t, id, u);
  }
}
