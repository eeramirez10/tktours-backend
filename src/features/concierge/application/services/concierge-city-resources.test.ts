import { interpretation } from '../../../../scripts/fixtures/concierge-interpretation.js';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { ConciergeCityResourcesService } from './concierge-city-resources.service.js';
import { ConciergeOrchestratorService } from './concierge-orchestrator.service.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';
import { ResourceDeliveryGuardService } from '../../../resources/application/services/resource-delivery-guard.service.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

let sends: Array<{ id: string; resourceId: string; resourceVersionId: string; deliveryStatus: string }> = [];
const originalSends = { findMany: prisma.inquiryResourceSend.findMany, findFirst: prisma.inquiryResourceSend.findFirst, createMany: prisma.inquiryResourceSend.createMany };
afterEach(() => { Object.assign(prisma.inquiryResourceSend, originalSends); });
beforeEach(() => {
  sends = [];
  prisma.inquiryResourceSend.findMany = (async () => sends) as never;
  prisma.inquiryResourceSend.findFirst = (async () => sends[0] ?? null) as never;
  prisma.inquiryResourceSend.createMany = (async ({ data }: { data: Record<string, unknown> }) => {
    const send = { id: `send-${sends.length}`, ...data };
    sends.unshift(send as typeof sends[number]);
    return { count: 1 };
  }) as never;
});

const cities = [{ slug: 'ca-montreal', name: 'Montreal' }, { slug: 'ca-quebec', name: 'Québec' }];
const brochure = (familyKey = 'CAMP') => ({ id: 'resource', countryCode: 'CA', familyKey, title: 'Canadá 2027',
  locationSlugs: cities.map((city) => city.slug), locationNames: cities.map((city) => city.name),
  locationSlug: 'ca-montreal', locationName: 'Montreal, Québec', year: 2027, seasonKeys: ['SUMMER'],
  validFrom: '2027-07-04', validUntil: '2027-08-08', minWeeks: 2, maxWeeks: 4,
  priceFrom: 1200, priceCurrency: 'CAD', currentVersion: { id: 'version', fileName: 'camp.pdf', fileUrl: 'https://example.com/camp.pdf' } });
const inquiry = (familyKey = 'CAMP') => ({ id: 'inquiry', family: { key: familyKey }, country: { code: 'CA', name: 'Canadá' },
  studentAge: 16, qualificationJson: { residenceCountry: 'México' }, preferredStartMonth: 7, preferredStartYear: null,
  accommodationType: null, weeks: null, contact: { firstName: 'Erick Ramírez', email: 'test@example.com' } });
const parsed = { replyText: '¿En qué año y alojamiento?', replyIntent: 'CONTINUE_FLOW', missingFields: ['preferredStartYear', 'accommodation'] };

function harness(resources = [brochure()]) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const service = Object.assign(Object.create(ConciergeOrchestratorService.prototype), {
    campBrochureContextKey: 'campBrochure',
    toolExecutor: { execute: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'list_available_course_types') return { courseTypes: [{ familyKey: 'CAMP', name: 'Campamentos / viajes', programCount: 1, brochureCount: 1 }] };
      if (name === 'interpret_message') return interpretation({ locationSlug: 'ca-quebec' });
      if (name === 'list_available_locations') return { locations: [...cities, { slug: 'unused', name: 'Toronto' }] };
      if (name === 'list_available_programs') return { programs: [] };
      if (name === 'list_available_resources') return { resources };
      throw new Error(`Unexpected tool ${name}`);
    } },
    buildPromptDrivenFollowUp: async ({ nextField }: { nextField: string }) => {
      assert.equal(nextField, 'weeks');
      return '¿Cuántas semanas te interesan? 😊';
    },
  }) as {
    toolExecutor: { execute: (name: string, args: Record<string, unknown>) => Promise<unknown> };
    inquiryRepository: object;
    hydrateInquiryFromLatestMessage: (context: unknown) => Promise<{ activeInquiry: unknown; cityWasSelected: boolean }>;
    applyCityResourceFlow: (parsed: unknown, context: unknown) => Promise<{
      structured: { replyText: string; nextStage: string; missingFields: string[] }; contextPatch: Record<string, unknown>;
      outboundMediaUrls: string[];
    } | null>;
    getEnforcedNextField: (inquiry: unknown) => string | null;
    sanitizeMissingFieldsForInquiry: (fields: string[], inquiry: unknown) => string[];
  };
  return { service, calls };
}

test('city menu excludes unused catalog cities and preserves separate names for multi-city PDFs', async () => {
  const { service } = harness();
  const result = await service.applyCityResourceFlow(parsed, { activeInquiry: inquiry(), conversation: {} });
  assert.match(result!.structured.replyText, /Actualmente tenemos programas en las siguientes ciudades de Canadá/);
  assert.match(result!.structured.replyText, /1\) Montreal\n2\) Québec/);
  assert.doesNotMatch(result!.structured.replyText, /Toronto|Montreal, Québec|año|alojamiento/);
  assert.deepEqual(result!.outboundMediaUrls, []);
});

for (const familyKey of ['CAMP', 'LANGUAGE_COURSE']) {
  test(`${familyKey} city selection automatically attaches compatible PDFs once, without permission or date/accommodation questions`, async () => {
    const pdf = brochure(familyKey);
    const { service, calls } = harness([pdf, pdf, { ...pdf, id: 'other', locationSlugs: ['other-city'], locationSlug: 'other-city' }]);
    const context = { activeInquiry: { ...inquiry(familyKey), location: cities[1] }, conversation: {}, cityWasSelected: true };
    const result = await service.applyCityResourceFlow(parsed, context);
    assert.deepEqual(result!.outboundMediaUrls, ['https://example.com/camp.pdf']);
    assert.match(result!.structured.replyText, /Te comparto los folletos disponibles para Québec/);
    assert.match(result!.structured.replyText, /edición 2027/);
    assert.match(result!.structured.replyText, /verano/);
    assert.doesNotMatch(result!.structured.replyText, /¿.*(?:enviar|mandar|alojamiento|año)/);
    assert.deepEqual(result!.structured.missingFields, ['weeks']);
    assert.equal(calls.find((call) => call.name === 'list_available_resources')?.args.locationSlug, 'ca-quebec');
    assert.equal(calls.find((call) => call.name === 'list_available_resources')?.args.targetDate, undefined);
    if (familyKey === 'CAMP') assert.match(result!.structured.replyText, /desde 1,200 CAD/);
    sends.push({ id: 'stored', resourceId: 'resource', resourceVersionId: 'version', deliveryStatus: 'ACCEPTED' });
    const repeated = await service.applyCityResourceFlow(parsed, { ...context, cityWasSelected: false,
      conversation: { contextJson: result!.contextPatch }, latestMessage: { text: '4 semanas' } });
    assert.equal(repeated, null);
  });
}

test('missing eligible PDFs produces an honest fallback, not attachments from another city', async () => {
  const { service } = harness([]);
  const result = await service.applyCityResourceFlow(parsed, { activeInquiry: { ...inquiry(), location: cities[0] }, cityWasSelected: true });
  assert.deepEqual(result!.outboundMediaUrls, []);
  assert.match(result!.structured.replyText, /no tengo folletos vigentes compatibles/);
  assert.equal(result!.structured.nextStage, 'ESCALATED');
});

test('questions about the PDF take precedence over a pending city question', async () => {
  const { service, calls } = harness();
  const result = await service.applyCityResourceFlow({ ...parsed, replyIntent: 'ANSWER_QUESTION' }, {
    activeInquiry: inquiry(), latestMessage: { text: '¿Qué incluye?' },
  });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test('start year and accommodation are not required, including old model missing-fields', () => {
  const { service } = harness();
  for (const familyKey of ['CAMP', 'LANGUAGE_COURSE']) {
    assert.equal(service.getEnforcedNextField(inquiry(familyKey)), 'weeks');
    assert.equal(service.getEnforcedNextField({ ...inquiry(familyKey), weeks: 3 }), null);
    assert.deepEqual(service.sanitizeMissingFieldsForInquiry(['preferredStartYear', 'accommodation', 'weeks'], inquiry(familyKey)), ['weeks']);
  }
});

test('numeric city choice preserves the displayed ordering and cannot become age, residence or a different family', async () => {
  const { service } = harness();
  const previousText = 'Actualmente tenemos programas en las siguientes ciudades de Canadá:\n1) Québec\n2) Montreal';
  let update: Record<string, unknown> = {};
  service.inquiryRepository = { update: async (args: Record<string, unknown>) => { update = args; }, findById: async () => inquiry() };
  const result = await service.hydrateInquiryFromLatestMessage({
    activeInquiry: inquiry(), latestMessage: { id: 'in', direction: 'INBOUND', text: '1' },
    conversation: { id: 'conversation', contextJson: { cityResourceMenu: { countryCode: 'CA', familyKey: 'CAMP', options: [...cities].reverse(), replyText: previousText } },
      messages: [{ id: 'out', direction: 'OUTBOUND', text: previousText }, { id: 'in', direction: 'INBOUND', text: '1' }] },
  });
  assert.equal(update.locationSlug, 'ca-quebec');
  assert.equal(update.studentAge, undefined);
  assert.equal(update.familyKey, undefined);
  assert.equal(update.qualificationJson, undefined);
  assert.equal(result.cityWasSelected, true);
});

test('active program locations are available without a PDF but unrelated catalog entries stay hidden', async () => {
  const result = await new ConciergeCityResourcesService({ execute: async (name) => {
    if (name === 'list_available_locations') return { locations: cities };
    if (name === 'list_available_programs') return { programs: [{ locationSlug: 'ca-quebec', locationName: 'Québec' }] };
    return { resources: [] };
  } }).load({ countryCode: 'CA', familyKey: 'CAMP' });
  assert.deepEqual(result.cities, [cities[1]]);
});

test('a stricter age filter after delivery does not reopen the old brochure-permission flow', async () => {
  const { service } = harness();
  const first = await service.applyCityResourceFlow(parsed, { activeInquiry: { ...inquiry(), location: cities[0] }, cityWasSelected: true });
  const orchestrator = service as unknown as {
    findCampBrochureCandidates: () => Promise<unknown[]>;
    resolveCampBrochureState: (context: unknown) => Promise<{ state: { status: string } }>;
  };
  orchestrator.findCampBrochureCandidates = async () => [{ resourceId: 'resource', versionId: 'version', seasonKeys: ['SUMMER'] }];
  sends.push({ id: 'stored', resourceId: 'resource', resourceVersionId: 'version', deliveryStatus: 'ACCEPTED' });
  const result = await orchestrator.resolveCampBrochureState({ activeInquiry: { ...inquiry(), location: cities[0] },
    conversation: { contextJson: { ...first!.contextPatch, campBrochure: { status: 'SENT', candidates: [], checkedAt: new Date().toISOString() } } } });
  assert.equal(result.state.status, 'SENT');
});

for (const eligible of [true, false]) {
  test(`complete city-selection turn ${eligible ? 'persists actual attachments' : 'rechecks eligibility and never promises blocked attachments'}`, async (t) => {
    const originalControl = prisma.conversation.findUnique;
    const originalGuard = ResourceDeliveryGuardService.prototype.prepareDelivery;
    t.after(() => { prisma.conversation.findUnique = originalControl; ResourceDeliveryGuardService.prototype.prepareDelivery = originalGuard; });
    prisma.conversation.findUnique = (async () => ({ controlMode: 'AI' })) as never;
    ResourceDeliveryGuardService.prototype.prepareDelivery = async (urls, inquiryId) => {
      assert.equal(inquiryId, 'inquiry');
      assert.deepEqual(urls, ['https://example.com/camp.pdf']);
      return eligible ? { urls, versions: [{ resourceId: 'resource', versionId: 'version' }] } : { urls: [], versions: [] };
    };
    const previousText = 'Actualmente tenemos programas en las siguientes ciudades de Canadá:\n1) Montreal\n2) Québec';
    const conversation = { id: 'conversation', controlMode: 'AI', contextJson: null, messages: [
      { id: 'out', direction: 'OUTBOUND', text: previousText }, { id: 'in', direction: 'INBOUND', text: '2' },
    ] };
    let lead = inquiry() as ReturnType<typeof inquiry> & { location?: typeof cities[number] };
    let persisted: Record<string, unknown> = {};
    let savedContext: Record<string, unknown> = {};
    const { service: base } = harness();
    const tools = base.toolExecutor;
    const service = new ConciergeOrchestratorService({
      findById: async () => conversation,
      persistConciergeOutcome: async (args: { replyText: string; contextJson: Record<string, unknown> }) => { persisted = { ...args, text: args.replyText }; savedContext = args.contextJson; },
      createMessage: async (args: Record<string, unknown>) => { persisted = args; return conversation; },
      update: async (args: { contextJson: Record<string, unknown> }) => { savedContext = args.contextJson; return conversation; },
    } as never, {
      update: async (args: { locationSlug?: string }) => { if (args.locationSlug) lead = { ...lead, location: cities.find((city) => city.slug === args.locationSlug) }; },
      findById: async () => lead,
      updateStatus: async () => {},
    } as never, {
      getModel: () => 'unit-test-model',
      createTextResponse: async (args: { tools?: unknown }) => ({ id: 'response', raw: { output: [] },
        outputText: args.tools ? JSON.stringify({ ...parsed, detectedNeed: 'CAMP', shouldAskFollowUp: true, nextStage: 'QUALIFY_DATES' }) : '¿Cuántas semanas te interesan? 😊' }),
    } as never, { execute: async (name: string, args: Record<string, unknown>) => {
      if (name === 'list_available_course_types') return { courseTypes: [{ familyKey: 'CAMP', name: 'Campamentos / viajes', programCount: 1, brochureCount: 1 }] };
      if (name === 'evaluate_policy_signals') return { handoffStep: 'none', menuWasShown: true };
      if (name === 'list_weeks_options') return { minWeeks: 1, maxWeeks: 8 };
      return tools.execute(name, args);
    } } as never, { createTurn: async () => ({ id: 'turn' }), createToolCall: async () => {}, completeToolCall: async () => {}, failToolCall: async () => {}, completeTurn: async () => {}, failTurn: async () => {} } as never);
    Object.assign(service, { buildTurnContext: async () => ({ conversation, activeInquiry: lead, latestMessage: conversation.messages[1] }), recordResourceSend: async () => {} });
    await service.runTurn({ conversationId: 'conversation', incomingMessageId: 'in' });
    assert.equal(lead.location?.slug, 'ca-quebec');
    assert.deepEqual((persisted.metadata as { mediaUrls: string[] }).mediaUrls, eligible ? ['https://example.com/camp.pdf'] : []);
    if (eligible) {
      assert.match(String(persisted.text), /Te comparto los folletos disponibles para Québec/);
      assert.equal((savedContext.cityResourceDelivery as { locationSlug: string }).locationSlug, 'ca-quebec');
    } else {
      assert.match(String(persisted.text), /no tengo un folleto vigente/);
      assert.doesNotMatch(String(persisted.text), /Te comparto|Te envío/);
      assert.equal(savedContext.cityResourceDelivery, null);
    }
  });
}

const montrealOnly = () => ({ ...brochure(), id: 'res-2', title: 'Montreal residencial',
  locationSlug: 'ca-montreal', locationSlugs: ['ca-montreal'], locationNames: ['Montreal'],
  minWeeks: 3, maxWeeks: 6,
  currentVersion: { id: 'v2', fileName: 'residence.pdf', fileUrl: 'https://example.com/residence.pdf' } });

test('Montreal receives both distinct PDFs and Quebec receives only the assigned BLI PDF', async () => {
  const { service } = harness([brochure(), montrealOnly(), brochure()]);
  for (const [city, count] of [[cities[0], 2], [cities[1], 1]] as const) {
    const result = await service.applyCityResourceFlow(parsed, { activeInquiry: { ...inquiry(), location: city }, cityWasSelected: true });
    assert.equal(result!.outboundMediaUrls.length, count);
    assert.match(result!.structured.replyText, /viaje del 2027-07-04 al 2027-08-08/);
    assert.match(result!.structured.replyText, /2 a 4 semanas/);
    if (count === 2) assert.match(result!.structured.replyText, /3 a 6 semanas/);
  }
});

test('January without a year shows actual trip dates; changing to July after restart does not resend', async () => {
  sends.push({ id: 'stored', resourceId: 'resource', resourceVersionId: 'version', deliveryStatus: 'UNKNOWN' });
  const january = await harness().service.applyCityResourceFlow(parsed, {
    activeInquiry: { ...inquiry(), preferredStartMonth: 1, location: cities[0] }, latestMessage: { text: 'enero' },
    conversation: { contextJson: null },
  });
  assert.deepEqual(january!.outboundMediaUrls, []);
  assert.match(january!.structured.replyText, /Para enero no tengo fechas de viaje confirmadas/);
  assert.match(january!.structured.replyText, /2027-07-04/);
  assert.match(january!.structured.replyText, /mantener enero/);
  const restarted = harness().service;
  const july = await restarted.applyCityResourceFlow(parsed, {
    activeInquiry: { ...inquiry(), preferredStartMonth: 7, location: cities[0] }, latestMessage: { text: 'julio' }, conversation: { contextJson: null },
  });
  assert.equal(july, null);
});

test('keeping January preserves the preference for advisor follow-up', async () => {
  const result = await harness().service.applyCityResourceFlow(parsed, {
    activeInquiry: { ...inquiry(), preferredStartMonth: 1, location: cities[0] }, interpretation: interpretation({ maintainTravelMonth: true }), latestMessage: { text: 'Prefiero mantener enero' },
  });
  assert.equal(result!.structured.nextStage, 'ESCALATED');
  assert.match(result!.structured.replyText, /preferencia por enero/);
  assert.deepEqual(result!.outboundMediaUrls, []);
});

test('an explicit request or proven failure can resend a PDF; a city change alone cannot', async () => {
  sends.push({ id: 'stored', resourceId: 'resource', resourceVersionId: 'version', deliveryStatus: 'ACCEPTED' });
  const { service } = harness();
  const context = { activeInquiry: { ...inquiry(), location: cities[0] }, conversation: {} };
  assert.equal(await service.applyCityResourceFlow(parsed, { ...context, cityWasSelected: true }), null);
  const requested = await service.applyCityResourceFlow(parsed, { ...context, interpretation: interpretation({ requestsResource: true }), latestMessage: { text: 'Envíame el folleto otra vez' } });
  assert.equal(requested!.outboundMediaUrls.length, 1);
  sends[0]!.deliveryStatus = 'FAILED';
  const failed = await service.applyCityResourceFlow(parsed, { ...context, latestMessage: { text: 'julio' } });
  assert.equal(failed!.outboundMediaUrls.length, 1);
});

test('a January availability question validates the requested month even when classified as an answer', async () => {
  const result = await harness().service.applyCityResourceFlow({ ...parsed, replyIntent: 'ANSWER_QUESTION' }, {
    activeInquiry: { ...inquiry(), preferredStartMonth: 1, location: cities[0] },
    latestMessage: { text: '¿Tienen campamento en enero?' }, travelDateWasSelected: true,
  });
  assert.match(result!.structured.replyText, /Para enero no tengo fechas de viaje confirmadas/);
  assert.deepEqual(result!.outboundMediaUrls, []);
});
