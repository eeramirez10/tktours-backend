import assert from 'node:assert/strict';
import test from 'node:test';
import { ConciergeOrchestratorService } from './concierge-orchestrator.service.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { PrismaInquiryRepository } from '../../../inquiries/infrastructure/repositories/prisma-inquiry.repository.js';

const turnContext = {
  conversation: { messages: [
    { id: 'previous', direction: 'OUTBOUND', text: '¿Qué tipo de alojamiento prefieren?' },
    { id: 'incoming', direction: 'INBOUND', text: 'Qué tipos tienes' },
  ] },
  latestMessage: { id: 'incoming', text: 'Qué tipos tienes', direction: 'INBOUND' },
  activeInquiry: {
    id: 'inquiry', family: { key: 'CAMP' }, country: { code: 'CA', name: 'Canadá' },
    studentAge: 12, preferredStartYear: 2027, preferredStartMonth: 7, qualificationJson: { residenceCountry: 'México' },
    accommodationType: null,
  },
};

function harness(accommodations: Array<{ key: string; name: string }>) {
  const queried: string[] = [];
  const service = Object.assign(Object.create(ConciergeOrchestratorService.prototype), {
    detectIntentWithTool: async () => 'UNKNOWN',
    evaluatePolicySignalsWithTool: async () => ({ menuWasShown: true, handoffStep: 'none', asksAccommodationOptions: false }),
    hydrateInquiryFamilyFromIntent: async (context: unknown) => context,
    getEnforcedNextField: () => 'accommodation',
    getLanguageCourseAgeBlock: () => null,
    resolveCampBrochureState: async () => ({ state: null, contextPatch: null }),
    resolveCampBrochureReplyAction: async () => ({ action: 'UNKNOWN' }),
    toolExecutor: { execute: async (name: string, args: Record<string, unknown>) => {
      queried.push(name);
      assert.equal(name, 'list_available_accommodations');
      assert.equal(args.countryCode, 'CA');
      assert.equal(args.studentAge, 12);
      return { accommodations };
    } },
  }) as {
    applyReplyPolicy: (parsed: object, context: unknown, options: object) => Promise<{
      structured: { replyText: string; nextStage: string; missingFields: string[]; shouldAskFollowUp: boolean };
      trace: { details: { reason: string } };
    }>;
  };
  return { service, queried };
}

const parsed = { replyText: 'Easter, Verano Canadá y Winter Canadá. No hay folletos disponibles.',
  replyIntent: 'ANSWER_QUESTION', detectedNeed: 'CAMP', missingFields: [] };

test('a short types question after asking accommodation lists accommodation rather than programs', async () => {
  const { service, queried } = harness([{ key: 'HOST_FAMILY', name: 'Host family' }, { key: 'UNIVERSITY_RESIDENCE', name: 'Residence' }]);
  const result = await service.applyReplyPolicy(parsed, turnContext, { resourceContentSearchUsed: false, dataToolUsed: true });
  assert.match(result.structured.replyText, /Familia anfitriona/);
  assert.match(result.structured.replyText, /Residencia universitaria/);
  assert.doesNotMatch(result.structured.replyText, /Easter|Verano|No hay folletos/);
  assert.equal(result.structured.nextStage, 'QUALIFY_ACCOMMODATION');
  assert.deepEqual(queried, ['list_available_accommodations']);
});

test('missing accommodation rules do not become a false claim that no PDFs exist', async () => {
  const { service } = harness([]);
  const result = await service.applyReplyPolicy(parsed, turnContext, { resourceContentSearchUsed: false, dataToolUsed: false });
  assert.match(result.structured.replyText, /confirmar qué opciones de alojamiento/);
  assert.doesNotMatch(result.structured.replyText, /No hay folletos|Easter|Verano/);
  assert.equal(result.structured.nextStage, 'ESCALATED');
  assert.deepEqual(result.structured.missingFields, []);
});

test('an explicit question about programs is not mistaken for accommodation', async () => {
  const { service, queried } = harness([]);
  const context = { ...turnContext, latestMessage: { ...turnContext.latestMessage, text: 'Qué tipos de programas tienes' } };
  const result = await service.applyReplyPolicy(parsed, context, { resourceContentSearchUsed: false, dataToolUsed: true });
  assert.equal(result.structured.replyText, parsed.replyText);
  assert.deepEqual(queried, []);
});

test('the follow-up flow never asks customers to choose unconfigured accommodations', async () => {
  const { service } = harness([]);
  const context = { ...turnContext, latestMessage: { ...turnContext.latestMessage, text: '2027' } };
  const result = await service.applyReplyPolicy({ ...parsed, replyIntent: 'CONTINUE_FLOW', missingFields: ['accommodation'] }, context,
    { resourceContentSearchUsed: false, dataToolUsed: false });
  assert.equal(result.structured.nextStage, 'ESCALATED');
  assert.equal(result.structured.shouldAskFollowUp, false);
  assert.equal(result.trace.details.reason, 'unconfirmed_accommodation_options');
});

test('Residencia can be saved as a preference when accommodation reference rows are missing', async (t) => {
  const original = prisma.accommodationType.upsert;
  prisma.accommodationType.upsert = (async (args: { where: { key: string }; update: object }) => {
    assert.equal(args.where.key, 'UNIVERSITY_RESIDENCE');
    assert.deepEqual(args.update, {});
    return { id: 'residence-id' };
  }) as unknown as typeof original;
  t.after(() => { prisma.accommodationType.upsert = original; });
  const repository = new PrismaInquiryRepository() as unknown as {
    resolveRelations: (input: object) => Promise<{ accommodationTypeId: string | null }>;
  };
  assert.equal((await repository.resolveRelations({ accommodationKey: 'UNIVERSITY_RESIDENCE' })).accommodationTypeId, 'residence-id');
});

test('sending a brochure does not append an unsupported accommodation selection', async () => {
  const { service } = harness([]);
  const candidate = { resourceId: 'resource', versionId: 'version', fileUrl: 'https://example.com/camp.pdf', seasonKeys: ['SUMMER'] };
  Object.assign(service, {
    resolveCampBrochureState: async () => ({ state: { status: 'OFFERED', candidates: [candidate] }, contextPatch: null }),
    resolveCampBrochureReplyAction: async () => ({ action: 'SEND', selectedSeasonKeys: ['SUMMER'], sendAll: false }),
    buildPromptDrivenCampBrochureSend: async () => 'Con gusto, te comparto el folleto.',
  });
  const context = { ...turnContext, latestMessage: { ...turnContext.latestMessage, text: 'Sí' } };
  const result = await service.applyReplyPolicy({ ...parsed, replyIntent: 'CONTINUE_FLOW' }, context,
    { resourceContentSearchUsed: false, dataToolUsed: false });
  assert.match(result.structured.replyText, /te comparto el folleto/);
  assert.match(result.structured.replyText, /confirmar qué opciones de alojamiento/);
  assert.doesNotMatch(result.structured.replyText, /qué tipo de alojamiento prefieren/);
  assert.equal(result.structured.shouldAskFollowUp, false);
  assert.equal(result.structured.nextStage, 'ESCALATED');
});
