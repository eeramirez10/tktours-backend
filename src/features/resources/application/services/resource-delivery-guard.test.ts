import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { ResourceDeliveryGuardService } from './resource-delivery-guard.service.js';

test('sending re-queries current versions and drops a PDF that expired after its offer', async (context) => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const oldUrl = `https://example.com/api/resources/${id}/versions/${id}/download`;
  const newUrl = 'https://example.com/new-edition.pdf';
  const original = prisma.resourceVersion.findMany;
  context.after(() => { prisma.resourceVersion.findMany = original; });
  const base = {
    id, active: true, type: 'BROCHURE', year: 2099, family: { key: 'CAMP' }, program: null,
    shareFrom: new Date('2000-01-01'), shareUntil: new Date('2099-12-31'),
    validFrom: null, validUntil: null, minAge: null, maxAge: null,
  };
  prisma.resourceVersion.findMany = (async (args: { where: { isCurrent: boolean; resource: { AND: unknown[] } } }) => {
    assert.equal(args.where.isCurrent, true);
    assert.ok(args.where.resource.AND.length >= 6);
    return [
      { id, sourceType: 'UPLOAD', fileUrl: oldUrl, resource: { ...base, shareUntil: new Date('2001-01-01') } },
      { id: 'new', sourceType: 'EXTERNAL_LINK', fileUrl: newUrl, resource: base },
    ];
  }) as unknown as typeof prisma.resourceVersion.findMany;
  assert.deepEqual(await new ResourceDeliveryGuardService().filterMediaUrls([oldUrl, newUrl], null), [newUrl]);
});

test('unrecognized or replaced attachments cannot bypass the delivery guard', async (context) => {
  const original = prisma.resourceVersion.findMany;
  context.after(() => { prisma.resourceVersion.findMany = original; });
  prisma.resourceVersion.findMany = (async () => []) as unknown as typeof prisma.resourceVersion.findMany;
  assert.deepEqual(await new ResourceDeliveryGuardService().filterMediaUrls(['https://example.com/unknown.pdf'], null), []);
  assert.deepEqual(await new ResourceDeliveryGuardService().filterMediaUrls([], null), []);
  assert.deepEqual(await new ResourceDeliveryGuardService().filterMediaUrls(['http://[invalid', 'file:///tmp/camp.pdf'], null), []);
});

test('local attachments must belong to the validated resource as well as the current version', async (context) => {
  const resourceId = '12345678-1234-1234-1234-123456789abc';
  const versionId = '98765432-4321-4321-4321-cba987654321';
  const validUrl = `https://example.com/api/resources/${resourceId}/versions/${versionId}/download`;
  const wrongParent = `https://example.com/api/resources/${versionId}/versions/${versionId}/download`;
  const original = prisma.resourceVersion.findMany;
  context.after(() => { prisma.resourceVersion.findMany = original; });
  prisma.resourceVersion.findMany = (async () => [{
    id: versionId, sourceType: 'UPLOAD', fileUrl: validUrl,
    resource: {
      id: resourceId, active: true, type: 'BROCHURE', family: { key: 'CAMP' }, program: null, year: 2099,
      shareFrom: new Date('2000-01-01'), shareUntil: new Date('2099-12-31'), validFrom: null, validUntil: null,
      minAge: null, maxAge: null,
    },
  }]) as unknown as typeof prisma.resourceVersion.findMany;
  const delivery = await new ResourceDeliveryGuardService().prepareDelivery([validUrl, wrongParent], null);
  assert.deepEqual(delivery.urls, [validUrl]);
  assert.deepEqual(delivery.versions, [{ resourceId, versionId, url: validUrl }]);
});
