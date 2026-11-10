import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceStoredDocumentAnalysisService } from './resource-stored-document-analysis.service.js';
import { LocalResourceStorageService } from '../../infrastructure/storage/local-resource-storage.service.js';

test('reanalyzing uses the saved current PDF and only returns suggestions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'resource-reanalysis-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const content = Buffer.from('%PDF-1.7 existing brochure');
  await writeFile(join(root, 'saved.pdf'), content);
  let calls = 0;
  const resources = { findResourceById: async () => ({
    currentVersion: { id: 'current' }, versions: [
      { id: 'old', sourceType: 'UPLOAD', storageKey: 'missing.pdf', fileName: 'old.pdf' },
      { id: 'current', sourceType: 'UPLOAD', storageKey: 'saved.pdf', fileName: 'saved.pdf' },
    ],
  }) };
  const service = new ResourceStoredDocumentAnalysisService(resources as never, new LocalResourceStorageService(root), {
    analyze: async (input) => { calls++; assert.deepEqual(input.content, content); assert.equal(input.fileName, 'saved.pdf'); return { minWeeks: 2, maxWeeks: 8 } as never; },
  });
  assert.deepEqual(await service.analyze('resource', { type: 'BROCHURE' }), { minWeeks: 2, maxWeeks: 8 });
  assert.deepEqual(await service.analyze('resource', { type: 'BROCHURE' }), { minWeeks: 2, maxWeeks: 8 });
  assert.equal(calls, 2);
});

test('reanalyzing a missing resource or a resource without a saved PDF fails explicitly', async () => {
  for (const resource of [null, { currentVersion: null, versions: [] }]) {
    const service = new ResourceStoredDocumentAnalysisService({ findResourceById: async () => resource } as never);
    await assert.rejects(() => service.analyze('missing', { type: 'BROCHURE' }));
  }
});
