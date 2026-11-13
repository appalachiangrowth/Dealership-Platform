import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { VehiclePhotoEnhancerService } from './photo-enhancer.service.js';

@Module({ controllers: [MediaController], providers: [MediaService, VehiclePhotoEnhancerService], exports: [MediaService, VehiclePhotoEnhancerService] })
export class MediaModule {}
