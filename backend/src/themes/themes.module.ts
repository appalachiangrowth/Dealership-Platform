import { Module } from '@nestjs/common';
import { ThemesService } from './themes.service.js';
import { DesignController } from './design.controller.js';
import { ThemesController } from './themes.controller.js';

@Module({ controllers: [DesignController, ThemesController], providers: [ThemesService], exports: [ThemesService] })
export class ThemesModule {}
