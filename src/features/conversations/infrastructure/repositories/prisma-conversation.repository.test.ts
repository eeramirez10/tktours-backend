import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { env } from '../../../../shared/config/env.js';
import { PrismaConversationRepository } from './prisma-conversation.repository.js';
const now = new Date('2026-11-10T10:00:00Z');
const v1 = { id: '11111111-1111-4111-8111-111111111111', resourceId: 'resource-1', versionNumber: 1, fileName: 'Folleto histórico.pdf', fileUrl: '/api/versions/11111111-1111-4111-8111-111111111111/download', resource: { id: 'resource-1', title: 'Montreal histórico' } };
const v2 = { id: '22222222-2222-4222-8222-222222222222', resourceId: 'resource-2', versionNumber: 2, fileName: 'Folleto actual.pdf', fileUrl: '/api/versions/22222222-2222-4222-8222-222222222222/download', resource: { id: 'resource-2', title: 'Quebec actual' } };
const absolute = (path: string) => `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}${path}`;
function record(): any {
  const inquiry = { id: 'inquiry', status: 'WAITING_HUMAN', studentAge: 16, country: { code: 'CA', name: 'Canadá' }, family: { key: 'CAMP', name: 'Campamentos' }, location: null, program: null,
    accommodationType: null, contact: null, qualificationJson: { residenceCountry: 'México', preferredStartStatus: 'UNDECIDED', weeksStatus: 'UNDECIDED', tripDays: 12 },
    preferredStartMonth: null, preferredStartYear: null, weeks: null, notes: 'Conservar notas', createdAt: now, updatedAt: now, recommendations: [],
    resourceSends: [
      { id: 'legacy', resourceId: v1.resourceId, resourceVersionId: null, resourceVersion: null, resource: v1.resource, sentAt: now, deliveryStatus: 'UNKNOWN' },
      { id: 'reserved', resourceId: v2.resourceId, resourceVersionId: v2.id, resourceVersion: v2, resource: v2.resource, sentAt: now, deliveryStatus: 'RESERVED' },
      { id: 'failed', resourceId: 'resource-3', resourceVersionId: null, resourceVersion: null, resource: { title: 'Intento fallido' }, sentAt: now, deliveryStatus: 'FAILED' },
    ] };
  return { id: 'conversation', channel: 'WHATSAPP', status: 'OPEN', controlMode: 'AI', currentStage: 'ESCALATED', contextJson: {}, lastMessageAt: now,
    contact: { id: 'contact', firstName: 'Alex', lastName: 'Meine', email: 'alex@example.com', waId: '5215500001111', phone: null, notes: 'Notas de contacto' },
    inquiries: [inquiry], createdAt: now, updatedAt: now, _count: { inquiries: 1, messages: 2, conciergeTurns: 0 },
    messages: [
      { id: 'old-request', direction: 'OUTBOUND', mediaUrl: 'https://example.com/previous-request.pdf', metadata: null, createdAt: new Date(now.getTime() - 1000) },
      { id: 'multiple', direction: 'OUTBOUND', mediaUrl: absolute(v1.fileUrl), metadata: { mediaUrls: [absolute(v1.fileUrl), absolute(v2.fileUrl)], metaMediaStatuses: ['ACCEPTED', 'FAILED_TO_REQUEST'] }, createdAt: now },
    ] };
}
test('detail resolves every attachment in a message using historical versions and keeps delivery attempts distinct', async (t) => {
  const originals = { conversation: prisma.conversation.findUnique, versions: prisma.resourceVersion.findMany };
  t.after(() => { prisma.conversation.findUnique = originals.conversation; prisma.resourceVersion.findMany = originals.versions; });
  prisma.conversation.findUnique = (async () => record()) as never;
  prisma.resourceVersion.findMany = (async () => [v1, v2]) as never;
  const detail = await new PrismaConversationRepository().findById('conversation');
  assert.equal(detail?.files.length, 3);
  assert.equal(detail?.files[0].title, 'Montreal histórico'); assert.equal(detail?.files[0].versionNumber, 1);
  assert.equal(detail?.files[0].fileName, 'Folleto histórico.pdf'); assert.equal(detail?.files[0].deliveryStatus, 'ACCEPTED');
  assert.equal(detail?.files[1].deliveryStatus, 'RESERVED'); assert.equal(detail?.files[2].deliveryStatus, 'FAILED');
  assert.equal(detail?.files.some((file) => file.delivered), false);
  assert.equal(detail?.currentInquiry?.progress.percent, 100);
  assert.equal(detail?.currentInquiry?.preferredStartYear, null); assert.equal(detail?.contact?.phone, null);
});
test('legacy attachments without send records use independent media results and are all accessible', async (t) => {
  const originals = { conversation: prisma.conversation.findUnique, versions: prisma.resourceVersion.findMany };
  t.after(() => { prisma.conversation.findUnique = originals.conversation; prisma.resourceVersion.findMany = originals.versions; });
  const r = record(); r.inquiries[0].resourceSends = [];
  prisma.conversation.findUnique = (async () => r) as never;
  prisma.resourceVersion.findMany = (async () => [v1, v2]) as never;
  const detail = await new PrismaConversationRepository().findById('conversation');
  assert.deepEqual(detail?.files.map((file) => file.deliveryStatus), ['ACCEPTED', 'FAILED']);
  assert.deepEqual(detail?.files.map((file) => file.url), [absolute(v1.fileUrl), absolute(v2.fileUrl)]);
});
test('prospect filter uses only the latest request and preserves conversation filters', async (t) => {
  const original = prisma.conversation.findMany;
  t.after(() => { prisma.conversation.findMany = original; });
  let where: any;
  prisma.conversation.findMany = (async (query: any) => { where = query.where; return [record()]; }) as never;
  const repo = new PrismaConversationRepository();
  assert.equal((await repo.findMany({ status: 'OPEN', inquiryStatus: 'WAITING_HUMAN' })).length, 1);
  assert.equal(where.status, 'OPEN');
  assert.equal((await repo.findMany({ inquiryStatus: 'QUALIFYING' })).length, 0);
});
test('handoff outcome writes inquiry, response evidence and conversation stage inside one transaction', async (t) => {
  const original = prisma.$transaction; const writes: any[] = [];
  t.after(() => { prisma.$transaction = original; });
  prisma.$transaction = (async (callback: any) => callback({ inquiry: { update: async (args: any) => writes.push(['inquiry', args]) },
    message: { create: async (args: any) => writes.push(['message', args]) }, conversation: { update: async (args: any) => writes.push(['conversation', args]) } })) as never;
  await new PrismaConversationRepository().persistConciergeOutcome({ conversationId: 'conversation', inquiryId: 'inquiry', inquiryStatus: 'WAITING_HUMAN',
    nextStage: 'ESCALATED', explicitlyClosed: false, contextJson: {}, replyText: 'Un asesor dará seguimiento.', mediaUrl: null,
    metadata: { lifecycle: { inquiryId: 'inquiry', handoffConfirmed: true } } });
  assert.equal(writes[0][1].data.status, 'WAITING_HUMAN');
  assert.equal(writes[1][1].data.metadata.lifecycle.handoffConfirmed, true);
  assert.equal(writes[2][1].data.currentStage, 'ESCALATED'); assert.equal(writes[2][1].data.status, undefined);
  assert.equal(writes[2][1].data.controlMode, undefined);
});
