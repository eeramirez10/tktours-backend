import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourceBodySchema } from './create-resource.schemas.js';
import { uploadResourceBodySchema } from './upload-resource.schemas.js';
import { updateResourceBodySchema } from './update-resource.schemas.js';

const tariffs = [
  { kind: 'PACKAGE', weeks: 3, modality: 'Residencia', amount: 4200, currency: 'CAD', notes: null },
  { kind: 'EXTRA_WEEK', weeks: null, modality: 'Residencia', amount: 950, currency: 'CAD', notes: 'Sujeto a confirmación' },
];
const base = { countryCode: 'CA', familyKey: 'CAMP', type: 'BROCHURE', title: 'BLI', minWeeks: 2, maxWeeks: 6 };

test('create, multipart upload and patch preserve package prices independently from extra-week charges', () => {
  assert.deepEqual(createResourceBodySchema.parse({ ...base, tariffs }).tariffs, tariffs);
  assert.deepEqual(uploadResourceBodySchema.parse({ ...base, tariffs: JSON.stringify(tariffs) }).tariffs, tariffs);
  assert.deepEqual(updateResourceBodySchema.parse({ tariffs }).tariffs, tariffs);
  assert.deepEqual(updateResourceBodySchema.parse({ tariffs: [] }).tariffs, []);
  assert.equal(updateResourceBodySchema.parse({ title: 'New title' }).tariffs, undefined);
  assert.equal(createResourceBodySchema.parse(base).priceFrom, null);
});

test('tariffs require amount, currency and modality; only packages carry a duration', () => {
  for (const tariff of [
    { ...tariffs[0], weeks: null }, { ...tariffs[1], weeks: 3 },
    { ...tariffs[0], amount: -5 }, { ...tariffs[0], currency: '' },
    { ...tariffs[0], modality: '' }, { ...tariffs[0], amount: null },
  ]) assert.equal(updateResourceBodySchema.safeParse({ tariffs: [tariff] }).success, false);
});
