import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';

@Module({ imports: [VehiclesModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
