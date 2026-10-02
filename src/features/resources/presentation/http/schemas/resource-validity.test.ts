import assert from 'node:assert/strict';
import test from 'node:test';
import { createResourceBodySchema } from './create-resource.schemas.js';
import { uploadResourceBodySchema } from './upload-resource.schemas.js';
import { updateResourceBodySchema } from './update-resource.schemas.js';

const input = {
  countryCode: 'CA', familyKey: 'CAMP', programSlug: 'camp', type: 'BROCHURE', title: 'Camp Canadá',
  seasonKeys: ['SUMMER'], year: 2027, shareFrom: '2026-10-01', shareUntil: '2027-06-30',
  validFrom: '2027-07-15', validUntil: '2027-08-15',
};

test('upload, creation and patch preserve edition, commercial dates and trip dates independently', () => {
  for (const schema of [createResourceBodySchema, uploadResourceBodySchema, updateResourceBodySchema]) {
    const result = schema.parse(input);
    assert.equal(result.year, 2027);
    assert.equal(result.shareFrom?.toISOString().slice(0, 10), '2026-10-01');
    assert.equal(result.validFrom?.toISOString().slice(0, 10), '2027-07-15');
    assert.equal(schema.safeParse({ ...input, shareUntil: '2026-09-01' }).success, false);
    assert.equal(schema.safeParse({ ...input, validUntil: '2027-07-01' }).success, false);
  }
});

test('multipart parses edition and partial patches can explicitly clear a sharing date', () => {
  assert.equal(uploadResourceBodySchema.parse({ ...input, year: '2027' }).year, 2027);
  assert.equal(updateResourceBodySchema.parse({ shareUntil: null }).shareUntil, null);
  assert.equal(updateResourceBodySchema.parse({ title: 'Otro título' }).shareUntil, undefined);
});
