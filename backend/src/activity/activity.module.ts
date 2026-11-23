import { Module } from '@nestjs/common';
import { ActivityDealerController, ActivityPlatformController, ActivityPublicController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

/** Visitor activity tracking & lead intelligence (VisitorActivity table). */
@Module({
  controllers: [ActivityPublicController, ActivityDealerController, ActivityPlatformController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
