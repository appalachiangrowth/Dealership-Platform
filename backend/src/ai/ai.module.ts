import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';
import { CargurusModule } from '../cargurus/cargurus.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { FacebookModule } from '../facebook/facebook.module.js';

/** the command bar acts on vehicles, inquiries, settings, the CarGurus feed and Facebook Marketplace */
@Module({ imports: [VehiclesModule, CargurusModule, LeadsModule, FacebookModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
