import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';
import { PhotoJobsService } from './photo-jobs.service.js';
import { CargurusModule } from '../cargurus/cargurus.module.js';
import { MediaModule } from '../media/media.module.js';

@Module({ imports: [CargurusModule, MediaModule], controllers: [VehiclesController], providers: [VehiclesService, PhotoJobsService], exports: [VehiclesService] })
export class VehiclesModule {}
