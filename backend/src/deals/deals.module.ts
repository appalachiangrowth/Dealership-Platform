import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller.js';
import { StateFormsController } from './state-forms.controller.js';
import { DealsService } from './deals.service.js';
import { VehiclesModule } from '../vehicles/vehicles.module.js';

/** Deals / Bill of Sale: sale records, license scan, Bill of Sale, odometer statement, Buyers Guide, VA VSA 17A */
@Module({ imports: [VehiclesModule], controllers: [DealsController, StateFormsController], providers: [DealsService] })
export class DealsModule {}
