import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DataModule } from '@shs/data';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RulesModule } from './modules/rules/rules.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MatchesModule } from './modules/matches/matches.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';
import { AutomationModule } from './modules/automation/automation.module';
import { UsageModule } from './modules/usage/usage.module';
import { AdminModule } from './modules/admin/admin.module';
import { AdminOpsModule } from './modules/admin/admin-ops.module';
import { HealthController } from './health.controller';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        maxRetriesPerRequest: null,
      },
    }),
    DataModule,
    AuthModule,
    ProfileModule,
    DocumentsModule,
    RulesModule,
    ApplicationsModule,
    JobsModule,
    MatchesModule,
    NotificationsModule,
    UsersModule,
    AutomationModule,
    UsageModule,
    AdminOpsModule,
    ...(isProd ? [] : [AdminModule]),
  ],
  controllers: [HealthController],
})
export class AppModule {}
