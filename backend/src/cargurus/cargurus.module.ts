import { Module } from '@nestjs/common';
import { CargurusService } from './cargurus.service.js';
import { DealerFeedsController, PlatformCargurusController } from './cargurus.controller.js';

@Module({ controllers: [DealerFeedsController, PlatformCargurusController], providers: [CargurusService], exports: [CargurusService] })
export class CargurusModule {}
