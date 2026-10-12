import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';
import { ExtractionService } from './extraction.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, StorageService, ExtractionService],
  exports: [DocumentsService, StorageService],
})
export class DocumentsModule {}
