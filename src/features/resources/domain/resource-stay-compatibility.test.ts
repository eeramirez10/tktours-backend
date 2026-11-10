import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceStayCompatibility as fits } from './resource-stay-compatibility.js';
const today = new Date('2026-11-10T00:00:00Z');
const flap = { year: 2027, validFrom: '2027-06-20', validUntil: '2027-08-14', minWeeks: 2, maxWeeks: 8 };
const eli = { year: 2027, validFrom: '2027-07-04', validUntil: '2027-08-01', minWeeks: 2, maxWeeks: 4 };
test('June and three weeks fits FLAP, not the July brochure', () => {
  assert.equal(fits(flap, 6, 3, null, today), 'CONFIRMED');
  assert.equal(fits(eli, 6, 3, null, today), 'INCOMPATIBLE');
  assert.equal(fits(flap, 7, 3, null, today), 'CONFIRMED');
  assert.equal(fits(eli, 7, 3, null, today), 'CONFIRMED');
});
test('full stays respect inclusive dates and never recommend past starts', () => {
  assert.equal(fits(flap, 6, 8, null, today), 'CONFIRMED');
  assert.equal(fits(flap, 7, 8, null, today), 'INCOMPATIBLE');
  assert.equal(fits(flap, 8, 8, null, today), 'INCOMPATIBLE');
  assert.equal(fits(flap, 8, 2, null, today), 'CONFIRMED');
  assert.equal(fits(flap, 8, 2, null, new Date('2027-08-02')), 'INCOMPATIBLE');
  assert.equal(fits(flap, 6, 1, null, today), 'INCOMPATIBLE');
  assert.equal(fits(flap, 6, 9, null, today), 'INCOMPATIBLE');
  assert.equal(fits(flap, 6, 3, 2028, today), 'INCOMPATIBLE');
});
test('unknown dates and durations do not establish compatibility; calendar spans years', () => {
  assert.equal(fits({ ...flap, minWeeks: null }, 6, 3, null, today), 'UNCONFIRMED');
  assert.equal(fits({ ...flap, validFrom: null }, 6, 3, null, today), 'UNCONFIRMED');
  assert.equal(fits({ ...flap, year: null, validFrom: '2026-12-20', validUntil: '2027-01-16' }, 12, 4, null, today), 'CONFIRMED');
});
