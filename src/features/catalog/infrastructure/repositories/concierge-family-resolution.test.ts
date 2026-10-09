import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { canonicalConciergeFamily, normalizedFamilyKey } from '../../domain/concierge-families.js';
import { CatalogRepository } from './catalog.repository.js';
import { resolveConciergeFamily } from './resolve-concierge-family.js';

test('menu families recognize Spanish catalog labels while school years and custom families remain distinct', () => {
  for (const name of ['Cursos de Idiomas', 'Curso de Idiomas', 'Idiomas', 'CURSOS_DE_IDIOMAS']) {
    assert.equal(canonicalConciergeFamily(name)?.key, 'LANGUAGE_COURSE');
  }
  for (const name of ['Campamentos', 'Campamentos / viajes', 'Campamentos y viajes']) {
    assert.equal(canonicalConciergeFamily(name)?.key, 'CAMP');
  }
  for (const name of ['Tours', 'Circuitos por el mundo']) assert.equal(canonicalConciergeFamily(name)?.key, 'SCHOOL_PROGRAM');
  assert.equal(canonicalConciergeFamily('Años escolares'), null);
  assert.equal(canonicalConciergeFamily('Intercambios deportivos'), null);
  assert.equal(normalizedFamilyKey('Años escolares'), 'ANOS_ESCOLARES');
});

test('creating catalog families assigns stable menu keys and still supports custom families', async () => {
  const database = { productFamily: { create: async (args: { data: { key: string; name: string } }) => ({ id: 'family', active: true, ...args.data }) } };
  const repository = new CatalogRepository(database as unknown as typeof prisma);
  for (const [name, key] of [['Cursos de Idiomas', 'LANGUAGE_COURSE'], ['Campamentos', 'CAMP'], ['Tours', 'SCHOOL_PROGRAM'], ['Años escolares', 'ANOS_ESCOLARES']]) {
    assert.equal((await repository.createFamily({ name: name!, active: true })).key, key);
  }
  assert.equal((await repository.createFamily({ name: 'Campamentos', key: 'CAMPAMENTOS', active: true })).key, 'CAMP');
});

test('a missing canonical family resolves the existing Spanish row without losing its ID', async () => {
  const row = { id: 'existing-id', key: 'CURSOS_DE_IDIOMAS', name: 'Cursos de Idiomas' };
  const database = { productFamily: {
    findUnique: async () => null,
    findMany: async () => [row],
    update: async (args: { where: { id: string }; data: { key: string } }) => {
      assert.equal(args.where.id, row.id);
      assert.equal(args.data.key, 'LANGUAGE_COURSE');
      return { id: row.id };
    },
  } };
  assert.deepEqual(await resolveConciergeFamily('LANGUAGE_COURSE', database as unknown as typeof prisma), { id: row.id });
});

test('empty catalogs recover only the built-in menu families and never invent arbitrary ones', async () => {
  const created: string[] = [];
  const database = { productFamily: {
    findUnique: async () => null,
    findMany: async () => [],
    upsert: async (args: { where: { key: string }; create: { key: string; name: string }; update: object }) => {
      assert.equal(args.where.key, args.create.key);
      assert.deepEqual(args.update, {});
      created.push(args.create.key);
      return { id: args.create.key };
    },
  } };
  for (const key of ['LANGUAGE_COURSE', 'CAMP', 'SCHOOL_PROGRAM']) {
    assert.deepEqual(await resolveConciergeFamily(key, database as unknown as typeof prisma), { id: key });
  }
  assert.equal(await resolveConciergeFamily('UNREGISTERED_FAMILY', database as unknown as typeof prisma), null);
  assert.deepEqual(created, ['LANGUAGE_COURSE', 'CAMP', 'SCHOOL_PROGRAM']);
});

test('existing canonical and inactive rows are reused without changing their configuration', async () => {
  const database = { productFamily: { findUnique: async () => ({ id: 'canonical-id' }) } };
  assert.deepEqual(await resolveConciergeFamily('LANGUAGE_COURSE', database as unknown as typeof prisma), { id: 'canonical-id' });
});

test('renaming a known family does not change its menu category', async () => {
  const database = { productFamily: {
    findUnique: async () => null,
    findMany: async () => [{ id: 'camp-id', key: 'CAMP', name: 'Cursos de idiomas' }],
    upsert: async () => ({ id: 'new-language-id' }),
  } };
  assert.deepEqual(await resolveConciergeFamily('LANGUAGE_COURSE', database as unknown as typeof prisma), { id: 'new-language-id' });
});

test('concurrent alias repairs reuse the winning canonical row', async () => {
  let reads = 0;
  const database = { productFamily: {
    findUnique: async () => ++reads === 1 ? null : { id: 'canonical-id' },
    findMany: async () => [{ id: 'alias-id', key: 'CAMPAMENTOS', name: 'Campamentos' }],
    update: async () => { throw new Prisma.PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: 'test' }); },
  } };
  assert.deepEqual(await resolveConciergeFamily('CAMP', database as unknown as typeof prisma), { id: 'canonical-id' });
});

test('ambiguous historical families require reconciliation rather than selecting an arbitrary catalog', async () => {
  const database = { productFamily: {
    findUnique: async () => null,
    findMany: async () => [{ id: '1', key: 'CAMPAMENTOS', name: 'Campamentos' }, { id: '2', key: 'CAMPS', name: 'Camps' }],
  } };
  await assert.rejects(resolveConciergeFamily('CAMP', database as unknown as typeof prisma), /migraciones/);
});
