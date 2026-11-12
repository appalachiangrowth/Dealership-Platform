import { Body, Controller, Get, Post } from '@nestjs/common';
import { AiService } from './ai.service.js';
import { CurrentUser, Perms, TenantId } from '../common/decorators.js';
import type { AuthUser } from '../common/auth.types.js';

/** AI Quick Add (add a vehicle from photos or a walkaround video) and the "Just tell it" command bar. */
@Controller('dealer/ai')
@Perms('inventory')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  @Post('decode-vin')
  decodeVin(@Body() b: { vin?: string }) {
    return this.ai.run(() => this.ai.decodeVin(b?.vin));
  }

  @Post('analyze')
  analyze(@TenantId() t: string, @Body() b: Record<string, unknown>) {
    return this.ai.run(() => this.ai.analyze(t, b || {}));
  }

  @Post('analyze-video')
  analyzeVideo(@TenantId() t: string, @Body() b: Record<string, unknown>) {
    return this.ai.run(() => this.ai.analyzeVideo(t, b || {}));
  }

  @Post('read-closeups')
  readCloseups(@TenantId() t: string, @Body() b: Record<string, unknown>) {
    return this.ai.run(() => this.ai.readCloseups(t, b || {}));
  }

  @Post('write-description')
  writeDescription(@TenantId() t: string, @Body() b: Record<string, unknown>) {
    return this.ai.run(() => this.ai.writeDescription(t, b || {}));
  }

  @Post('transcribe')
  transcribe(@TenantId() t: string, @Body() b: Record<string, unknown>) {
    return this.ai.run(() => this.ai.transcribe(t, b || {}));
  }

  /**
   * "Just tell it": understands the request and does it — vehicles, inquiries, Business details, feeds, Facebook.
   * Open to anyone with one of these permissions; every action checks its own permission (ai.actions.ts) and is
   * scoped to the dealership of the request. Simple changes run straight away (with Undo); deleting or changing many
   * things at once returns a plan to confirm.
   */
  @Post('command')
  @Perms('inventory', 'leads', 'business', 'settings')
  command(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.ai.run(() => this.ai.command(t, b || {}, u));
  }

  /** { planId } from command (or { actions } from older portals) */
  @Post('command/apply')
  @Perms('inventory', 'leads', 'business', 'settings')
  apply(@TenantId() t: string, @Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.ai.run(() => this.ai.apply(t, b || {}, u));
  }

  @Post('command/undo')
  @Perms('inventory', 'leads', 'business', 'settings')
  undo(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.ai.run(() => this.ai.undo(t, u));
  }
}
