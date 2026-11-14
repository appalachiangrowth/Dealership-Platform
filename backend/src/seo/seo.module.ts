import { Module } from '@nestjs/common';
import { SeoAdminController, SeoPublicController } from './seo.controller.js';
import { SeoService } from './seo.service.js';
import { PublicModule } from '../public/public.module.js';

/** Platform Admin › SEO & URLs: page addresses + meta, clean vehicle addresses, 301 redirects, website resolver. */
@Module({ imports: [PublicModule], controllers: [SeoAdminController, SeoPublicController], providers: [SeoService], exports: [SeoService] })
export class SeoModule {}
