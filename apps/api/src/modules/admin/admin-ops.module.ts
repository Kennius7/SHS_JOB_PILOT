import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { DbExplorerService } from './db-explorer.service';
import { RedisExplorerService } from './redis-explorer.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'provider-sync' },
      { name: 'match-recent' },
      { name: 'prepare-application' },
      { name: 'application-submission' },
      { name: 'application-verification' },
    ),
  ],
  controllers: [AdminOpsController],
  providers: [AdminOpsService, DbExplorerService, RedisExplorerService],
})
export class AdminOpsModule {}
