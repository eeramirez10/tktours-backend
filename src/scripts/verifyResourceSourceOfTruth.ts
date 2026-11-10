import assert from 'node:assert/strict';
import { prisma } from '../shared/infrastructure/database/prisma.js';
import { ResourceRepository } from '../features/resources/infrastructure/repositories/resource.repository.js';
import { ResourceSendHistoryService } from '../features/resources/application/services/resource-send-history.service.js';
import { MetaWhatsAppStatusService } from '../features/whatsapp/application/services/meta-whatsapp-status.service.js';
import { ConciergeToolExecutorService } from '../features/concierge/application/services/concierge-tool-executor.service.js';

// Deliberately restricted to a disposable local database seeded BEFORE the new migration.
const database = new URL(process.env.DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/resources_test') {
  throw new Error('Use a disposable local database named resources_test; never run against application data.');
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function main() {
  const repository = new ResourceRepository();
  const original = await repository.findResourceById(id(3));
  assert.ok(original);
  assert.equal(original.minWeeks, null);
  assert.equal(original.maxWeeks, null);
  assert.deepEqual(original.tariffs, []);
  assert.equal(original.shareFrom?.toISOString().slice(0, 10), '2026-11-09');
  assert.equal(original.shareUntil?.toISOString().slice(0, 10), '2027-08-31');
  assert.equal(original.validFrom?.toISOString().slice(0, 10), '2027-07-04');
  assert.equal(original.validUntil?.toISOString().slice(0, 10), '2027-08-08');
  assert.equal(original.currentVersion?.id, id(4));
  assert.equal(await prisma.contact.count(), 1);
  assert.equal(await prisma.conversation.count(), 1);
  assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: id(7) } })).text, 'Existing conversation remains');

  const tariffs = [
    { kind: 'PACKAGE' as const, weeks: 3, modality: 'Residencia', amount: 4000, currency: 'CAD', notes: null },
    { kind: 'EXTRA_WEEK' as const, weeks: null, modality: 'Residencia', amount: 900, currency: 'CAD', notes: null },
  ];
  const bli = await repository.updateResource({ resourceId: id(3), minWeeks: 2, maxWeeks: 8, tariffs, locationNames: ['Montreal', 'Quebec'] });
  const second = await repository.createResource({
    countryCode: 'CA', familyKey: 'CAMP', programSlug: 'shared-camp', type: 'BROCHURE', title: 'Montreal residencial',
    description: 'Resumen confirmado', active: true, month: null, year: 2027, seasonKeys: ['SUMMER'],
    minWeeks: 3, maxWeeks: 6, locationNames: ['Montreal'],
    shareFrom: new Date('2026-01-01'), shareUntil: new Date('2027-08-31'),
    validFrom: new Date('2027-07-04'), validUntil: new Date('2027-08-08'),
    initialVersion: { sourceType: 'EXTERNAL_LINK', fileName: 'residence.pdf', externalUrl: 'https://example.com/residence.pdf' },
  });
  assert.equal(second.minWeeks, 3);
  assert.equal((await repository.findResourceById(bli.id))!.maxWeeks, 8);
  assert.equal((await prisma.programRule.findUniqueOrThrow({ where: { programId: id(2) } })).maxWeeks, 2);
  await assert.rejects(() => repository.updateResource({ resourceId: second.id, minWeeks: 7 }));
  const tools = new ConciergeToolExecutorService();
  const montreal = bli.locations.find((location) => location.name === 'Montreal')!;
  const quebec = bli.locations.find((location) => location.name === 'Quebec')!;
  for (const [city, expected] of [[montreal.slug, 2], [quebec.slug, 1]] as const) {
    const result = await tools.execute('list_available_resources', { countryCode: 'CA', familyKey: 'CAMP', locationSlug: city }) as { resources: unknown[] };
    assert.equal(result.resources.length, expected);
  }
  const january = await tools.execute('list_available_resources', { countryCode: 'CA', familyKey: 'CAMP', targetMonth: 1 }) as { resources: unknown[] };
  assert.equal(january.resources.length, 0);
  const inquiry = await prisma.inquiry.create({ data: { conversationId: id(6), countryId: id(1), familyId: (await prisma.productFamily.findUniqueOrThrow({ where: { key: 'CAMP' } })).id } });
  const version = { resourceId: bli.id, versionId: bli.currentVersion!.id };
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => new ResourceSendHistoryService().reserve(inquiry.id, [version], 'first', false)));
  assert.equal(concurrent.flat().length, 1);
  assert.deepEqual(await new ResourceSendHistoryService().pendingVersions(inquiry.id, [version]), []);
  const first = concurrent.flat()[0]!;
  await new ResourceSendHistoryService().recordTransportResult(first.sendId, 'ACCEPTED', 'wamid.bli');
  await prisma.message.create({ data: { conversationId: id(6), direction: 'OUTBOUND', text: 'BLI', metadata: { metaMediaMessageIds: ['wamid.bli'] } } });
  await new MetaWhatsAppStatusService().processStatusCallback({ id: 'wamid.bli', status: 'failed', timestamp: '1' });
  assert.equal((await new ResourceSendHistoryService().pendingVersions(inquiry.id, [version])).length, 1);
  const retry = await new ResourceSendHistoryService().reserve(inquiry.id, [version], 'second', false);
  assert.equal(retry.length, 1);
  await new ResourceSendHistoryService().recordTransportResult(retry[0]!.sendId, 'UNKNOWN', null);
  assert.deepEqual(await new ResourceSendHistoryService().pendingVersions(inquiry.id, [version]), []);
  const explicit = await new ResourceSendHistoryService().reserve(inquiry.id, [version], 'explicit-request', true);
  assert.equal(explicit.length, 1);
  assert.deepEqual(await new ResourceSendHistoryService().reserve(inquiry.id, [version], 'explicit-request', true), []);
  await new ResourceSendHistoryService().recordTransportResult(explicit[0]!.sendId, 'ACCEPTED', 'wamid.retry');
  await new ResourceSendHistoryService().recordStatusCallback('wamid.retry', 'read');
  await new ResourceSendHistoryService().recordStatusCallback('wamid.retry', 'sent');
  await new ResourceSendHistoryService().recordStatusCallback('wamid.retry', 'failed');
  assert.equal((await prisma.inquiryResourceSend.findUniqueOrThrow({ where: { id: explicit[0]!.sendId } })).deliveryStatus, 'READ');
  console.log('PASS: migration preserves contacts, conversations, messages and versions; no inherited durations; independent resource weeks/tariffs; Montreal 2 / Quebec 1; January rejected without year; concurrent and restarted delivery deduplicated; proven failure and explicit request retries; unknown transport outcomes stay blocked.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
