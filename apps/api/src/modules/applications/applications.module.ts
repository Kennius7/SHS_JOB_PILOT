import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ApplicationsController } from './applications.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'application-submission' })],
  controllers: [ApplicationsController],
})
export class ApplicationsModule {}
