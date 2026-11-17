import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { VehiclePhotoEnhancerService } from './photo-enhancer.service.js';
import { MediaLibraryController } from './media-library.controller.js';
import { MediaLibraryService } from './media-library.service.js';

@Module({
  controllers: [MediaController, MediaLibraryController],
  providers: [MediaService, VehiclePhotoEnhancerService, MediaLibraryService],
  exports: [MediaService, VehiclePhotoEnhancerService],
})
export class MediaModule {}
