import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DataModule } from '@shs/data';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { RulesModule } from './modules/rules/rules.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AdminModule } from './modules/admin/admin.module';
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
    BullModule.registerQueue(
      { name: 'match-recent' },
      { name: 'prepare-application' },
      { name: 'application-submission' },
      { name: 'application-verification' },
    ),
    DataModule,
    AuthModule,
    ProfileModule,
    DocumentsModule,
    RulesModule,
    ApplicationsModule,
    ...(isProd ? [] : [AdminModule]),
  ],
  controllers: [HealthController],
})
export class AppModule {}
