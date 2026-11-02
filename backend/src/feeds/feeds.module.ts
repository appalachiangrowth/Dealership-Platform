import { Global, Module } from '@nestjs/common';
import { FeedsService } from './feeds.service.js';

@Global()
@Module({ providers: [FeedsService], exports: [FeedsService] })
export class FeedsModule {}
