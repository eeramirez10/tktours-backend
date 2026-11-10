import assert from 'node:assert/strict';
import test from 'node:test';
import { ConciergeOrchestratorService } from './concierge-orchestrator.service.js';
import { interpretation } from '../../../../scripts/fixtures/concierge-interpretation.js';
const flap = { id: 'flap', title: 'Programa FLAP Verano 2027 – Montreal y Ciudad de Quebec', familyKey: 'CAMP', countryCode: 'CA', locationSlug: 'montreal', year: 2027,
  minAge: 5, maxAge: 17, minWeeks: 2, maxWeeks: 8, validFrom: '2027-06-20', validUntil: '2027-08-14',
  currentVersion: { id: 'flap-version', fileName: 'BLI.pdf', fileUrl: 'https://example.com/flap.pdf' } };
const eli = { ...flap, id: 'eli', title: 'Campamento de verano 2027 en Montreal', validFrom: '2027-07-04', validUntil: '2027-08-01', maxWeeks: 4,
  currentVersion: { id: 'eli-version', fileName: 'ELI.pdf', fileUrl: 'https://example.com/eli.pdf' } };
const context = (month = 6, weeks = 3): any => ({ conversation: { contextJson: {} }, interpretation: interpretation({ weeks }), activeInquiry: {
  id: 'inquiry', country: { code: 'CA' }, family: { key: 'CAMP' }, location: { slug: 'montreal' }, studentAge: 15, preferredStartMonth: month, preferredStartYear: null, weeks,
  qualificationJson: { residenceCountry: 'México' }, contact: {},
} });
const result = (): any => ({ structured: { replyText: '¿Me compartes tu nombre?', nextStage: 'RECOMMEND' }, outboundMediaUrls: [] });
function service(resources: any[] = [flap, eli]): any {
  return Object.assign(new ConciergeOrchestratorService(), {
    toolExecutor: { execute: async () => ({ resources }) },
    buildPromptDrivenFollowUp: async () => '¿Me compartes tu nombre completo?',
  });
}
test('last conversation: recommends FLAP for June/three weeks and asks the next field without resending', async () => {
  const r = result(); await service().applyStayRecommendation(context(), r);
  assert.match(r.structured.replyText, /Programa FLAP.*3 semanas.*junio/);
  assert.match(r.structured.replyText, /nombre completo/);
  assert.doesNotMatch(r.structured.replyText, /Campamento de verano 2027 en Montreal/);
  assert.deepEqual(r.contextPatch.resourceRecommendation.resourceIds, ['flap']);
  assert.deepEqual(r.outboundMediaUrls, []);
  const c = context(); c.conversation.contextJson = r.contextPatch;
  const next = result(); await service().applyStayRecommendation(c, next);
  assert.equal(next.structured.replyText, '¿Me compartes tu nombre?');
});
test('all July matches are shown; changing to August/eight weeks invalidates the old recommendation', async () => {
  const r = result(); await service().applyStayRecommendation(context(7), r);
  assert.deepEqual(r.contextPatch.resourceRecommendation.resourceIds, ['flap', 'eli']);
  const c = context(8, 8); c.conversation.contextJson = r.contextPatch;
  const next = result(); await service().applyStayRecommendation(c, next);
  assert.match(next.structured.replyText, /No tengo una opción confirmada/);
  assert.equal(next.structured.nextStage, 'QUALIFY_DATES');
  assert.deepEqual(next.contextPatch.resourceRecommendation.resourceIds, []);
});
test('missing dates or duration require confirmation; questions and age incompatibility are respected', async () => {
  const r = result(); await service([{ ...flap, minWeeks: null }]).applyStayRecommendation(context(), r);
  assert.match(r.structured.replyText, /falta confirmar/);
  const c = context(); c.interpretation.isQuestion = true;
  const answer = result(); await service().applyStayRecommendation(c, answer);
  assert.equal(answer.structured.replyText, '¿Me compartes tu nombre?');
  const age = result(); await service([{ ...flap, minAge: 16 }]).applyStayRecommendation(context(), age);
  assert.match(age.structured.replyText, /No tengo una opción confirmada/);
});
test('an undecided date clears the previous recommendation and explicit follow-up keeps preferences', async () => {
  const r = result(); await service().applyStayRecommendation(context(), r);
  const c = context(); c.conversation.contextJson = r.contextPatch; c.activeInquiry.preferredStartMonth = null;
  const undecided = result(); await service().applyStayRecommendation(c, undecided);
  assert.equal(undecided.contextPatch.resourceRecommendation, null);
  const follow = context(8, 8); follow.interpretation.maintainTravelMonth = true;
  const handoff = result(); await service().applyStayRecommendation(follow, handoff);
  assert.equal(handoff.structured.nextStage, 'ESCALATED');
  assert.match(handoff.structured.replyText, /Conservamos tu preferencia/);
});
test('month and weeks supplied early produce a match before the remaining residence question', async () => {
  const c = context(); c.activeInquiry.qualificationJson = {};
  const s = service();
  s.buildPromptDrivenFollowUp = async ({ nextField }: { nextField: string }) => {
    assert.equal(nextField, 'residenceCountry');
    return '¿En qué país vive el estudiante?';
  };
  const r = result(); await s.applyStayRecommendation(c, r);
  assert.match(r.structured.replyText, /Programa FLAP/);
  assert.match(r.structured.replyText, /país vive/);
  assert.deepEqual(r.structured.missingFields, ['residenceCountry']);
});
