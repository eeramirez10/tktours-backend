import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretation } from '../../../../scripts/fixtures/concierge-interpretation.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { ConciergeOrchestratorService, type ConciergeTurnContext } from './concierge-orchestrator.service.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';

const offerings = [{ familyKey: 'CAMP', name: 'Campamentos / viajes', programCount: 1, brochureCount: 0 }];
const cities = [{ slug: 'ca-montreal', name: 'Montreal' }, { slug: 'ca-quebec', name: 'Québec' }];
const lead = { id: 'lead', family: { key: 'CAMP' }, country: { code: 'CA' }, studentAge: 16,
  preferredStartMonth: 7, weeks: 3, qualificationJson: { residenceCountry: 'México' }, contact: { id: 'contact' } };

for (const message of ['Para Montreal', 'Me interesa Montreal', '2']) {
  test(`${message}: saves interpreted city before policy, without reinterpreting it as another field`, async () => {
    const updates: Record<string, unknown>[] = [];
    const service = new ConciergeOrchestratorService();
    Object.assign(service, {
      toolExecutor: { execute: async (name: string, args: Record<string, unknown>) => {
        if (name === 'list_available_locations') return { locations: cities };
        if (name === 'list_available_programs') return { programs: cities.map((city) => ({ locationSlug: city.slug, locationName: city.name })) };
        if (name === 'list_available_resources') return { resources: [] };
        assert.equal(name, 'interpret_message');
        assert.equal(args.latestMessage, message);
        assert.deepEqual((args.displayedCityMenu as { options: unknown }).options, [...cities].reverse());
        assert.equal((args.inquirySnapshot as { studentAge: number }).studentAge, 16);
        return interpretation({ locationSlug: 'ca-montreal' });
      } },
      inquiryRepository: { update: async (args: Record<string, unknown>) => { updates.push(args); }, findById: async () => ({ ...lead, location: cities[0] }) },
    });
    const previous = 'Ciudades disponibles:\n1) Québec\n2) Montreal';
    const result = await (service as unknown as { hydrateInquiryFromLatestMessage: (context: unknown) => Promise<ConciergeTurnContext> }).hydrateInquiryFromLatestMessage({
      conversation: { id: 'conversation', contextJson: { cityResourceMenu: { countryCode: 'CA', familyKey: 'CAMP', options: [...cities].reverse(), replyText: previous } },
        messages: [{ id: 'previous', direction: 'OUTBOUND', text: previous }, { id: 'incoming', direction: 'INBOUND', text: message }] },
      activeInquiry: lead, latestMessage: { id: 'incoming', direction: 'INBOUND', text: message }, availableCourseTypes: offerings,
    });
    assert.equal(result.cityWasSelected, true);
    assert.equal(result.activeInquiry?.location?.slug, 'ca-montreal');
    assert.deepEqual(updates, [{ inquiryId: 'lead', locationSlug: 'ca-montreal', programSlug: null }]);
  });
}

test('the interpretation tool requests strict structured output and rejects unknown catalog identifiers', async () => {
  let invalid = false;
  const service = new ConciergeToolExecutorService({ findCountries: async () => [{ code: 'CA', name: 'Canadá' }] } as never, undefined, {
    createTextResponse: async (params: { text: { format: { type: string; strict: boolean; schema: { additionalProperties: boolean } } }; input: string }) => {
      assert.equal(params.text.format.type, 'json_schema');
      assert.equal(params.text.format.strict, true);
      assert.equal(params.text.format.schema.additionalProperties, false);
      assert.deepEqual(JSON.parse(params.input).availableCities, cities);
      return { outputText: JSON.stringify(interpretation({ locationSlug: invalid ? 'invented-city' : 'ca-montreal' })) };
    },
  } as never);
  const args = { latestMessage: 'Para Montreal', recentMessages: [], availableCities: cities, availableCourseTypes: offerings };
  const valid = await service.execute('interpret_message', args) as ReturnType<typeof interpretation>;
  assert.equal(valid.locationSlug, 'ca-montreal');
  invalid = true;
  const rejected = await service.execute('interpret_message', args) as ReturnType<typeof interpretation>;
  assert.equal(rejected.locationSlug, null);
  assert.equal(rejected.needsClarification, true);
});

test('Hola? after asking for the name continues the current inquiry', async () => {
  const service = new ConciergeOrchestratorService();
  Object.assign(service, { buildPromptDrivenFollowUp: async ({ nextField }: { nextField: string }) => {
    assert.equal(nextField, 'contactName');
    return 'Seguimos con tu solicitud. ¿Me compartes tu nombre completo?';
  } });
  const result = await (service as unknown as { applyReplyPolicy: (parsed: unknown, context: unknown, options: unknown) => Promise<{ structured: { replyText: string; nextStage: string }; trace: { details: { reason: string } } }> }).applyReplyPolicy(
    { replyText: 'Bienvenido de nuevo', missingFields: [], nextStage: 'START' },
    { interpretation: interpretation({ intent: 'GREETING' }), activeInquiry: lead, availableCourseTypes: offerings,
      conversation: { currentStage: 'RECOMMEND', messages: [{ id: 'in', direction: 'INBOUND', text: 'Hola?' }, { id: 'out', direction: 'OUTBOUND', text: '¿Me compartes tu nombre completo?' }] }, latestMessage: { id: 'in', text: 'Hola?' } },
    {},
  );
  assert.match(result.structured.replyText, /nombre completo/);
  assert.doesNotMatch(result.structured.replyText, /Bienvenido|explorar|1\)/);
  assert.equal(result.trace.details.reason, 'greeting_continues_active_inquiry');
});

function memoryHarness(t: { after: (fn: () => void) => void }) {
  const original = prisma.conversation.findUnique;
  prisma.conversation.findUnique = (async () => ({ controlMode: 'AI' })) as never;
  t.after(() => { prisma.conversation.findUnique = original; });
  const conversation = { id: 'conversation', controlMode: 'AI', currentStage: 'START', inquiries: [], contact: null,
    contextJson: { openaiResponses: { lastResponseId: 'saved-response' } }, messages: [{ id: 'incoming', direction: 'INBOUND', text: 'Hola?', createdAt: new Date() }] };
  const calls: Array<{ previousResponseId?: string; input: string }> = [];
  const traces: Array<{ toolName?: string; callId?: string }> = [];
  let failure: Error & { status?: number; param?: string };
  const repository = { findById: async () => conversation,
    createMessage: async (args: { text: string }) => { conversation.messages.push({ id: 'outgoing', direction: 'OUTBOUND', text: args.text, createdAt: new Date() }); return conversation; },
    update: async (args: { contextJson: typeof conversation.contextJson }) => { conversation.contextJson = args.contextJson; return conversation; } };
  const makeService = () => new ConciergeOrchestratorService(repository as never, {} as never, {
    getModel: () => 'fake', createTextResponse: async (params: { previousResponseId?: string; input: string }) => {
      calls.push(params);
      if (failure) { const error = failure; failure = undefined as never; throw error; }
      return { id: `response-${calls.length}`, raw: { output: [] }, outputText: JSON.stringify({ replyText: 'Respuesta', shouldAskFollowUp: false, detectedNeed: 'UNKNOWN', missingFields: [], nextStage: 'START', shouldRefreshRecommendations: false }) };
    },
  } as never, { execute: async (name: string) => name === 'list_available_course_types' ? { courseTypes: offerings }
    : name === 'list_available_locations' ? { locations: [] } : name === 'list_available_programs' ? { programs: [] } : interpretation({ intent: 'GREETING' }) } as never,
  { createTurn: async () => ({ id: 'turn' }), createToolCall: async (args: object) => { traces.push(args); }, completeToolCall: async () => {}, failToolCall: async () => {}, completeTurn: async () => {}, failTurn: async () => {} } as never);
  return { conversation, calls, traces, makeService, fail: (error: typeof failure) => { failure = error; } };
}

test('a network error keeps the saved response chain and never retries without it', async (t) => {
  const h = memoryHarness(t);
  h.fail(new Error('Network timeout'));
  await assert.rejects(h.makeService().runTurn({ conversationId: 'conversation', incomingMessageId: 'incoming' }), /Network timeout/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].previousResponseId, 'saved-response');
  assert.equal(h.conversation.contextJson.openaiResponses.lastResponseId, 'saved-response');
  assert.equal(h.conversation.messages.length, 1);
});

test('an explicitly missing previous response rebuilds from saved history and records recovery', async (t) => {
  const h = memoryHarness(t);
  h.fail(Object.assign(new Error('Response not found'), { status: 400, param: 'previous_response_id' }));
  await h.makeService().runTurn({ conversationId: 'conversation', incomingMessageId: 'incoming' });
  assert.deepEqual(h.calls.map((call) => call.previousResponseId), ['saved-response', undefined]);
  assert.match(h.calls[1].input, /Hola\?/);
  assert.ok(h.traces.some((trace) => trace.toolName === 'context_recovery'));
  assert.equal(h.conversation.contextJson.openaiResponses.lastResponseId, 'response-2');
  h.conversation.messages.push({ id: 'next', direction: 'INBOUND', text: 'Hola?', createdAt: new Date() });
  await h.makeService().runTurn({ conversationId: 'conversation', incomingMessageId: 'next' });
  assert.equal(h.calls[2].previousResponseId, 'response-2');
  assert.equal(h.conversation.messages.length, 4);
});

test('ambiguous interpretation asks for clarification without changing captured data', async () => {
  const service = new ConciergeOrchestratorService();
  Object.assign(service, {
    toolExecutor: { execute: async (name: string) => {
      if (name === 'list_available_locations') return { locations: cities };
      if (name === 'list_available_programs') return { programs: [] };
      if (name === 'list_available_resources') return { resources: [] };
      return interpretation({ firstName: 'Guessed', confidence: 0.4, needsClarification: true, clarificationQuestion: '¿A qué opción te refieres?' });
    } },
    inquiryRepository: { update: async () => { throw new Error('Must not mutate the inquiry'); } },
    upsertInquiryContact: async () => { throw new Error('Must not mutate the contact'); },
  });
  const internal = service as unknown as {
    hydrateInquiryFromLatestMessage: (context: unknown) => Promise<ConciergeTurnContext>;
    applyReplyPolicy: (parsed: unknown, context: unknown, options: unknown) => Promise<{ structured: { replyText: string }; outboundMediaUrls: string[] }>;
  };
  const context = await internal.hydrateInquiryFromLatestMessage({ activeInquiry: lead, availableCourseTypes: offerings,
    conversation: { id: 'conversation', messages: [], currentStage: 'RECOMMEND' }, latestMessage: { id: 'incoming', direction: 'INBOUND', text: 'la otra' } });
  assert.equal(context.activeInquiry, lead);
  const result = await internal.applyReplyPolicy({ replyText: 'Guessed answer' }, context, {});
  assert.equal(result.structured.replyText, '¿A qué opción te refieres?');
  assert.deepEqual(result.outboundMediaUrls, []);
});

test('queued context excludes later inbox messages even when their timestamps sort earlier', async () => {
  const messages = [
    { id: 'earlier', direction: 'INBOUND', text: 'Anterior', metadata: { inboxJobId: '1' } },
    { id: 'future', direction: 'INBOUND', text: 'Turno futuro', metadata: { inboxJobId: '3' } },
    { id: 'incoming', direction: 'INBOUND', text: 'Turno actual', metadata: { inboxJobId: '2' } },
    { id: 'reply', direction: 'OUTBOUND', text: 'Respuesta anterior', metadata: null },
  ];
  const service = new ConciergeOrchestratorService({ findById: async () => ({ id: 'conversation', messages, inquiries: [] }) } as never);
  const internal = service as unknown as {
    buildTurnContext: (params: object) => Promise<ConciergeTurnContext>;
    findPreviousOutboundMessage: (context: ConciergeTurnContext) => { text: string };
  };
  const context = await internal.buildTurnContext({ conversationId: 'conversation', incomingMessageId: 'incoming' });
  assert.deepEqual(context.conversation?.messages.map((message) => message.id), ['earlier', 'incoming', 'reply']);
  assert.equal(internal.findPreviousOutboundMessage(context).text, 'Respuesta anterior');
});
