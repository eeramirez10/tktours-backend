import assert from 'node:assert/strict';
import test from 'node:test';
import { courseMenuText, displayedCourseChoice, type CourseOffering } from '../../domain/course-offerings.js';
import { ConciergeOrchestratorService, type ConciergeTurnContext } from './concierge-orchestrator.service.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

const camps: CourseOffering = { familyKey: 'CAMP', name: 'Campamentos / viajes', programCount: 1, brochureCount: 0 };
const languages: CourseOffering = { familyKey: 'LANGUAGE_COURSE', name: 'Cursos de idiomas', programCount: 1, brochureCount: 0 };

test('displayed menu numbering follows available families instead of fixed positions', () => {
  const menu = courseMenuText([camps]);
  assert.equal(menu, '1) Campamentos / viajes');
  assert.equal(displayedCourseChoice('1', menu), 'CAMP');
  assert.equal(displayedCourseChoice('2', courseMenuText([camps, { ...languages, familyKey: 'SCHOOL_PROGRAM', name: 'Circuitos por el mundo' }])), 'SCHOOL_PROGRAM');
  assert.equal(displayedCourseChoice('1', 'Opciones disponibles:\n1) Canadá\n2) Italia'), null);
  assert.equal(displayedCourseChoice('3', menu), null);
  assert.equal(displayedCourseChoice('tengo 1 semana', menu), null);
});

test('course-type tool excludes empty families and inactive programs or destinations', async () => {
  const service = Object.create(ConciergeToolExecutorService.prototype) as {
    catalogRepository: object;
    listAvailableResources: () => Promise<{ resources: Array<{ familyKey: string }> }>;
    listAvailableCourseTypes: (args?: object) => Promise<{ courseTypes: CourseOffering[] }>;
  };
  const family = (key: string, active = true) => ({ key, name: key, active });
  const program = (key: string, active = true, destinationActive = true) => ({ active, family: family(key), country: { active: destinationActive } });
  service.catalogRepository = {
    findFamilies: async () => [family('CAMP'), family('LANGUAGE_COURSE'), family('SCHOOL_PROGRAM'), family('CUSTOM')],
    findPrograms: async () => [program('CAMP'), program('LANGUAGE_COURSE', false), program('SCHOOL_PROGRAM', true, false)],
  };
  service.listAvailableResources = async () => ({ resources: [] });
  assert.deepEqual((await service.listAvailableCourseTypes()).courseTypes, [camps]);
  service.catalogRepository = { findFamilies: async () => [family('CAMP')], findPrograms: async () => [] };
  assert.deepEqual((await service.listAvailableCourseTypes()).courseTypes, []);
  service.listAvailableResources = async () => ({ resources: [{ familyKey: 'CAMP' }] });
  assert.deepEqual((await service.listAvailableCourseTypes()).courseTypes, [{ ...camps, programCount: 0, brochureCount: 1 }]);
  service.catalogRepository = { findFamilies: async () => [family('CAMP', false)], findPrograms: async () => [] };
  assert.deepEqual((await service.listAvailableCourseTypes()).courseTypes, []);
});

function context(message: string, offerings: CourseOffering[], previousReply = ''): ConciergeTurnContext {
  return {
    conversation: {
      id: 'conversation', contact: { firstName: 'Luz' }, currentStage: 'START',
      messages: [
        ...(previousReply ? [{ id: 'previous', direction: 'OUTBOUND', text: previousReply, createdAt: new Date() }] : []),
        { id: 'incoming', direction: 'INBOUND', text: message, createdAt: new Date() },
      ],
    },
    latestMessage: { id: 'incoming', direction: 'INBOUND', text: message, createdAt: new Date() },
    activeInquiry: null, availableCourseTypes: offerings,
  } as unknown as ConciergeTurnContext;
}

function policy(intent: string) {
  const service = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: (name: string) => Promise<unknown> };
    applyReplyPolicy: (parsed: object, context: ConciergeTurnContext, options: object) => Promise<{
      structured: { replyText: string; nextStage: string; missingFields: string[] };
      outboundMediaUrl: string | null;
      trace: { details: { reason: string } };
    }>;
    detectIntentWithTool: (context: ConciergeTurnContext) => Promise<string>;
  };
  service.toolExecutor = { execute: async (name) => name === 'detect_user_intent'
    ? { intent } : { menuWasShown: true, handoffStep: 'none' } };
  return service;
}

const parsed = { replyText: '1) Cursos de idiomas\n2) Campamentos / viajes\n3) Circuitos por el mundo', missingFields: ['studentAge'], shouldAskFollowUp: true };

test('greeting overwrites invented static options with the actual available menu', async () => {
  const result = await policy('GREETING').applyReplyPolicy(parsed, context('Hola', [camps]), {});
  assert.match(result.structured.replyText, /Hola, Luz/);
  assert.match(result.structured.replyText, /TKTours/);
  assert.match(result.structured.replyText, /1\) Campamentos \/ viajes/);
  assert.doesNotMatch(result.structured.replyText, /idiomas|Circuitos/);
  assert.equal(result.structured.nextStage, 'START');
  assert.deepEqual(result.structured.missingFields, []);
});

test('an empty catalog never advertises course types, asks qualifications or promises a PDF', async () => {
  const result = await policy('GREETING').applyReplyPolicy(parsed, context('Hola', []), {});
  assert.match(result.structured.replyText, /Por el momento no tengo programas ni folletos vigentes/);
  assert.doesNotMatch(result.structured.replyText, /1\)|semanas|edad|te envío/);
  assert.equal(result.structured.nextStage, 'ESCALATED');
  assert.deepEqual(result.structured.missingFields, []);
  assert.equal(result.outboundMediaUrl, null);
});

test('asking for existing course types receives a verified menu, not static model text', async () => {
  const result = await policy('ASK_AVAILABLE_PROGRAMS').applyReplyPolicy(parsed, context('¿Qué cursos tienen?', [languages]), {});
  assert.match(result.structured.replyText, /1\) Cursos de idiomas/);
  assert.doesNotMatch(result.structured.replyText, /Campamentos|Circuitos/);
  const empty = await policy('ASK_AVAILABLE_PROGRAMS').applyReplyPolicy(parsed, context('¿Qué cursos tienen?', []), {});
  assert.match(empty.structured.replyText, /Por el momento no tengo programas/);
  assert.doesNotMatch(empty.structured.replyText, /1\)|Hola/);
  const quote = await policy('REQUEST_QUOTE').applyReplyPolicy(parsed, context('Quiero una cotización', [camps]), {});
  assert.match(quote.structured.replyText, /1\) Campamentos/);
  assert.doesNotMatch(quote.structured.replyText, /Circuitos|no tenemos/);
});

test('a requested unavailable course type shows real alternatives without entering qualification', async () => {
  const result = await policy('ASK_LANGUAGE_COURSES').applyReplyPolicy(parsed, context('Quiero idiomas', [camps]), {});
  assert.match(result.structured.replyText, /no tenemos opciones disponibles de cursos de idiomas/);
  assert.match(result.structured.replyText, /1\) Campamentos/);
  assert.deepEqual(result.structured.missingFields, []);
  assert.equal(result.trace.details.reason, 'course_type_unavailable');
});

test('numeric intent is resolved deterministically from the last displayed menu', async () => {
  const service = policy('MENU_OPTION_1');
  assert.equal(await service.detectIntentWithTool(context('1', [camps], courseMenuText([camps]))), 'MENU_OPTION_2');
  assert.equal(await service.detectIntentWithTool(context('1', [languages], courseMenuText([languages]))), 'MENU_OPTION_1');
});

test('a course removed after showing the menu is rejected instead of interpreting the number as another type', async () => {
  const result = await policy('MENU_OPTION_1').applyReplyPolicy(parsed, context('1', [languages], courseMenuText([camps])), {});
  assert.match(result.structured.replyText, /no tenemos opciones disponibles de campamentos/);
  assert.match(result.structured.replyText, /1\) Cursos de idiomas/);
  assert.equal(result.trace.details.reason, 'course_type_unavailable');
});

test('inquiry extraction cannot override a dynamically numbered menu choice', async () => {
  let familyKey: unknown;
  const service = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: () => Promise<object> };
    inquiryRepository: { update: (args: { familyKey?: unknown }) => Promise<void>; findById: () => Promise<object> };
    hydrateInquiryFromLatestMessage: (context: ConciergeTurnContext) => Promise<ConciergeTurnContext>;
  };
  service.toolExecutor = { execute: async () => ({ familyKey: 'LANGUAGE_COURSE' }) };
  service.inquiryRepository = {
    update: async (args) => { familyKey = args.familyKey; },
    findById: async () => ({ id: 'inquiry', family: { key: 'CAMP' } }),
  };
  const turnContext = context('1', [camps], courseMenuText([camps]));
  turnContext.activeInquiry = { id: 'inquiry', family: null } as never;
  await service.hydrateInquiryFromLatestMessage(turnContext);
  assert.equal(familyKey, 'CAMP');
});

test('model inquiry updates do not write an unavailable family', async () => {
  const service = Object.create(ConciergeToolExecutorService.prototype) as {
    listAvailableCourseTypes: () => Promise<{ courseTypes: CourseOffering[] }>;
    inquiryRepository: { update: () => Promise<never> };
    updateInquiry: (args: object) => Promise<{ updated: boolean; reason: string }>;
  };
  service.listAvailableCourseTypes = async () => ({ courseTypes: [camps] });
  service.inquiryRepository = { update: async () => { throw new Error('No write expected'); } };
  const result = await service.updateInquiry({ inquiryId: 'inquiry', familyKey: 'LANGUAGE_COURSE' });
  assert.equal(result.updated, false);
  assert.equal(result.reason, 'COURSE_TYPE_UNAVAILABLE');
});

test('the complete greeting turn loads current offerings and persists only the verified menu', async (t) => {
  const conversation = { ...context('Hola', [camps]).conversation!, controlMode: 'AI', contextJson: null, inquiries: [] };
  let persistedText = '';
  let modelInput = '';
  const original = prisma.conversation.findUnique;
  prisma.conversation.findUnique = (async () => ({ controlMode: 'AI' })) as unknown as typeof original;
  t.after(() => { prisma.conversation.findUnique = original; });
  const service = new ConciergeOrchestratorService(
    {
      findById: async () => conversation,
      createMessage: async (args: { text: string }) => { persistedText = args.text; return conversation; },
      update: async () => conversation,
    } as never,
    {} as never,
    {
      getModel: () => 'test-model',
      createTextResponse: async (args: { input: string }) => {
        modelInput = args.input;
        return { id: 'response', outputText: JSON.stringify({ ...parsed, detectedNeed: 'UNKNOWN', nextStage: 'START' }), raw: { output: [] } };
      },
    } as never,
    {
      execute: async (name: string) => {
        if (name === 'list_available_course_types') return { courseTypes: [camps] };
        if (name === 'extract_inquiry_fields') return {};
        if (name === 'detect_user_intent') return { intent: 'GREETING' };
        return { menuWasShown: false, handoffStep: 'none' };
      },
    } as never,
    { createTurn: async () => ({ id: 'turn' }), completeTurn: async () => {}, failTurn: async () => {} } as never,
  );
  await service.runTurn({ conversationId: 'conversation', incomingMessageId: 'incoming' });
  assert.match(modelInput, /availableCourseTypes/);
  assert.match(persistedText, /1\) Campamentos/);
  assert.doesNotMatch(persistedText, /Cursos de idiomas|Circuitos/);
});
