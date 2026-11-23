import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { ActivityModule } from '../activity/activity.module.js';

@Module({ imports: [ActivityModule], controllers: [LeadsController], providers: [LeadsService], exports: [LeadsService] })
export class LeadsModule {}
