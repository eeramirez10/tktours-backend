import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceBusinessDate, resourceEligibilityFilters, resourceValidityStatus } from './resource-validity.js';

const today = new Date('2026-12-10T00:00:00Z');
const brochure = {
  active: true, type: 'BROCHURE', family: { key: 'CAMP' }, year: 2027,
  shareFrom: new Date('2026-10-01'), shareUntil: new Date('2027-06-30'),
  validFrom: new Date('2027-07-15'), validUntil: new Date('2027-08-15'),
};

test('summer next year may be shared during winter when commercial validity has begun', () => {
  assert.equal(resourceValidityStatus(brochure, today), 'CURRENT');
});

test('expired documents, finished trips and previous-year editions are never current', () => {
  for (const change of [
    { shareUntil: new Date('2026-12-09') },
    { validUntil: new Date('2026-12-09') },
    { year: 2025 },
  ]) assert.equal(resourceValidityStatus({ ...brochure, ...change }, today), 'EXPIRED');
});

test('camp brochures missing an edition or either sharing boundary remain pending', () => {
  for (const change of [{ year: null }, { shareFrom: null }, { shareUntil: null }]) {
    assert.equal(resourceValidityStatus({ ...brochure, ...change }, today), 'PENDING');
  }
  assert.equal(resourceValidityStatus({ ...brochure, shareFrom: new Date('2027-01-01') }, today), 'UPCOMING');
  assert.equal(resourceValidityStatus({ ...brochure, active: false }, today), 'INACTIVE');
});

test('sharing deadlines are inclusive and genuine undated manuals remain available', () => {
  assert.equal(resourceValidityStatus({ ...brochure, shareUntil: today }, today), 'CURRENT');
  assert.equal(resourceValidityStatus({ ...brochure, type: 'MANUAL', year: null, shareFrom: null, shareUntil: null, validFrom: null, validUntil: null }, today), 'CURRENT');
});

test('business date remains yesterday before midnight in Mexico even if UTC changed days', () => {
  assert.equal(resourceBusinessDate(new Date('2026-12-11T05:59:59Z')).toISOString(), today.toISOString());
  assert.equal(resourceBusinessDate(new Date('2026-12-11T06:00:00Z')).toISOString(), '2026-12-11T00:00:00.000Z');
});

test('month matching considers the complete month and commercial expiration always uses today', () => {
  const filters = resourceEligibilityFilters(new Date('2027-07-01'), today);
  assert.ok(filters.some((filter) => JSON.stringify(filter).includes('2027-07-31')));
  assert.ok(filters.some((filter) => JSON.stringify(filter).includes('2027-07-01')));
  assert.ok(filters.some((filter) => JSON.stringify(filter).includes('2026-12-10')));
  assert.ok(filters.some((filter) => JSON.stringify(filter) === JSON.stringify({ OR: [{ year: null }, { year: 2027 }] })));
});
