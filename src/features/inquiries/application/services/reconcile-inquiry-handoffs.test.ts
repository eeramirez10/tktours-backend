import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { handoffEvidence, reconcileInquiryHandoffs } from './reconcile-inquiry-handoffs.service.js';
const before = new Date('2026-11-10T10:00:00Z');
const finished = new Date('2026-11-10T10:01:00Z');
const after = new Date('2026-11-10T10:02:00Z');
function candidate(): Parameters<typeof handoffEvidence>[0] {
  return { inquiry: { id: 'inquiry', status: 'OPEN', updatedAt: before, studentAge: 16, preferredStartMonth: 7, weeks: 3,
    qualificationJson: { residenceCountry: 'México' }, family: { key: 'CAMP' }, country: { code: 'CA' },
    contact: { firstName: 'Alex', lastName: 'Meine', email: 'alex@example.com' } }, currentInquiryId: 'inquiry',
    conversationStatus: 'OPEN', conversationUpdatedAt: before, contactUpdatedAt: before, lastMessageAt: before,
    turns: [{ id: 'turn', inquiryId: 'inquiry', status: 'COMPLETED', startedAt: before, finishedAt: finished,
      structuredResponseJson: { nextStage: 'ESCALATED', shouldAskFollowUp: false, policyTrace: { details: { reason: 'advisor_handoff_confirm_handoff' } } } }] };
}
test('completed explicit policy handoff is sufficient evidence for the current complete open inquiry', () => {
  assert.deepEqual(handoffEvidence(candidate()), { turnId: 'turn', finishedAt: finished.toISOString(), reason: 'completed_explicit_advisor_handoff' });
});
test('reconciliation excludes closed, archived, incomplete, ambiguous and subsequently modified records', () => {
  const cases = [
    (c: ReturnType<typeof candidate>) => { c.inquiry.status = 'CLOSED'; },
    (c: ReturnType<typeof candidate>) => { c.conversationStatus = 'ARCHIVED'; },
    (c: ReturnType<typeof candidate>) => { c.conversationStatus = 'CLOSED'; },
    (c: ReturnType<typeof candidate>) => { c.inquiry.contact = null; },
    (c: ReturnType<typeof candidate>) => { c.currentInquiryId = 'new-inquiry'; },
    (c: ReturnType<typeof candidate>) => { c.turns[0].inquiryId = 'other'; },
    (c: ReturnType<typeof candidate>) => { c.turns[0].status = 'FAILED'; },
    (c: ReturnType<typeof candidate>) => { c.turns[0].structuredResponseJson = { nextStage: 'ESCALATED', shouldAskFollowUp: false, replyText: 'Un asesor dará seguimiento' }; },
    (c: ReturnType<typeof candidate>) => { c.turns.push({ ...c.turns[0], id: 'ambiguous' }); },
    (c: ReturnType<typeof candidate>) => { c.turns.push({ ...c.turns[0], id: 'later', startedAt: after, status: 'FAILED' }); },
    (c: ReturnType<typeof candidate>) => { c.inquiry.updatedAt = after; },
    (c: ReturnType<typeof candidate>) => { c.contactUpdatedAt = after; },
    (c: ReturnType<typeof candidate>) => { c.lastMessageAt = after; },
    (c: ReturnType<typeof candidate>) => { c.conversationUpdatedAt = after; },
  ];
  for (const change of cases) { const c = candidate(); change(c); assert.equal(handoffEvidence(c), null); }
});
test('preview makes no changes; apply corrects once, preserving captured data and conversation control', async (t) => {
  const c = candidate();
  const record: any = { ...c.inquiry, conversationId: 'conversation', conversation: {
    id: 'conversation', status: 'OPEN', controlMode: 'AI', updatedAt: before, lastMessageAt: before,
    inquiries: [{ id: 'inquiry' }], conciergeTurns: c.turns, contact: { updatedAt: before } },
    contact: { ...c.inquiry.contact, updatedAt: before } };
  const originalMany = prisma.inquiry.findMany; const originalTx = prisma.$transaction;
  t.after(() => { prisma.inquiry.findMany = originalMany; prisma.$transaction = originalTx; });
  prisma.inquiry.findMany = (async () => record.status === 'OPEN' ? [record] : []) as never;
  let writes = 0;
  prisma.$transaction = (async (fn: any) => fn({ inquiry: { findUnique: async () => record, update: async ({ data }: any) => { Object.assign(record, data); writes++; } },
    conversation: { update: async ({ data }: any) => { Object.assign(record.conversation, data); } } })) as never;
  assert.equal((await reconcileInquiryHandoffs()).eligible, 1); assert.equal(writes, 0);
  assert.equal((await reconcileInquiryHandoffs(true)).audit[0]?.applied, true);
  assert.equal((await reconcileInquiryHandoffs(true)).eligible, 0); assert.equal(writes, 1);
  assert.equal(record.status, 'WAITING_HUMAN'); assert.equal(record.qualificationJson.residenceCountry, 'México');
  assert.equal(record.conversation.status, 'OPEN'); assert.equal(record.conversation.controlMode, 'AI');
  assert.equal(record.qualificationJson.handoffReconciliation.turnId, 'turn');
});
