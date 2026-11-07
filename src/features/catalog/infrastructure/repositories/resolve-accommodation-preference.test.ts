import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { resolveAccommodationPreference } from './resolve-accommodation-preference.js';

test('an empty reference catalog accepts all three supported accommodation preferences', async () => {
  const created: string[] = [];
  const database = { accommodationType: { upsert: async (args: {
    where: { key: string }; create: { key: string; name: string; active: boolean }; update: object;
  }) => {
    assert.equal(args.where.key, args.create.key);
    assert.deepEqual(args.update, {});
    created.push(args.create.key);
    return { id: args.create.key };
  } } };
  for (const key of ['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT']) {
    assert.deepEqual(await resolveAccommodationPreference(key, database as unknown as typeof prisma), { id: key });
  }
  assert.equal(created.length, 3);
});

test('existing or inactive preferences are reused without overwriting their settings', async () => {
  const database = { accommodationType: { upsert: async (args: { update: object }) => {
    assert.deepEqual(args.update, {});
    return { id: 'existing-residence-id' };
  } } };
  assert.deepEqual(await resolveAccommodationPreference('UNIVERSITY_RESIDENCE', database as unknown as typeof prisma), { id: 'existing-residence-id' });
});

test('unknown accommodation values never create invented catalog entries', async () => {
  const database = { accommodationType: { upsert: async () => { throw new Error('No write expected'); } } };
  for (const key of ['HOTEL_UNKNOWN', 'RESIDENCIA', 'toString', '']) {
    assert.equal(await resolveAccommodationPreference(key, database as unknown as typeof prisma), null);
  }
});
