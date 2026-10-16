import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService, AiService } from '@shs/data';
import { StorageService } from './storage.service';
import { ExtractionService } from './extraction.service';
import { DocumentKind } from '@prisma/client';
import { createHash } from 'crypto';

@Injectable()
export class DocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private extraction: ExtractionService,
    private ai: AiService,
  ) {}

  async upload(userId: string, file: Express.Multer.File) {
    await this.storage.ensureReady();
    this.storage.validate(file);

    const { storageKey, sha256, absolutePath } = await this.storage.store(
      file.buffer,
      userId,
      file.originalname,
    );

    const existing = await this.prisma.document.findFirst({
      where: { userId, sha256, deletedAt: null },
    });
    if (existing) {
      await this.storage.delete(storageKey);
      return existing;
    }

    const doc = await this.prisma.document.create({
      data: {
        userId,
        kind: 'CV' as DocumentKind,
        originalName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        fileHash: createHash('sha256').update(storageKey).digest('hex'),
        extractionStatus: 'PENDING',
      },
    });

    if (file.size < 5 * 1024 * 1024) {
      await this.extractInline(doc.id, absolutePath, file.mimetype);
    }

    return this.prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
  }

  private async extractInline(documentId: string, absolutePath: string, mimeType: string) {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { extractionStatus: 'PROCESSING' },
    });
    try {
      const { text, needsOcr } = await this.extraction.extract(absolutePath, mimeType);
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractedText: text,
          extractionStatus: needsOcr ? 'NEEDS_OCR' : 'SUCCESS',
          extractedAt: new Date(),
        },
      });
    } catch (e) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          extractionStatus: 'FAILED',
          extractionError: (e as Error).message,
        },
      });
    }
  }

  async list(userId: string) {
    return this.prisma.document.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        extractionStatus: true,
        createdAt: true,
        parsedData: true,
      },
    });
  }

  async getForDownload(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException('Document not found');
    if (doc.userId !== userId) throw new ForbiddenException();
    const buffer = await this.storage.read(doc.storageKey);
    return { buffer, filename: doc.originalName, mimeType: doc.mimeType };
  }

  async parseCv(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException();
    if (doc.userId !== userId) throw new ForbiddenException();

    if (doc.extractionStatus === 'NEEDS_OCR') {
      throw new BadRequestException(
        'This CV appears to be a scanned image. Please paste the text manually or upload a text-based PDF.',
      );
    }
    if (doc.extractionStatus !== 'SUCCESS' || !doc.extractedText) {
      throw new BadRequestException('CV text has not been extracted yet');
    }

    const parsed = await this.ai.parseCv(userId, doc.extractedText);
    await this.prisma.document.update({
      where: { id: documentId },
      data: { parsedData: parsed as any },
    });
    return { documentId, parsed };
  }

  async softDelete(userId: string, documentId: string) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.deletedAt) throw new NotFoundException();
    if (doc.userId !== userId) throw new ForbiddenException();
    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  }
}
