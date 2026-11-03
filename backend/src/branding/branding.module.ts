import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';
import { BrandingService } from './branding.service.js';
import { CargurusModule } from '../cargurus/cargurus.module.js';

@Module({ imports: [CargurusModule], controllers: [BrandingController], providers: [BrandingService], exports: [BrandingService] })
export class BrandingModule {}
