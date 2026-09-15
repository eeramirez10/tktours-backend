import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ResourceRepository } from '../features/resources/infrastructure/repositories/resource.repository.js';
import { prisma } from '../shared/infrastructure/database/prisma.js';

const repository = new ResourceRepository();
const suffix = Date.now().toString(36);
const countryCode = `Z${randomBytes(1).toString('hex').slice(0, 2)}`.toUpperCase();
const rollbackCountryCode = `Y${randomBytes(1).toString('hex').slice(0, 2)}`.toUpperCase();
const countryName = `Test Country ${suffix}`;
const cityNames = [`Test City One ${suffix}`, `Test City Two ${suffix}`];
const expectedSlugs = cityNames.map(slugify);
let resourceId: string | undefined;

try {
  assert.equal(await prisma.country.findUnique({ where: { code: countryCode } }), null);
  assert.equal(await prisma.country.findUnique({ where: { code: rollbackCountryCode } }), null);

  await assert.rejects(repository.createResource({
    countryCode: rollbackCountryCode,
    countryName: `Rollback Country ${suffix}`,
    familyKey: 'CAMP',
    programSlug: `missing-program-${suffix}`,
    locationNames: [`Rollback City ${suffix}`],
    type: 'BROCHURE',
    title: `ROLLBACK_DESTINATION_TEST_${suffix}`,
    description: null,
    month: null,
    year: null,
    active: true,
  }));
  assert.equal(await prisma.country.findUnique({ where: { code: rollbackCountryCode } }), null);

  const created = await repository.createResource({
    countryCode,
    countryName,
    locationNames: cityNames,
    type: 'INFO',
    title: `INLINE_DESTINATION_TEST_${suffix}`,
    description: null,
    month: null,
    year: null,
    active: false,
  });
  resourceId = created.id;

  assert.equal(created.country.name, countryName);
  assert.deepEqual(created.locations.map((location) => location.slug).sort(), [...expectedSlugs].sort());

  const foundBySecondCity = await repository.findResources({
    activeOnly: false,
    locationSlug: expectedSlugs[1],
  });
  assert(foundBySecondCity.some((resource) => resource.id === created.id));

  const updated = await repository.updateResource({
    resourceId: created.id,
    countryCode,
    countryName,
    locationNames: [cityNames[1]],
  });
  assert.deepEqual(updated.locations.map((location) => location.slug), [expectedSlugs[1]]);
  assert.equal(updated.location?.slug, expectedSlugs[1]);
  assert.equal(await prisma.programLocation.count({ where: { country: { code: countryCode } } }), 2);

  console.log('Inline destination creation and resource reuse checks passed');
} finally {
  if (resourceId) await repository.deleteResource(resourceId);
  const country = await prisma.country.findUnique({ where: { code: countryCode }, select: { id: true, name: true } });
  if (country?.name === countryName) {
    await prisma.programLocation.deleteMany({ where: { countryId: country.id } });
    await prisma.country.delete({ where: { id: country.id } });
  }
  await prisma.$disconnect();
}

function slugify(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
