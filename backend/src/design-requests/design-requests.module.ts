import { Module } from '@nestjs/common';
import { DealerDesignRequestsController, PlatformDesignRequestsController } from './design-requests.controller.js';
import { DesignRequestsService } from './design-requests.service.js';

/** Extra page / extra section / design change requests from dealerships to the platform team. */
@Module({ controllers: [DealerDesignRequestsController, PlatformDesignRequestsController], providers: [DesignRequestsService] })
export class DesignRequestsModule {}
