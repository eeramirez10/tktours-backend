import assert from 'node:assert/strict';
import test from 'node:test';
import { inquiryProgress, nextInquiryStatus, recommendationCriteria, type ProgressInquiry } from './inquiry-progress.js';
const complete = (): ProgressInquiry => ({ id: 'inquiry', status: 'OPEN', family: { key: 'CAMP' }, country: { code: 'CA' },
  studentAge: 16, preferredStartMonth: 7, preferredStartYear: null, weeks: 3,
  qualificationJson: { residenceCountry: 'México' }, contact: { firstName: 'María José', lastName: 'López', email: 'maria@example.com' } });
const recommendation = (inquiry: ProgressInquiry) => ({ criteria: recommendationCriteria(inquiry), status: 'CONFIRMED', resourceIds: ['brochure'], presentedAt: new Date().toISOString() });
test('new inquiry advances through capture, search, actual recommendation, and explicit handoff without closing', () => {
  const inquiry = complete();
  const fresh = { ...inquiry, family: null, country: null, studentAge: null, preferredStartMonth: null, weeks: null, qualificationJson: null, contact: null };
  assert.equal(nextInquiryStatus(fresh), 'OPEN');
  assert.equal(nextInquiryStatus({ ...fresh, studentAge: 16 }), 'QUALIFYING');
  assert.equal(nextInquiryStatus(inquiry), 'READY_TO_RECOMMEND');
  assert.equal(nextInquiryStatus(inquiry, { status: 'SENT', resourceIds: ['general-brochure'] }), 'READY_TO_RECOMMEND');
  assert.equal(nextInquiryStatus(inquiry, recommendation(inquiry)), 'RECOMMENDED');
  assert.equal(nextInquiryStatus(inquiry, null, { handoffConfirmed: true }), 'WAITING_HUMAN');
  assert.equal(nextInquiryStatus(inquiry), 'READY_TO_RECOMMEND'); // contact alone never closes
});
test('name and email are required to complete handoff and stay visible as pending capture', () => {
  for (const contact of [null, { firstName: 'María' }, { firstName: 'María', lastName: 'López' }, { lastName: 'López', email: 'maria@example.com' }]) {
    const inquiry = { ...complete(), contact };
    assert.notEqual(nextInquiryStatus(inquiry, null, { handoffConfirmed: true }), 'WAITING_HUMAN');
    assert.equal(inquiryProgress(inquiry).captureComplete, false);
  }
});
test('undecided dates and duration count as answered but cannot confirm a recommendation', () => {
  const inquiry = complete();
  inquiry.preferredStartMonth = null; inquiry.weeks = null;
  inquiry.qualificationJson = { residenceCountry: 'México', preferredStartStatus: 'UNDECIDED', weeksStatus: 'UNDECIDED' };
  assert.equal(inquiryProgress(inquiry).percent, 100);
  assert.equal(nextInquiryStatus(inquiry), 'READY_TO_RECOMMEND');
  assert.equal(inquiryProgress(inquiry, recommendation(inquiry)).recommendationConfirmed, false);
  assert.equal(nextInquiryStatus(inquiry, null, { handoffConfirmed: true }), 'WAITING_HUMAN');
});
test('preference corrections invalidate recommendations; an incompatible option requires qualification', () => {
  const inquiry = complete(); const r = recommendation(inquiry);
  for (const change of [{ weeks: 8 }, { preferredStartMonth: 1 }, { preferredStartYear: 2030 }, { studentAge: 30 }, { accommodationType: { key: 'HOST_FAMILY' } }, { location: { slug: 'quebec' } }]) {
    assert.equal(nextInquiryStatus({ ...inquiry, ...change }, r), 'READY_TO_RECOMMEND');
  }
  assert.equal(nextInquiryStatus(inquiry, { ...r, status: 'NONE', resourceIds: [] }), 'QUALIFYING');
});
test('waiting and closed states survive later greetings, questions, corrections and a new service instance', () => {
  const inquiry = { ...complete(), status: 'WAITING_HUMAN', weeks: null };
  assert.equal(nextInquiryStatus(inquiry), 'WAITING_HUMAN');
  assert.equal(nextInquiryStatus(JSON.parse(JSON.stringify(inquiry))), 'WAITING_HUMAN');
  assert.equal(nextInquiryStatus(inquiry, null, { explicitlyClosed: true }), 'CLOSED');
  assert.equal(nextInquiryStatus({ ...inquiry, status: 'CLOSED' }, null, { handoffConfirmed: true }), 'CLOSED');
});
test('circuits retain destination and travel-day requirements', () => {
  const inquiry = { ...complete(), family: { key: 'SCHOOL_PROGRAM' }, qualificationJson: { requestMode: 'CIRCUITS' }, contact: null };
  assert.deepEqual(inquiryProgress(inquiry).missingFields, ['tripDays']);
  assert.equal(inquiryProgress({ ...inquiry, qualificationJson: { requestMode: 'CIRCUITS', tripDays: 12 } }).captureComplete, true);
});
