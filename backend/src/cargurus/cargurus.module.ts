import { Module } from '@nestjs/common';
import { CargurusService } from './cargurus.service.js';
import { ApiCargurusController, DealerFeedsController, PlatformCargurusController } from './cargurus.controller.js';

@Module({ controllers: [ApiCargurusController, DealerFeedsController, PlatformCargurusController], providers: [CargurusService], exports: [CargurusService] })
export class CargurusModule {}
