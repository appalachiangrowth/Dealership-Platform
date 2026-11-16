import { Module } from '@nestjs/common';
import { SeoAdminController, SeoPublicController } from './seo.controller.js';
import { SeoService } from './seo.service.js';
import { SeoRedirectsService } from './seo-redirects.service.js';
import { PublicModule } from '../public/public.module.js';

/** Platform Admin › SEO & URLs: page addresses + meta, clean vehicle addresses, 301 redirects, URL Redirects (301/302/307/410), website resolver. */
@Module({ imports: [PublicModule], controllers: [SeoAdminController, SeoPublicController], providers: [SeoService, SeoRedirectsService], exports: [SeoService, SeoRedirectsService] })
export class SeoModule {}
