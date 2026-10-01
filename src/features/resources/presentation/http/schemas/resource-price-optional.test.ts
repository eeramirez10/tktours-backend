import assert from 'node:assert/strict';
import test from 'node:test';

import { createResourceBodySchema } from './create-resource.schemas.js';
import { updateResourceBodySchema } from './update-resource.schemas.js';
import { uploadResourceBodySchema } from './upload-resource.schemas.js';

const campBrochure = {
  countryCode: 'CA',
  familyKey: 'CAMP',
  programSlug: 'canada-summer-camp',
  type: 'BROCHURE',
  title: 'Campamento Canadá',
} as const;

test('a camp brochure can be uploaded without any price data', () => {
  const result = uploadResourceBodySchema.safeParse(campBrochure);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.priceFrom, null);
    assert.equal(result.data.priceCurrency, null);
    assert.equal(result.data.priceUnit, null);
    assert.equal(result.data.priceNotes, null);
  }
});

test('price amount, currency, unit and notes remain optional on create and update', () => {
  const upload = uploadResourceBodySchema.safeParse({ ...campBrochure, priceFrom: '1500' });
  assert.equal(upload.success, true);
  if (upload.success) {
    assert.equal(upload.data.priceFrom, 1500);
    assert.equal(upload.data.priceCurrency, null);
  }

  const create = createResourceBodySchema.safeParse({ ...campBrochure, priceFrom: 1500 });
  assert.equal(create.success, true);
  if (create.success) {
    assert.equal(create.data.priceFrom, 1500);
    assert.equal(create.data.priceCurrency, null);
  }

  const update = updateResourceBodySchema.safeParse({
    familyKey: 'CAMP', type: 'BROCHURE', priceFrom: 1500, priceCurrency: null,
    priceUnit: null, priceNotes: null,
  });
  assert.equal(update.success, true);
  if (update.success) {
    assert.equal(update.data.priceFrom, 1500);
    assert.equal(update.data.priceCurrency, null);
  }
});
