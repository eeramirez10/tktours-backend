import assert from 'node:assert/strict';

import { ResourceRepository } from '../features/resources/infrastructure/repositories/resource.repository.js';
import { prisma } from '../shared/infrastructure/database/prisma.js';

const repository = new ResourceRepository();
const suffix = Date.now().toString(36);
const locationIds: string[] = [];
let resourceId: string | undefined;

try {
  const country =
    (await prisma.country.findUnique({ where: { code: 'CA' }, select: { id: true, code: true } })) ??
    (await prisma.country.findFirst({ select: { id: true, code: true } }));
  assert(country, 'The development database needs at least one country');

  for (const index of [1, 2]) {
    const location = await prisma.programLocation.create({
      data: {
        countryId: country.id,
        name: `Test City ${index} ${suffix}`,
        slug: `test-city-${index}-${suffix}`,
        active: true,
      },
      select: { id: true },
    });
    locationIds.push(location.id);
  }

  const locations = await prisma.programLocation.findMany({
    where: { id: { in: locationIds } },
    orderBy: { name: 'asc' },
    select: { slug: true },
  });
  const expectedSlugs = locations.map((location) => location.slug);

  const created = await repository.createResource({
    countryCode: country.code,
    locationSlugs: expectedSlugs,
    type: 'INFO',
    title: `MULTI_CITY_TEST_${suffix}`,
    description: null,
    month: null,
    year: null,
    active: false,
  });
  resourceId = created.id;
  assert.deepEqual(created.locations.map((location) => location.slug).sort(), [...expectedSlugs].sort());

  const foundBySecondCity = await repository.findResources({
    activeOnly: false,
    locationSlug: expectedSlugs[1],
  });
  assert(foundBySecondCity.some((resource) => resource.id === created.id));

  const updated = await repository.updateResource({
    resourceId: created.id,
    locationSlugs: [expectedSlugs[1]],
  });
  assert.deepEqual(updated.locations.map((location) => location.slug), [expectedSlugs[1]]);
  assert.equal(updated.location?.slug, expectedSlugs[1]);

  console.log('Resource multi-city persistence checks passed');
} finally {
  if (resourceId) await repository.deleteResource(resourceId);
  if (locationIds.length > 0) {
    await prisma.programLocation.deleteMany({ where: { id: { in: locationIds } } });
  }
  await prisma.$disconnect();
}
