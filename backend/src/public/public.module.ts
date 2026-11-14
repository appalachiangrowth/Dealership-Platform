import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { LeadsModule } from '../leads/leads.module.js';
import { CargurusModule } from '../cargurus/cargurus.module.js';

@Module({ imports: [LeadsModule, CargurusModule], controllers: [PublicController], providers: [PublicService], exports: [PublicService] })
export class PublicModule {}
