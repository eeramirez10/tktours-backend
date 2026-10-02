import assert from 'node:assert/strict';
import test from 'node:test';
import { ConciergeOrchestratorService, type ConciergeTurnContext } from './concierge-orchestrator.service.js';

test('an offered brochure becoming unavailable produces an advisor fallback, never a sending promise', async () => {
  const service = Object.create(ConciergeOrchestratorService.prototype) as {
    detectIntentWithTool: () => Promise<string>;
    evaluatePolicySignalsWithTool: () => Promise<Record<string, unknown>>;
    hydrateInquiryFamilyFromIntent: (context: ConciergeTurnContext) => Promise<ConciergeTurnContext>;
    getEnforcedNextField: () => null;
    getLanguageCourseAgeBlock: () => null;
    resolveCampBrochureState: () => Promise<unknown>;
    getCampBrochureStateFromContext: () => { status: string };
    resolveCampBrochureReplyAction: () => Promise<{ action: string }>;
    applyReplyPolicy: (response: Record<string, unknown>, context: ConciergeTurnContext, options: Record<string, boolean>) => Promise<{
      structured: { replyText: string; nextStage: string };
      outboundMediaUrls: string[];
      trace: { details: { reason: string } };
    }>;
  };
  service.detectIntentWithTool = async () => 'UNKNOWN';
  service.evaluatePolicySignalsWithTool = async () => ({ menuWasShown: true, handoffStep: 'none' });
  service.hydrateInquiryFamilyFromIntent = async (context) => context;
  service.getEnforcedNextField = () => null;
  service.getLanguageCourseAgeBlock = () => null;
  service.resolveCampBrochureState = async () => ({ state: { status: 'UNAVAILABLE', candidates: [] }, contextPatch: null });
  service.getCampBrochureStateFromContext = () => ({ status: 'OFFERED' });
  service.resolveCampBrochureReplyAction = async () => ({ action: 'NONE' });
  const result = await service.applyReplyPolicy({
    replyText: 'Claro, te lo envío.', missingFields: [], replyIntent: 'CONTINUE_FLOW',
  }, { activeInquiry: null } as ConciergeTurnContext, { resourceContentSearchUsed: false, dataToolUsed: false });
  assert.match(result.structured.replyText, /no tengo un folleto vigente/);
  assert.match(result.structured.replyText, /asesor de TKTours/);
  assert.equal(result.structured.nextStage, 'ESCALATED');
  assert.deepEqual(result.outboundMediaUrls, []);
  assert.equal(result.trace.details.reason, 'previous_brochure_offer_no_longer_eligible');
});

test('unpriced offers explicitly identify next-year editions instead of implying the current summer', async () => {
  const service = Object.create(ConciergeOrchestratorService.prototype) as {
    buildPromptDrivenCampBrochureOffer: (args: Record<string, unknown>) => Promise<string>;
    haveSameCampBrochureCandidates: (left: unknown[], right: unknown[]) => boolean;
  };
  const candidate = {
    resourceId: 'r1', versionId: 'v1', countryName: 'Canadá', seasonKeys: ['SUMMER'], year: 2027,
    priceFrom: null, priceCurrency: null, validFrom: '2027-07-15', validUntil: '2027-08-15',
  };
  const message = await service.buildPromptDrivenCampBrochureOffer({ context: {}, candidates: [candidate] });
  assert.match(message, /verano.*2027/);
  assert.equal(service.haveSameCampBrochureCandidates([candidate], [{ ...candidate, year: 2028 }]), false);
});
