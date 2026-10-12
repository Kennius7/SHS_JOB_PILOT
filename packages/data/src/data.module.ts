import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { TransitionsService } from './services/transitions.service';
import { ApplicationsService } from './services/applications.service';
import { AiService } from './services/ai.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService, TransitionsService, ApplicationsService, AiService],
  exports: [PrismaService, TransitionsService, ApplicationsService, AiService],
})
export class DataModule {}
