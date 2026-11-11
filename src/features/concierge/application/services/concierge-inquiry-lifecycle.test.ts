import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { interpretation } from '../../../../scripts/fixtures/concierge-interpretation.js';
import { ConciergeOrchestratorService } from './concierge-orchestrator.service.js';
function harness(t: { after: (callback: () => void) => void }) {
  const original = prisma.conversation.findUnique;
  prisma.conversation.findUnique = (async () => ({ controlMode: 'AI' })) as never;
  t.after(() => { prisma.conversation.findUnique = original; });
  let lead: any = { id: 'inquiry', status: 'OPEN', country: { code: 'CA' }, family: { key: 'CAMP' }, studentAge: 16,
    preferredStartMonth: 7, preferredStartYear: null, weeks: 3, qualificationJson: { residenceCountry: 'México' },
    contact: { firstName: 'Alex', lastName: 'Meine', email: null } };
  const conversation: any = { id: 'conversation', status: 'OPEN', currentStage: 'RECOMMEND', controlMode: 'AI', contextJson: {},
    messages: [{ id: 'previous', direction: 'OUTBOUND', text: '¿Me compartes tu correo?', createdAt: new Date() }], inquiries: [{ id: lead.id, status: lead.status }] };
  let extracted = interpretation(); let failure = false; let persisted = 0;
  const traces: any[] = [];
  const repository: any = { findById: async () => ({ ...conversation, inquiries: [{ id: lead.id, status: lead.status }], currentInquiry: lead }),
    persistConciergeOutcome: async (args: any) => {
      persisted++; lead.status = args.inquiryStatus; conversation.currentStage = args.nextStage;
      if (args.explicitlyClosed) conversation.status = 'CLOSED';
      conversation.contextJson = args.contextJson;
      conversation.messages.push({ id: `out-${persisted}`, direction: 'OUTBOUND', text: args.replyText, metadata: args.metadata, createdAt: new Date() });
    } };
  const inquiries: any = { findById: async () => lead, update: async ({ inquiryId, ...data }: any) => { Object.assign(lead, data); },
    updateStatus: async ({ status }: any) => { lead.status = status; } };
  const model: any = { getModel: () => 'fake', createTextResponse: async () => {
    if (failure) throw new Error('AI unavailable');
    return { id: 'response', raw: { output: [] }, outputText: JSON.stringify({ replyText: 'Respuesta', detectedNeed: 'UNKNOWN', shouldAskFollowUp: false, missingFields: [], nextStage: 'CLOSED', shouldRefreshRecommendations: false }) };
  } };
  const tools: any = { execute: async (name: string) => name === 'list_available_course_types' ? { courseTypes: [{ familyKey: 'CAMP', name: 'Campamentos', programCount: 1, brochureCount: 0 }] }
    : name === 'list_available_locations' ? { locations: [] } : name === 'list_available_programs' ? { programs: [] }
    : name === 'list_available_resources' ? { resources: [] } : name === 'interpret_message' ? extracted : {} };
  const trace: any = { createTurn: async () => ({ id: 'turn' }), createToolCall: async () => {}, completeToolCall: async () => {}, failToolCall: async () => {},
    completeTurn: async (args: any) => { traces.push(args); }, failTurn: async () => {} };
  const make = () => {
    const service = new ConciergeOrchestratorService(repository, inquiries, model, tools, trace);
    Object.assign(service, {
    applyCityResourceFlow: async () => null, resolveCampBrochureState: async () => ({ state: null, contextPatch: null }),
    buildPromptDrivenFollowUp: async ({ nextField }: any) => `Capturando ${nextField}`,
    buildPromptDrivenHandoffConfirmation: async () => 'Un asesor dará seguimiento a tu solicitud.',
    upsertInquiryContact: async ({ contactUpdate }: any) => { lead.contact = { ...lead.contact, ...contactUpdate }; },
    });
    return service;
  };
  let counter = 0;
  return { get lead() { return lead; }, conversation, traces, make, setFailure: () => { failure = true; },
    turn: async (fields: Parameters<typeof interpretation>[0], service = make()) => {
      extracted = interpretation(fields); const id = `in-${++counter}`;
      conversation.messages.push({ id, direction: 'INBOUND', text: 'Mensaje del prospecto', createdAt: new Date() });
      return service.runTurn({ conversationId: conversation.id, incomingMessageId: id });
    } };
}
test('asking for contact stays in capture; confirming handoff persists WAITING_HUMAN and keeps conversation and AI open', async (t) => {
  const h = harness(t);
  const first = await h.turn({ handoffStep: 'ask_email' });
  assert.equal(h.lead.status, 'READY_TO_RECOMMEND');
  assert.equal(first.persistedConversation.currentStage, 'RECOMMEND');
  assert.equal(h.conversation.messages.at(-1).metadata.lifecycle.handoffConfirmed, false);
  const second = await h.turn({ email: 'alex@example.com', handoffStep: 'confirm_handoff' });
  assert.equal(second.persistedConversation.currentInquiry?.status, 'WAITING_HUMAN');
  assert.equal(h.conversation.currentStage, 'ESCALATED'); assert.equal(h.conversation.status, 'OPEN');
  assert.equal(h.conversation.controlMode, 'AI');
  assert.equal(h.conversation.messages.at(-1).metadata.lifecycle.handoffConfirmed, true);
  assert.equal(h.traces.at(-1).structuredResponseJson.lifecycle.handoffConfirmed, true);
  await h.turn({ intent: 'GREETING' }, h.make());
  await h.turn({ weeks: 8 });
  await h.turn({ isQuestion: true });
  assert.equal(h.lead.weeks, 8); assert.equal(h.lead.status, 'WAITING_HUMAN');
  assert.equal(h.conversation.status, 'OPEN'); assert.equal(h.conversation.currentStage, 'ESCALATED');
  await h.turn({ intent: 'CLOSE' });
  assert.equal(h.lead.status, 'CLOSED'); assert.equal(h.conversation.status, 'CLOSED');
});
test('a failure after interpretation preserves captured preferences, contact and saved progress', async (t) => {
  const h = harness(t); h.lead.country = null; h.lead.family = null; h.lead.studentAge = null;
  h.lead.weeks = null; h.lead.preferredStartMonth = null; h.lead.qualificationJson = null; h.setFailure();
  await assert.rejects(h.turn({ studentAge: 17, email: 'alex@example.com' }), /AI unavailable/);
  assert.equal(h.lead.studentAge, 17); assert.equal(h.lead.contact.email, 'alex@example.com');
  assert.equal(h.lead.status, 'QUALIFYING'); assert.equal(h.conversation.status, 'OPEN');
  assert.equal(h.conversation.messages.filter((message: any) => message.direction === 'OUTBOUND').length, 1);
});
test('complete capture with undecided dates confirms advisor follow-up without inventing a recommendation', async (t) => {
  const h = harness(t);
  await h.turn({ preferredStartUndecided: true, weeksUndecided: true, email: 'alex@example.com' });
  assert.equal(h.lead.status, 'WAITING_HUMAN'); assert.equal(h.lead.preferredStartMonth, null); assert.equal(h.lead.weeks, null);
  assert.equal(h.lead.qualificationJson.preferredStartStatus, 'UNDECIDED');
  assert.equal(h.conversation.contextJson.resourceRecommendation, undefined);
});
