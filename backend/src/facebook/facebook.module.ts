import { Module } from '@nestjs/common';
import { FacebookController } from './facebook.controller.js';
import { FacebookService } from './facebook.service.js';
import { BrandingModule } from '../branding/branding.module.js';

/** FB Poster: Facebook groups / Pages posting + Marketplace vehicle listings (old fb-poster app). */
@Module({ imports: [BrandingModule], controllers: [FacebookController], providers: [FacebookService] })
export class FacebookModule {}
