import { Module } from '@nestjs/common';
import { PublicPagesController, SitePagesController } from './site-pages.controller.js';
import { SitePagesService } from './site-pages.service.js';

/** Custom website pages built in Platform Admin › Pages & SEO, shown inside each dealership's theme. */
@Module({ controllers: [SitePagesController, PublicPagesController], providers: [SitePagesService], exports: [SitePagesService] })
export class SitePagesModule {}
