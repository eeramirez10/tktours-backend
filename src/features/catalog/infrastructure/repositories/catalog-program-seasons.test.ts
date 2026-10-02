import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { ResourceRepository } from '../../../resources/infrastructure/repositories/resource.repository.js';
import { createCatalogProgramBodySchema, updateCatalogProgramBodySchema } from '../../presentation/http/schemas/catalog-admin.schemas.js';
import { CatalogRepository } from './catalog.repository.js';

const camp = { countryCode: 'CA', familyKey: 'CAMP', name: 'Campamento Canadá', active: true };
const program = {
  id: 'program-test', slug: 'campamento-canada', name: camp.name, description: null,
  minAge: null, maxAge: null, active: true,
  country: { id: 'country-test', code: 'CA', name: 'Canadá', active: true },
  family: { id: 'family-test', key: 'CAMP', name: 'Campamentos / viajes', active: true },
  location: null, rule: null, prices: [], accommodations: [], resources: [], startWindows: [],
};
const window = { seasonKey: 'SUMMER', startMonth: 6, endMonth: 8, startDay: 20, endDay: 15, startsEveryMonday: false, notes: 'Fechas confirmadas' };

test('camp programs require explicit seasons; other families do not', () => {
  const missingSeason = createCatalogProgramBodySchema.safeParse(camp);
  assert.equal(missingSeason.success, false);
  if (!missingSeason.success) assert.equal(missingSeason.error.issues[0]?.path[0], 'seasonKeys');
  assert.equal(createCatalogProgramBodySchema.safeParse({ ...camp, familyKey: 'LANGUAGE_COURSE' }).success, true);
  assert.equal(createCatalogProgramBodySchema.safeParse({ ...camp, seasonKeys: ['CUSTOM'] }).success, false);
  assert.deepEqual(createCatalogProgramBodySchema.parse({ ...camp, seasonKeys: ['SUMMER', 'SUMMER', 'WINTER'] }).seasonKeys, ['SUMMER', 'WINTER']);
  assert.deepEqual(updateCatalogProgramBodySchema.parse({ seasonKeys: ['EASTER'] }).seasonKeys, ['EASTER']);
});

test('creating a camp program persists the selected seasons with no invented dates', async () => {
  const database = {
    country: { findUnique: async () => ({ id: program.country.id }) },
    productFamily: { findUnique: async () => ({ id: program.family.id }) },
    program: { create: async (args: { data: { startWindows: { create: Array<{ seasonKey: string; active: boolean }> } } }) => {
    assert.deepEqual(args.data.startWindows.create, [{ seasonKey: 'SUMMER', active: true }, { seasonKey: 'EASTER', active: true }]);
    return { ...program, startWindows: args.data.startWindows.create.map((season) => ({ ...window, ...season, startMonth: null, endMonth: null, startDay: null, endDay: null, notes: null })) };
    } },
  };
  const created = await new CatalogRepository(database as unknown as typeof prisma).createProgram({ ...camp, seasonKeys: ['SUMMER', 'EASTER'] });
  assert.deepEqual(created.startWindows.map((season) => season.seasonKey), ['SUMMER', 'EASTER']);
  assert.equal(created.startWindows[0]?.startMonth, null);
});

test('adding seasons to an existing program preserves dated windows and does not recreate them', async () => {
  const tx = {
    program: {
      findUnique: async () => ({ ...program, startWindows: [window] }),
      update: async (args: { data: { startWindows: { create: unknown[]; updateMany: unknown[] } } }) => {
        assert.deepEqual(args.data.startWindows.create, [{ seasonKey: 'WINTER', active: true }]);
        assert.deepEqual(args.data.startWindows.updateMany, [
          { where: { seasonKey: { in: ['SUMMER', 'EASTER', 'WINTER'], notIn: ['SUMMER', 'WINTER'] } }, data: { active: false } },
          { where: { seasonKey: { in: ['SUMMER', 'WINTER'] } }, data: { active: true } },
        ]);
        return { ...program, startWindows: [window, { ...window, seasonKey: 'WINTER' }] };
      },
    },
  };
  const database = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) };
  const updated = await new CatalogRepository(database as unknown as typeof prisma).updateProgram({ programId: program.id, seasonKeys: ['SUMMER', 'WINTER'] });
  assert.deepEqual(updated.startWindows.map((season) => season.seasonKey), ['SUMMER', 'WINTER']);
  assert.equal(updated.startWindows[0]?.startMonth, 6);
  assert.equal(updated.startWindows[0]?.notes, 'Fechas confirmadas');
});

test('camp season removal is rejected and metadata-only updates leave windows intact', async () => {
  let updated = false;
  const tx = {
    program: {
      findUnique: async () => program,
      update: async (args: { data: Record<string, unknown> }) => {
        assert.equal(Object.hasOwn(args.data, 'startWindows'), false);
        updated = true;
        return program;
      },
    },
  };
  const database = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) };
  const repository = new CatalogRepository(database as unknown as typeof prisma);
  await assert.rejects(repository.updateProgram({ programId: program.id, seasonKeys: [] }), /Selecciona al menos una temporada/);
  assert.equal(updated, false);
  await repository.updateProgram({ programId: program.id, active: false });
  assert.equal(updated, true);
});

test('camp brochures validate successfully with configured seasons and retain duplicate checks', async () => {
  const repository = new ResourceRepository() as unknown as {
    validateResourceRelations: (input: unknown, db: unknown) => Promise<void>;
  };
  const input = {
    relations: { familyKey: 'CAMP', programId: program.id, programSeasonKeys: ['SUMMER'], countryId: program.country.id, countryName: 'Canadá' },
    resourceId: null, type: 'BROCHURE', active: true,
  };
  const db = { resource: { findFirst: async () => null } };
  await repository.validateResourceRelations(input, db);
  await assert.rejects(repository.validateResourceRelations({ ...input, relations: { ...input.relations, programSeasonKeys: [] } }, db), /Catálogo > Programas/);
  await assert.rejects(repository.validateResourceRelations(input, { resource: { findFirst: async () => ({ id: 'existing' }) } }), /already an active camp brochure/);
});
