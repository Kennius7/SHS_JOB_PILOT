import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminTestController } from './admin.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'match-recent' })],
  controllers: [AdminTestController],
})
export class AdminModule {}
