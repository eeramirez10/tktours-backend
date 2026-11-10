import assert from 'node:assert/strict';
import test from 'node:test';

import { ConciergeOrchestratorService, type ConciergeTurnContext } from './concierge-orchestrator.service.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';

const country = { code: 'CH', name: 'Suiza', active: true };

test('destination overview filters by family and includes resource summaries', async () => {
  const filters: unknown[] = [];
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    catalogRepository: {
      findCountries: () => Promise<typeof country[]>;
      findPrograms: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    listAvailableResources: (args: unknown) => Promise<{ resources: Array<Record<string, unknown>> }>;
    listDestinationOverview: (args: { familyKey: 'CAMP' }) => Promise<{
      destinations: Array<{
        countryCode: string;
        cities: string[];
        brochureCount: number;
        programs: Array<{ seasonKeys: string[] }>;
        resources: Array<{ summary: string | null; priceFrom: number | null }>;
      }>;
    }>;
  };
  executor.catalogRepository = {
    findCountries: async () => [country],
    findPrograms: async (args) => {
      filters.push(args);
      return [{
        slug: 'swiss-camp', name: 'Camp Suiza', description: 'Campamento de verano',
        country, family: { key: 'CAMP' }, location: null,
        minAge: 7, maxAge: 17, minWeeks: 1, maxWeeks: 4,
        seasonKeys: ['SUMMER', 'WINTER'],
      }];
    },
  };
  executor.listAvailableResources = async (args) => {
    filters.push(args);
    return { resources: [{
      id: 'resource-1', title: 'Folleto Suiza', type: 'BROCHURE',
      countryCode: 'CH', familyKey: 'CAMP', programName: 'Camp Suiza',
      programSlug: 'swiss-camp', seasonKeys: ['SUMMER'],
      locationNames: ['Zúrich'], locationName: 'Zúrich',
      description: 'Campamento en Zúrich', currentVersion: { summary: 'Actividades y alojamiento' },
      minAge: 7, maxAge: 17, minWeeks: 1, maxWeeks: 4,
      validFrom: null, validUntil: null, priceFrom: 1200,
      priceCurrency: 'CHF', priceUnit: 'semana',
    }] };
  };

  const result = await executor.listDestinationOverview({ familyKey: 'CAMP' });
  assert.equal(result.destinations.length, 1);
  assert.equal(result.destinations[0]?.countryCode, 'CH');
  assert.deepEqual(result.destinations[0]?.cities, ['Zúrich']);
  assert.equal(result.destinations[0]?.brochureCount, 1);
  assert.deepEqual(result.destinations[0]?.programs[0]?.seasonKeys, ['SUMMER']);
  assert.equal(result.destinations[0]?.resources[0]?.summary, 'Campamento en Zúrich');
  assert.equal(result.destinations[0]?.resources[0]?.priceFrom, 1200);
  assert.equal(filters.every((args) => (args as { familyKey?: string }).familyKey === 'CAMP'), true);
});

test('resource age filters use the resource bound before the program bound', () => {
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    resourceAgeCompatibilityFilters: (age: number) => unknown[];
  };
  assert.deepEqual(executor.resourceAgeCompatibilityFilters(16), [
    {
      OR: [
        { minAge: { lte: 16 } },
        { minAge: null, OR: [
          { programId: null },
          { program: { OR: [{ minAge: null }, { minAge: { lte: 16 } }] } },
        ] },
      ],
    },
    {
      OR: [
        { maxAge: { gte: 16 } },
        { maxAge: null, OR: [
          { programId: null },
          { program: { OR: [{ maxAge: null }, { maxAge: { gte: 16 } }] } },
        ] },
      ],
    },
  ]);
});

test('program listing exposes the resource-derived seasons without inheriting legacy windows', async () => {
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    catalogRepository: { findPrograms: () => Promise<Array<Record<string, unknown>>> };
    listAvailablePrograms: (args: { countryCode: string }) => Promise<{ programs: Array<{ seasonKeys: string[] }> }>;
  };
  executor.catalogRepository = { findPrograms: async () => [{
    slug: 'swiss-camp', name: 'BLI', family: { key: 'CAMP', name: 'Campamentos' },
    country, location: null, seasonKeys: ['EASTER'], startWindows: [{ seasonKey: 'WINTER' }],
  }] };
  const result = await executor.listAvailablePrograms({ countryCode: 'CH' });
  assert.deepEqual(result.programs[0]?.seasonKeys, ['EASTER']);
});

test('an unpriced camp brochure is offered without mentioning a price', async () => {
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    responsesClient: { createTextResponse: () => Promise<never> };
    buildPromptDrivenCampBrochureOffer: (params: {
      context: ConciergeTurnContext;
      candidates: Array<Record<string, unknown>>;
    }) => Promise<string>;
  };
  orchestrator.responsesClient = {
    createTextResponse: async () => { throw new Error('No model call expected for unpriced brochures'); },
  };
  const reply = await orchestrator.buildPromptDrivenCampBrochureOffer({
    context: {} as ConciergeTurnContext,
    candidates: [{
      resourceTitle: 'Campamento Montreal', countryName: 'Canadá', seasonKeys: ['SUMMER'],
      priceFrom: 1500, priceCurrency: null,
    }],
  });
  assert.match(reply, /folleto disponible para Canadá en verano/);
  assert.doesNotMatch(reply, /1500|desde|precio/i);
});

test('catalog program tools do not expose camp prices independently of brochures', async () => {
  const pricedProgram = { family: { key: 'CAMP' }, prices: [{ amountFrom: '1500', currency: 'CAD' }] };
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    catalogRepository: {
      findProgramBySlug: () => Promise<typeof pricedProgram>;
      findRecommendedPrograms: () => Promise<typeof pricedProgram[]>;
    };
    getProgramDetail: (args: { slug: string }) => Promise<typeof pricedProgram>;
    findMatchingPrograms: (args: { countryCode: string }) => Promise<typeof pricedProgram[]>;
  };
  executor.catalogRepository = {
    findProgramBySlug: async () => pricedProgram,
    findRecommendedPrograms: async () => [pricedProgram],
  };

  const detail = await executor.getProgramDetail({ slug: 'canada-camp' });
  const recommendations = await executor.findMatchingPrograms({ countryCode: 'CA' });
  assert.deepEqual(detail.prices, []);
  assert.deepEqual(recommendations[0]?.prices, []);
});

test('a camp price question only uses a complete price from a compatible brochure', async () => {
  let resources: Array<Record<string, unknown>> = [{ priceFrom: 1500, priceCurrency: null }];
  const calls: unknown[] = [];
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: (name: string, args: unknown) => Promise<{ resources: Array<Record<string, unknown>> }> };
    buildConfirmedCampPriceAnswer: (context: ConciergeTurnContext) => Promise<string>;
    isCampPriceQuestion: (context: ConciergeTurnContext) => boolean;
  };
  orchestrator.toolExecutor = {
    execute: async (name, args) => {
      assert.equal(name, 'list_available_resources');
      calls.push(args);
      return { resources };
    },
  };
  const context = {
    activeInquiry: {
      family: { key: 'CAMP' }, country: { code: 'CA', name: 'Canadá' },
      studentAge: 15, program: { slug: 'canada-camp' }, location: null,
    },
    latestMessage: { text: '¿Cuánto cuesta el campamento?' },
  } as unknown as ConciergeTurnContext;

  assert.equal(orchestrator.isCampPriceQuestion(context), true);
  const unpriced = await orchestrator.buildConfirmedCampPriceAnswer(context);
  assert.doesNotMatch(unpriced, /1500|desde/i);

  resources = [{ priceFrom: 1500, priceCurrency: 'CAD', priceUnit: 'semana' }];
  const priced = await orchestrator.buildConfirmedCampPriceAnswer(context);
  assert.match(priced, /desde 1,500 CAD por semana/);
  assert.deepEqual(calls[0], {
    activeOnly: true, familyKey: 'CAMP', type: 'BROCHURE', countryCode: 'CA',
    programSlug: 'canada-camp', studentAge: 15,
  });
});

test('field extraction accepts active countries beyond the former fixed list', async () => {
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    catalogRepository: { findCountries: () => Promise<typeof country[]> };
    askJson: () => Promise<Record<string, unknown>>;
    extractInquiryFields: (args: { latestMessage: string }) => Promise<{ countryCode: string | null }>;
  };
  executor.catalogRepository = { findCountries: async () => [country] };
  executor.askJson = async () => ({ countryCode: 'CH', confidence: 1 });

  const result = await executor.extractInquiryFields({ latestMessage: 'Me interesa Suiza' });
  assert.equal(result.countryCode, 'CH');
});

test('field extraction asks for explicit contact names even outside the name step', async () => {
  let extractionPrompt = '';
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    catalogRepository: { findCountries: () => Promise<typeof country[]> };
    askJson: (prompt: string) => Promise<Record<string, unknown>>;
    extractInquiryFields: (args: { latestMessage: string; expectedField: 'studentAge' }) => Promise<{
      firstName: string | null;
      lastName: string | null;
      studentAge: number | null;
    }>;
  };
  executor.catalogRepository = { findCountries: async () => [country] };
  executor.askJson = async (prompt) => {
    extractionPrompt = prompt;
    return { firstName: 'María Fernanda', lastName: 'López', studentAge: 16, confidence: 1 };
  };

  const result = await executor.extractInquiryFields({
    latestMessage: 'Soy María Fernanda López y tengo 16 años',
    expectedField: 'studentAge',
  });
  assert.match(extractionPrompt, /spontaneous self-introductions/);
  assert.deepEqual([result.firstName, result.lastName, result.studentAge], ['María Fernanda', 'López', 16]);
});

test('a self-introduction updates the conversation contact before an inquiry exists', async () => {
  const updates: Array<Record<string, unknown>> = [];
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: (name: string) => Promise<Record<string, unknown>> };
    upsertInquiryContact: (input: Record<string, unknown>) => Promise<void>;
    hydrateInquiryFromLatestMessage: (context: ConciergeTurnContext) => Promise<ConciergeTurnContext>;
  };
  orchestrator.toolExecutor = {
    execute: async (name) => {
      assert.equal(name, 'extract_inquiry_fields');
      return { firstName: 'Alex', lastName: 'Meine' };
    },
  };
  orchestrator.upsertInquiryContact = async (input) => { updates.push(input); };
  const context = {
    conversation: { id: 'conversation-1', contact: { id: 'contact-1' }, messages: [] },
    activeInquiry: null,
    latestMessage: { id: 'message-1', direction: 'INBOUND', text: 'Me llamo Alex Meine', createdAt: new Date() },
  } as unknown as ConciergeTurnContext;

  const result = await orchestrator.hydrateInquiryFromLatestMessage(context);
  assert.equal(result.activeInquiry, null);
  assert.deepEqual(updates, [{
    inquiryId: null,
    conversationId: 'conversation-1',
    contactId: 'contact-1',
    contactUpdate: { firstName: 'Alex', lastName: 'Meine' },
  }]);
});

test('a turn can query destinations and then a brochure before answering', async () => {
  const call = (id: string, name: string) => ({
    id,
    outputText: '',
    raw: { output: [{ type: 'function_call', name, call_id: id, arguments: '{}' }] },
  });
  const previousResponseIds: string[] = [];
  const toolNames: string[] = [];
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    responsesClient: { createTextResponse: (args: { previousResponseId?: string; tools?: unknown[] }) => Promise<unknown> };
    toolExecutor: { execute: (name: string) => Promise<Record<string, unknown>> };
    turnTraceRepository: {
      createToolCall: () => Promise<void>;
      completeToolCall: () => Promise<void>;
      failToolCall: () => Promise<void>;
    };
    completeToolCalls: (response: unknown, turnId: string) => Promise<{
      response: { outputText: string };
      usedToolNames: Set<string>;
    }>;
  };
  orchestrator.responsesClient = {
    createTextResponse: async (args) => {
      previousResponseIds.push(args.previousResponseId ?? '');
      assert.ok(args.tools?.length);
      return previousResponseIds.length === 1
        ? call('response-2', 'list_available_resources')
        : { id: 'response-3', outputText: '{"replyText":"Tenemos opciones en Suiza"}', raw: { output: [] } };
    },
  };
  orchestrator.toolExecutor = {
    execute: async (name) => {
      toolNames.push(name);
      return { destinations: [] };
    },
  };
  orchestrator.turnTraceRepository = {
    createToolCall: async () => {},
    completeToolCall: async () => {},
    failToolCall: async () => {},
  };

  const result = await orchestrator.completeToolCalls(call('response-1', 'list_destination_overview'), 'turn-1');
  assert.deepEqual(previousResponseIds, ['response-1', 'response-2']);
  assert.deepEqual(toolNames, ['list_destination_overview', 'list_available_resources']);
  assert.equal(result.response.outputText, '{"replyText":"Tenemos opciones en Suiza"}');
  assert.equal(result.usedToolNames.has('list_available_resources'), true);
});

test('an intermediate customer question keeps the answer instead of forcing the missing age', async () => {
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: (name: string) => Promise<Record<string, unknown>> };
    responsesClient: { createTextResponse: () => Promise<{ outputText: string }> };
    applyReplyPolicy: (parsed: Record<string, unknown>, context: unknown, options: unknown) => Promise<{
      structured: { replyText: string; missingFields: string[] };
      trace: { details?: Record<string, unknown> };
    }>;
  };
  Object.assign(orchestrator, { applyCityResourceFlow: async () => null });
  orchestrator.toolExecutor = {
    execute: async (name) => name === 'detect_user_intent'
      ? { intent: 'ASK_AVAILABLE_PROGRAMS' }
      : { menuWasShown: true, handoffStep: 'none', confidence: 0.9 },
  };
  orchestrator.responsesClient = {
    createTextResponse: async () => ({ outputText: '¿Qué edad tiene el estudiante?' }),
  };
  const context = {
    conversation: {
      currentStage: 'QUALIFY_AGE',
      contextJson: { cityResourceDelivery: { countryCode: 'CH', familyKey: 'LANGUAGE_COURSE', locationSlug: 'zurich', versionIds: [] } },
      messages: [{ id: 'message-1', direction: 'INBOUND', text: '¿Qué incluye el campamento?', createdAt: new Date() }],
    },
    latestMessage: { id: 'message-1', direction: 'INBOUND', text: '¿Qué incluye el campamento?', createdAt: new Date() },
    activeInquiry: {
      id: 'inquiry-1', family: { key: 'LANGUAGE_COURSE' }, country: { code: 'CH' },
      location: { slug: 'zurich' },
      studentAge: null, qualificationJson: {},
    },
  };
  const parsed = {
    replyText: 'El folleto indica que incluye alojamiento y actividades.',
    replyIntent: 'ANSWER_QUESTION',
    detectedNeed: 'LANGUAGE_COURSE',
    missingFields: ['studentAge'],
    shouldAskFollowUp: false,
    nextStage: 'QUALIFY_AGE',
  };

  const result = await orchestrator.applyReplyPolicy(parsed, context, { resourceContentSearchUsed: true, dataToolUsed: true });
  assert.equal(result.structured.replyText, parsed.replyText);
  assert.deepEqual(result.structured.missingFields, []);
  assert.equal(result.trace.details?.reason, 'answer_customer_question');

  orchestrator.toolExecutor.execute = async (name) => name === 'detect_user_intent'
    ? { intent: 'UNKNOWN' }
    : { menuWasShown: true, handoffStep: 'none', confidence: 0.9 };
  const followUp = await orchestrator.applyReplyPolicy({
    ...parsed,
    replyIntent: 'CONTINUE_FLOW',
    replyText: 'Continuamos con tu solicitud.',
  }, context, { resourceContentSearchUsed: false, dataToolUsed: false });
  assert.equal(followUp.structured.replyText, '¿Qué edad tiene el estudiante?');
  assert.deepEqual(followUp.structured.missingFields, ['studentAge']);

  const queriedTools: string[] = [];
  orchestrator.toolExecutor.execute = async (name) => {
    queriedTools.push(name);
    if (name === 'detect_user_intent') return { intent: 'ASK_AVAILABLE_PROGRAMS' };
    if (name === 'evaluate_policy_signals') return { menuWasShown: true, handoffStep: 'none' };
    if (name === 'list_destination_overview') return { destinations: [{ countryName: 'Suiza' }] };
    return { matches: [{ excerpt: 'Incluye alojamiento' }] };
  };
  orchestrator.responsesClient.createTextResponse = async () => ({ outputText: 'El folleto confirma alojamiento.' });
  const grounded = await orchestrator.applyReplyPolicy(parsed, context, {
    resourceContentSearchUsed: false,
    dataToolUsed: false,
  });
  assert.equal(grounded.structured.replyText, 'El folleto confirma alojamiento.');
  assert.deepEqual(queriedTools.slice(-2), ['list_destination_overview', 'search_resource_content']);
});

test('extra-week and package answers preserve registered duration and modality without arithmetic', async () => {
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: (name: string, args: unknown) => Promise<unknown> };
    buildConfirmedTariffAnswer: (context: unknown) => Promise<string>;
  };
  orchestrator.toolExecutor = { execute: async () => ({ matches: [{ resourceTitle: 'BLI', tariffs: [
    { kind: 'PACKAGE', weeks: 2, modality: 'Residencia', amount: 2800, currency: 'CAD' },
    { kind: 'PACKAGE', weeks: 3, modality: 'Residencia', amount: 4000, currency: 'CAD' },
    { kind: 'EXTRA_WEEK', weeks: null, modality: 'Residencia', amount: 900, currency: 'CAD' },
    { kind: 'EXTRA_WEEK', weeks: null, modality: 'Familia', amount: 700, currency: 'CAD' },
  ] }] }) };
  const context = (text: string) => ({ activeInquiry: { id: 'inquiry' }, latestMessage: { text } });
  const extra = await orchestrator.buildConfirmedTariffAnswer(context('¿Cuánto cuesta una semana adicional?'));
  assert.match(extra, /900 CAD por semana adicional, modalidad Residencia/);
  assert.match(extra, /700 CAD por semana adicional, modalidad Familia/);
  assert.doesNotMatch(extra, /3 semanas|3,700|4,000|2,800/);
  const three = await orchestrator.buildConfirmedTariffAnswer(context('¿Cuál es el precio del paquete de tres semanas?'));
  assert.match(three, /4,000 CAD por el paquete de 3 semanas/);
  assert.doesNotMatch(three, /3,700|900|2,800/);
  const absent = await orchestrator.buildConfirmedTariffAnswer(context('Precio del paquete de 4 semanas'));
  assert.match(absent, /No tengo una tarifa confirmada/);
  assert.doesNotMatch(absent, /4,900|4,000|900/);
});
