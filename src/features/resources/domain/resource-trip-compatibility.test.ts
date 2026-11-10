import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceTripCompatibility } from './resource-trip-compatibility.js';

const summer = { year: 2027, validFrom: '2027-07-04', validUntil: '2027-08-08' };
test('month-only requests are validated against trip dates, never publication or season', () => {
  assert.equal(resourceTripCompatibility(summer, 1), 'INCOMPATIBLE');
  assert.equal(resourceTripCompatibility(summer, 7), 'CONFIRMED');
  assert.equal(resourceTripCompatibility(summer, 8), 'CONFIRMED');
  assert.equal(resourceTripCompatibility(summer, 7, 2028), 'INCOMPATIBLE');
  assert.equal(resourceTripCompatibility({ ...summer, validUntil: null }, 7), 'UNCONFIRMED');
  assert.equal(resourceTripCompatibility({ year: null, validFrom: '2026-12-20', validUntil: '2027-01-08' }, 1), 'CONFIRMED');
  assert.equal(resourceTripCompatibility(summer), 'UNCONFIRMED');
});
