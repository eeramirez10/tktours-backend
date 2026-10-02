import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { ResourceRepository } from '../../../resources/infrastructure/repositories/resource.repository.js';
import { createCatalogProgramBodySchema, updateCatalogProgramBodySchema } from '../../presentation/http/schemas/catalog-admin.schemas.js';
import { CatalogRepository } from './catalog.repository.js';
import { resourceBusinessDate } from '../../../resources/domain/resource-validity.js';

const camp = { countryCode: 'CA', familyKey: 'CAMP', name: 'Campamento Canadá', active: true };
const program = {
  id: 'program-test', slug: 'campamento-canada', name: camp.name, description: null,
  minAge: null, maxAge: null, active: true,
  country: { id: 'country-test', code: 'CA', name: 'Canadá', active: true },
  family: { id: 'family-test', key: 'CAMP', name: 'Campamentos / viajes', active: true },
  location: null, rule: null, prices: [], accommodations: [], resources: [], startWindows: [],
};
const window = { seasonKey: 'SUMMER', startMonth: 6, endMonth: 8, startDay: 20, endDay: 15, startsEveryMonday: false, notes: 'Fechas confirmadas' };

test('program creation does not require seasons and legacy season input is ignored', () => {
  assert.equal(createCatalogProgramBodySchema.safeParse(camp).success, true);
  assert.equal(createCatalogProgramBodySchema.safeParse({ ...camp, familyKey: 'LANGUAGE_COURSE' }).success, true);
  assert.equal(Object.hasOwn(createCatalogProgramBodySchema.parse({ ...camp, seasonKeys: ['WINTER'] }), 'seasonKeys'), false);
  assert.equal(Object.hasOwn(updateCatalogProgramBodySchema.parse({ name: 'BLI', seasonKeys: ['EASTER'] }), 'seasonKeys'), false);
  assert.equal(updateCatalogProgramBodySchema.safeParse({ seasonKeys: ['EASTER'] }).success, false);
});

test('creating a camp program does not persist seasons or invent dates', async () => {
  const database = {
    country: { findUnique: async () => ({ id: program.country.id }) },
    productFamily: { findUnique: async () => ({ id: program.family.id }) },
    program: { create: async (args: { data: Record<string, unknown> }) => {
      assert.equal(Object.hasOwn(args.data, 'startWindows'), false);
      return program;
    } },
  };
  const created = await new CatalogRepository(database as unknown as typeof prisma).createProgram(camp);
  assert.deepEqual(created.seasonKeys, []);
  assert.deepEqual(created.startWindows, []);
});

test('program updates preserve historical windows but do not advertise them for camps', async () => {
  const tx = {
    program: {
      findUnique: async () => ({ ...program, startWindows: [window] }),
      update: async (args: { data: Record<string, unknown> }) => {
        assert.equal(Object.hasOwn(args.data, 'startWindows'), false);
        return { ...program, startWindows: [window] };
      },
    },
  };
  const database = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) };
  const updated = await new CatalogRepository(database as unknown as typeof prisma).updateProgram({ programId: program.id, name: 'Campamento BLI' });
  assert.deepEqual(updated.seasonKeys, []);
  assert.deepEqual(updated.startWindows, []);
});

const today = resourceBusinessDate();
const year = today.getUTCFullYear();
const brochure = {
  id: 'pdf-test', title: 'Campamento BLI', type: 'BROCHURE', active: true,
  month: null, year, seasonKeys: ['SUMMER', 'EASTER'],
  shareFrom: new Date(Date.UTC(year, 0, 1)), shareUntil: new Date(Date.UTC(year, 11, 31)),
  validFrom: null, validUntil: null, family: program.family, country: program.country,
  versions: [{ fileName: 'camp.pdf', fileUrl: '/api/resources/pdf', mimeType: 'application/pdf' }],
};

test('catalog seasons come only from current PDF resources and refresh after edits or deletion', async () => {
  let resources = [brochure, { ...brochure, id: 'winter', seasonKeys: ['WINTER'] }];
  const database = { program: { findMany: async () => [{ ...program, resources, startWindows: [window] }] } };
  const repository = new CatalogRepository(database as unknown as typeof prisma);
  const query = { activeOnly: false };
  assert.deepEqual((await repository.findPrograms(query))[0]?.seasonKeys, ['SUMMER', 'EASTER', 'WINTER']);
  resources = [{ ...brochure, seasonKeys: ['WINTER'] }];
  assert.deepEqual((await repository.findPrograms(query))[0]?.seasonKeys, ['WINTER']);
  resources = [];
  assert.deepEqual((await repository.findPrograms(query))[0]?.seasonKeys, []);
});

test('expired, upcoming, pending, inactive, unclassified and missing PDF resources do not advertise seasons', async () => {
  const resources = [
    { ...brochure, year: year - 1 },
    { ...brochure, shareUntil: new Date(today.getTime() - 86_400_000) },
    { ...brochure, validUntil: new Date(today.getTime() - 86_400_000) },
    { ...brochure, shareFrom: new Date(today.getTime() + 86_400_000) },
    { ...brochure, shareUntil: null },
    { ...brochure, active: false },
    { ...brochure, seasonKeys: [] },
    { ...brochure, versions: [] },
    { ...brochure, versions: [{ ...brochure.versions[0], mimeType: 'text/plain' }] },
    { ...brochure, family: { ...program.family, active: false } },
    { ...brochure, country: { ...program.country, active: false } },
  ];
  const database = { program: { findMany: async () => [{ ...program, resources, startWindows: [window] }] } };
  const result = await new CatalogRepository(database as unknown as typeof prisma).findPrograms({ activeOnly: false });
  assert.deepEqual(result[0]?.seasonKeys, []);
});

test('camp matching uses PDF travel dates instead of legacy program windows', async () => {
  const database = { program: { findMany: async () => [{ ...program, startWindows: [window], resources: [{
    ...brochure, year: year + 1, seasonKeys: ['WINTER'],
    validFrom: new Date(Date.UTC(year + 1, 11, 1)), validUntil: new Date(Date.UTC(year + 1, 11, 31)),
  }] }] } };
  const repository = new CatalogRepository(database as unknown as typeof prisma);
  const query = { countryCode: 'CA', familyKey: 'CAMP' };
  assert.equal((await repository.findRecommendedPrograms({ ...query, preferredStartMonth: 6 })).length, 0);
  assert.deepEqual((await repository.findRecommendedPrograms({ ...query, preferredStartMonth: 12 }))[0]?.seasonKeys, ['WINTER']);
});

test('non-camp programs keep their configured start windows', async () => {
  const database = { program: { findMany: async () => [{ ...program, family: { ...program.family, key: 'LANGUAGE_COURSE' }, startWindows: [window] }] } };
  const result = await new CatalogRepository(database as unknown as typeof prisma).findPrograms({ activeOnly: false });
  assert.deepEqual(result[0]?.seasonKeys, []);
  assert.deepEqual(result[0]?.startWindows, [window]);
});

test('legacy PDF versions without a MIME type retain their resource seasons', async () => {
  const database = { program: { findMany: async () => [{ ...program, resources: [{
    ...brochure, versions: [{ ...brochure.versions[0], mimeType: null }],
  }] }] } };
  const result = await new CatalogRepository(database as unknown as typeof prisma).findPrograms({ activeOnly: false });
  assert.deepEqual(result[0]?.seasonKeys, ['SUMMER', 'EASTER']);
});

test('camp brochures use their own seasons and no longer reject other offers in the same country', async () => {
  const repository = new ResourceRepository() as unknown as {
    validateResourceRelations: (input: unknown) => Promise<void>;
  };
  const input = {
    relations: { familyKey: 'CAMP', programId: program.id, countryId: program.country.id, countryName: 'Canadá' },
    resourceId: null, type: 'BROCHURE', active: true, seasonKeys: ['SUMMER'],
  };
  await repository.validateResourceRelations(input);
  await repository.validateResourceRelations({ ...input, resourceId: 'another-offer' });
  await assert.rejects(repository.validateResourceRelations({ ...input, seasonKeys: [] }), /temporada del folleto/);
  await assert.rejects(repository.validateResourceRelations({ ...input, seasonKeys: ['YEAR_ROUND'] }), /temporada del folleto/);
});
