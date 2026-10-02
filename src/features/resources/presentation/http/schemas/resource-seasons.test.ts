import assert from 'node:assert/strict';
import test from 'node:test';

import { uploadResourceBodySchema } from './upload-resource.schemas.js';
import { createResourceBodySchema } from './create-resource.schemas.js';
import { updateResourceBodySchema } from './update-resource.schemas.js';

const brochure = { countryCode: 'CA', familyKey: 'CAMP', programSlug: 'camp', type: 'BROCHURE', title: 'Camp Canadá' };

test('multipart upload parses a PDF-specific list of seasons', () => {
  const parsed = uploadResourceBodySchema.parse({ ...brochure, seasonKeys: '["SUMMER","EASTER","SUMMER"]' });
  assert.deepEqual(parsed.seasonKeys, ['SUMMER', 'EASTER']);
  assert.equal(uploadResourceBodySchema.safeParse({ ...brochure, seasonKeys: '["CUSTOM"]' }).success, false);
  assert.equal(uploadResourceBodySchema.safeParse({ ...brochure, seasonKeys: 'SUMMER' }).success, false);
});

test('creation and editing retain only the explicit resource seasons', () => {
  assert.deepEqual(createResourceBodySchema.parse({ ...brochure, seasonKeys: ['WINTER'] }).seasonKeys, ['WINTER']);
  assert.deepEqual(updateResourceBodySchema.parse({ seasonKeys: ['EASTER'] }).seasonKeys, ['EASTER']);
  assert.equal(updateResourceBodySchema.parse({ title: 'Nuevo título' }).seasonKeys, undefined);
  assert.deepEqual(updateResourceBodySchema.parse({ seasonKeys: [] }).seasonKeys, []);
});
