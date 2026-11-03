import { Module } from '@nestjs/common';
import { ThemesService } from './themes.service.js';
import { DesignController } from './design.controller.js';
import { ThemesController } from './themes.controller.js';
import { ThemeInstallerService } from './theme-installer.service.js';

@Module({ controllers: [DesignController, ThemesController], providers: [ThemesService, ThemeInstallerService], exports: [ThemesService, ThemeInstallerService] })
export class ThemesModule {}
