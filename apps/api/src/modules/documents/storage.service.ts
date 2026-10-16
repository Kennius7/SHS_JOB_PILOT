import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly basePath: string;
  private readonly maxSizeBytes: number;

  constructor(config: ConfigService) {
    this.basePath = config.getOrThrow<string>('DOCUMENT_STORAGE_PATH');
    this.maxSizeBytes = Number(config.get('MAX_UPLOAD_SIZE_MB', 10)) * 1024 * 1024;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true, mode: 0o750 });
  }

  validate(file: Express.Multer.File): void {
    if (file.size > this.maxSizeBytes) {
      throw new BadRequestException(`File exceeds ${this.maxSizeBytes} bytes`);
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported MIME type: ${file.mimetype}`);
    }
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(`Unsupported extension: ${ext}`);
    }
  }

  async store(buffer: Buffer, userId: string, originalName: string) {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const ext = extname(originalName).toLowerCase();
    const storageKey = `${userId}/${randomUUID()}${ext}`;
    const absolutePath = join(this.basePath, storageKey);

    await fs.mkdir(join(this.basePath, userId), { recursive: true, mode: 0o750 });
    await fs.writeFile(absolutePath, buffer, { mode: 0o640 });

    return { storageKey, sha256, absolutePath };
  }

  async read(storageKey: string): Promise<Buffer> {
    const absolutePath = join(this.basePath, storageKey);
    if (!absolutePath.startsWith(this.basePath)) {
      throw new Error('Invalid storage key');
    }
    return fs.readFile(absolutePath);
  }

  async delete(storageKey: string): Promise<void> {
    const absolutePath = join(this.basePath, storageKey);
    if (!absolutePath.startsWith(this.basePath)) throw new Error('Invalid storage key');
    await fs.unlink(absolutePath).catch(() => {});
  }

  absolutePath(storageKey: string): string {
    const p = join(this.basePath, storageKey);
    if (!p.startsWith(this.basePath)) throw new Error('Invalid storage key');
    return p;
  }
}
