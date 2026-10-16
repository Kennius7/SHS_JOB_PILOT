import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DataModule } from '@shs/data';
import { ProvidersModule } from './providers/providers.module';
import { ProviderSyncProcessor } from './processors/provider-sync.processor';
import { MatchRecentProcessor } from './processors/match-recent.processor';
import { PrepareApplicationProcessor } from './processors/prepare-application.processor';
import { SubmissionProcessor } from './processors/submission.processor';
import { VerificationProcessor } from './processors/verification.processor';
import { SchedulerService } from './scheduler/scheduler.service';
import { QUEUES } from './queues';

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
      { name: QUEUES.providerSync },
      { name: QUEUES.matchRecent },
      { name: QUEUES.prepareApplication },
      { name: QUEUES.submission },
      { name: QUEUES.verification },
    ),
    DataModule,
    ProvidersModule,
  ],
  providers: [
    ProviderSyncProcessor,
    MatchRecentProcessor,
    PrepareApplicationProcessor,
    SubmissionProcessor,
    VerificationProcessor,
    SchedulerService,
  ],
})
export class WorkerModule {}
