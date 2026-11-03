import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module.js';
import { MailModule } from './mail/mail.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { ContentModule } from './content/content.module.js';
import { FeedsModule } from './feeds/feeds.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { PostsModule } from './posts/posts.module.js';
import { LeadsModule } from './leads/leads.module.js';
import { ThemesModule } from './themes/themes.module.js';
import { TeamModule } from './team/team.module.js';
import { MediaModule } from './media/media.module.js';
import { CargurusModule } from './cargurus/cargurus.module.js';
import { PublicModule } from './public/public.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { AuthGuard } from './common/auth.guard.js';

@Module({
  imports: [
    // shared (global)
    PrismaModule,
    AuditModule,
    PlatformSettingsModule,
    MailModule,
    TenantsModule,
    ContentModule,
    FeedsModule,
    // features
    AuthModule,
    DashboardModule,
    SettingsModule,
    VehiclesModule,
    BrandingModule,
    PostsModule,
    LeadsModule,
    ThemesModule,
    TeamModule,
    MediaModule,
    CargurusModule,
    PublicModule,
    PlatformModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
