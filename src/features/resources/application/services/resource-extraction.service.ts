import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { LocalResourceStorageService } from '../../infrastructure/storage/local-resource-storage.service.js';

const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 300;

export type ResourceExtractionResult = {
  resourceVersionId: string;
  status: 'DONE' | 'FAILED';
  charactersExtracted: number;
  chunksCreated: number;
  summary: string | null;
  errorMessage: string | null;
};

export class ResourceExtractionService {
  constructor(private readonly storage = new LocalResourceStorageService()) {}

  async extractCurrentVersion(resourceId: string): Promise<ResourceExtractionResult | null> {
    const version = await prisma.resourceVersion.findFirst({
      where: {
        resourceId,
        isCurrent: true,
      },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
      },
    });

    if (!version) {
      return null;
    }

    return this.extractVersion(version.id);
  }

  async extractVersion(resourceVersionId: string): Promise<ResourceExtractionResult> {
    const version = await prisma.resourceVersion.findUnique({
      where: { id: resourceVersionId },
      select: {
        id: true,
        storageKey: true,
        sourceType: true,
      },
    });

    if (!version) {
      throw new Error('Resource version not found');
    }

    await this.ensureExtraction(resourceVersionId, 'PROCESSING');

    try {
      if (version.sourceType !== 'UPLOAD' || !version.storageKey) {
        throw new Error('Only locally uploaded PDF files can be extracted');
      }

      const absolutePath = this.storage.getAbsolutePath(version.storageKey);
      const content = await readFile(absolutePath);
      const rawText = await this.extractPdfText(content);
      const cleanText = this.normalizeText(rawText);
      const chunks = this.chunkText(cleanText);
      const summary = this.buildSummary(cleanText);

      await prisma.$transaction(async (tx) => {
        const extraction = await tx.resourceExtraction.upsert({
          where: { resourceVersionId },
          create: {
            resourceVersionId,
            status: 'DONE',
            rawText,
            cleanText,
            summary,
            detectedLanguage: 'es',
            extractedAt: new Date(),
          },
          update: {
            status: 'DONE',
            rawText,
            cleanText,
            summary,
            detectedLanguage: 'es',
            errorMessage: null,
            extractedAt: new Date(),
          },
          select: { id: true },
        });

        await tx.resourceChunk.deleteMany({ where: { extractionId: extraction.id } });

        if (chunks.length > 0) {
          await tx.resourceChunk.createMany({
            data: chunks.map((chunk, index) => ({
              extractionId: extraction.id,
              chunkIndex: index,
              content: chunk,
              metadata: {
                source: 'pdf-parse',
                chunkSize: chunk.length,
              },
            })),
          });
        }
      });

      return {
        resourceVersionId,
        status: 'DONE',
        charactersExtracted: cleanText.length,
        chunksCreated: chunks.length,
        summary,
        errorMessage: null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await prisma.resourceExtraction.upsert({
        where: { resourceVersionId },
        create: {
          resourceVersionId,
          status: 'FAILED',
          errorMessage,
        },
        update: {
          status: 'FAILED',
          errorMessage,
        },
      });

      return {
        resourceVersionId,
        status: 'FAILED',
        charactersExtracted: 0,
        chunksCreated: 0,
        summary: null,
        errorMessage,
      };
    }
  }

  private async extractPdfText(content: Buffer): Promise<string> {
    const parser = new PDFParse({ data: content });
    try {
      const result = await parser.getText();
      return result.text ?? '';
    } finally {
      await parser.destroy();
    }
  }

  private async ensureExtraction(resourceVersionId: string, status: 'PROCESSING') {
    await prisma.resourceExtraction.upsert({
      where: { resourceVersionId },
      create: {
        resourceVersionId,
        status,
      },
      update: {
        status,
        errorMessage: null,
      },
    });
  }

  private normalizeText(value: string): string {
    return value
      .replace(/\r\n/g, '\n')
      .replace(/[\t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private buildSummary(cleanText: string): string | null {
    if (!cleanText) {
      return null;
    }

    const compact = cleanText.replace(/\s+/g, ' ').trim();
    return compact.length <= 1200 ? compact : `${compact.slice(0, 1200).trim()}...`;
  }

  private chunkText(cleanText: string): string[] {
    if (!cleanText) {
      return [];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < cleanText.length) {
      const end = Math.min(start + CHUNK_SIZE, cleanText.length);
      chunks.push(cleanText.slice(start, end).trim());

      if (end >= cleanText.length) {
        break;
      }

      start = Math.max(0, end - CHUNK_OVERLAP);
    }

    return chunks.filter(Boolean);
  }
}
