import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require('mammoth');

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  async extract(
    absolutePath: string,
    mimeType: string,
  ): Promise<{ text: string; needsOcr: boolean }> {
    const buffer = await fs.readFile(absolutePath);

    if (mimeType === 'application/pdf') {
      try {
        const result = await pdfParse(buffer);
        const text = (result.text ?? '').trim();
        return { text, needsOcr: text.length < 50 };
      } catch (e) {
        this.logger.warn(`PDF parse failed: ${(e as Error).message}`);
        return { text: '', needsOcr: true };
      }
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { text: (result.value ?? '').trim(), needsOcr: false };
    }

    throw new Error(`Unsupported MIME type for extraction: ${mimeType}`);
  }
}
