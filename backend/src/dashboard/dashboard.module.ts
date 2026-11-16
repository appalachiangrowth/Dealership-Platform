import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DashboardController } from './dashboard.controller.js';
import { DashboardInvalidator } from './dashboard.invalidator.js';

@Module({ controllers: [DashboardController], providers: [{ provide: APP_INTERCEPTOR, useClass: DashboardInvalidator }] })
export class DashboardModule {}
