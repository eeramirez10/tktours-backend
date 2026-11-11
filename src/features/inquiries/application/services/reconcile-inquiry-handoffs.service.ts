import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { inquiryProgress, type ProgressInquiry } from '../../domain/services/inquiry-progress.js';
import { conversationRealtimeHub } from '../../../conversations/infrastructure/realtime/conversation-realtime-hub.js';

type Trace = { id: string; inquiryId: string | null; status: string; startedAt: Date; finishedAt: Date | null; structuredResponseJson: unknown };
export function handoffEvidence(input: {
  inquiry: ProgressInquiry & { updatedAt: Date }; currentInquiryId: string | null;
  conversationStatus: string; conversationUpdatedAt: Date; contactUpdatedAt: Date | null;
  lastMessageAt: Date | null; turns: Trace[];
}): { turnId: string; finishedAt: string; reason: string } | null {
  if (input.inquiry.status !== 'OPEN' || input.currentInquiryId !== input.inquiry.id
    || ['CLOSED', 'ARCHIVED'].includes(input.conversationStatus) || !inquiryProgress(input.inquiry).captureComplete) return null;
  const evidence = input.turns.filter((turn) => {
    if (turn.inquiryId !== input.inquiry.id || turn.status !== 'COMPLETED' || !turn.finishedAt) return false;
    const response = turn.structuredResponseJson as { nextStage?: string; shouldAskFollowUp?: boolean;
      lifecycle?: { inquiryId?: string; handoffConfirmed?: boolean }; policyTrace?: { details?: { reason?: string } } } | null;
    if (response?.shouldAskFollowUp !== false || !['ESCALATED', 'CLOSED'].includes(response?.nextStage ?? '')) return false;
    return (response?.lifecycle?.inquiryId === input.inquiry.id && response.lifecycle.handoffConfirmed === true)
      || response?.policyTrace?.details?.reason === 'advisor_handoff_confirm_handoff';
  });
  if (evidence.length !== 1) return null; // Multiple confirmations require a human audit.
  const turn = evidence[0];
  const finishedAt = turn.finishedAt!;
  if ([input.inquiry.updatedAt, input.conversationUpdatedAt, input.contactUpdatedAt, input.lastMessageAt]
    .some((date) => date && date > finishedAt)) return null;
  if (input.turns.some((other) => other.id !== turn.id && other.startedAt > turn.startedAt)) return null;
  return { turnId: turn.id, finishedAt: finishedAt.toISOString(), reason: 'completed_explicit_advisor_handoff' };
}
const include = {
  country: true, family: true, location: true, program: true, accommodationType: true, contact: true,
  conversation: { include: { contact: true, inquiries: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }, conciergeTurns: true } },
} satisfies Prisma.InquiryInclude;
type Candidate = Prisma.InquiryGetPayload<{ include: typeof include }>;
function evidenceFor(record: Candidate) {
  return handoffEvidence({ inquiry: { ...record, qualificationJson: record.qualificationJson as Record<string, unknown> | null,
    contact: record.contact ?? record.conversation.contact }, currentInquiryId: record.conversation.inquiries[0]?.id ?? null,
    conversationStatus: record.conversation.status, conversationUpdatedAt: record.conversation.updatedAt,
    contactUpdatedAt: (record.contact ?? record.conversation.contact)?.updatedAt ?? null,
    lastMessageAt: record.conversation.lastMessageAt, turns: record.conversation.conciergeTurns });
}
export async function reconcileInquiryHandoffs(apply = false) {
  const records = await prisma.inquiry.findMany({ where: { status: 'OPEN', conversation: { status: { notIn: ['CLOSED', 'ARCHIVED'] } } }, include });
  const audit: Array<{ inquiryId: string; conversationId: string; previousStatus: 'OPEN'; newStatus: 'WAITING_HUMAN'; evidence: NonNullable<ReturnType<typeof handoffEvidence>>; applied: boolean }> = [];
  for (const record of records) {
    let evidence = evidenceFor(record);
    if (!evidence) continue;
    if (apply) {
      // Re-read under serializable isolation so preview never authorizes a stale write.
      evidence = await prisma.$transaction(async (tx) => {
        const fresh = await tx.inquiry.findUnique({ where: { id: record.id }, include });
        const proof = fresh ? evidenceFor(fresh) : null;
        if (!fresh || !proof) return null;
        await tx.inquiry.update({ where: { id: fresh.id }, data: { status: 'WAITING_HUMAN', qualificationJson: {
          ...((fresh.qualificationJson as Record<string, unknown> | null) ?? {}),
          handoffReconciliation: { previousStatus: 'OPEN', newStatus: 'WAITING_HUMAN', ...proof, appliedAt: new Date().toISOString() },
        } as Prisma.InputJsonValue } });
        await tx.conversation.update({ where: { id: fresh.conversationId }, data: { currentStage: 'ESCALATED' } });
        return proof;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!evidence) continue;
      conversationRealtimeHub.publish({ type: 'conversation.updated', conversationId: record.conversationId });
    }
    audit.push({ inquiryId: record.id, conversationId: record.conversationId, previousStatus: 'OPEN', newStatus: 'WAITING_HUMAN', evidence, applied: apply });
  }
  return { mode: apply ? 'apply' : 'preview', scanned: records.length, eligible: audit.length, audit };
}
