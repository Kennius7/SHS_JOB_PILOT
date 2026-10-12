import { Module } from '@nestjs/common';
import { AdminTestController } from './admin.controller';

@Module({
  controllers: [AdminTestController],
})
export class AdminModule {}
