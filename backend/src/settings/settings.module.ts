import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { CargurusModule } from '../cargurus/cargurus.module.js';

@Module({ imports: [CargurusModule], controllers: [SettingsController] })
export class SettingsModule {}
