import { Module } from '@nestjs/common';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';
import { CargurusModule } from '../cargurus/cargurus.module.js';

@Module({ imports: [CargurusModule], controllers: [VehiclesController], providers: [VehiclesService], exports: [VehiclesService] })
export class VehiclesModule {}
