import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { env } from '../../../../shared/config/env.js';

export class LocalResourceStorageService {
  private readonly rootDir: string;

  constructor(rootDir = env.RESOURCES_STORAGE_DIR) {
    this.rootDir = resolve(rootDir);
  }

  async writeVersionFile(params: {
    resourceId: string;
    versionId: string;
    fileName: string;
    content: Buffer;
  }): Promise<string> {
    const storageKey = join(params.resourceId, params.versionId, this.sanitizeFileName(params.fileName));
    const absolutePath = this.toAbsolutePath(storageKey);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, params.content);

    return storageKey;
  }

  async deleteByStorageKey(storageKey: string | null | undefined): Promise<void> {
    if (!storageKey) {
      return;
    }

    const absolutePath = this.toAbsolutePath(storageKey);
    await rm(absolutePath, { force: true });
  }

  getAbsolutePath(storageKey: string): string {
    return this.toAbsolutePath(storageKey);
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  }

  private toAbsolutePath(storageKey: string): string {
    return resolve(this.rootDir, storageKey);
  }
}
