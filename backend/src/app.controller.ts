import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators.js';

@Controller()
export class AppController {
  @Public()
  @Get()
  root() {
    return { name: 'Dealer Platform API', version: '4.0.0', ok: true };
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true, time: new Date().toISOString() };
  }
}
