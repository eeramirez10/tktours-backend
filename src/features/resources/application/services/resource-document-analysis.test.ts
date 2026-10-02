import assert from 'node:assert/strict';
import test from 'node:test';

import { ResourceDocumentAnalysisService } from './resource-document-analysis.service.js';

const analysis = {
  suggestedTitle: 'Campamento Canadá', summary: 'Campamento de verano',
  countryCode: 'CA', countryName: 'Canadá', cities: ['Montreal'],
  validFrom: null, validUntil: null, minAge: 7, maxAge: 17,
  minWeeks: 1, maxWeeks: 4, priceFrom: null, priceCurrency: null,
  priceUnit: null, priceNotes: null, confidence: 0.9,
};

test('PDF analysis preserves missing and partial camp price fields', async () => {
  let detected: Record<string, unknown> = { ...analysis };
  const service = new ResourceDocumentAnalysisService(
    { createTextResponse: async () => ({ id: 'test', outputText: JSON.stringify(detected), raw: {} as never }) },
    { listCountries: async () => countries },
  );
  const input = { fileName: 'camp.pdf', content: Buffer.from('pdf'), requestedFamilyKey: 'CAMP', resourceType: 'BROCHURE' as const };

  const withoutPrice = await service.analyze(input);
  assert.equal(withoutPrice.priceFrom, null);
  assert.equal(withoutPrice.priceCurrency, null);

  detected = { ...analysis, priceFrom: 1500 };
  const partialPrice = await service.analyze({ ...input, requestedFamilyKey: undefined });
  assert.equal(partialPrice.priceFrom, 1500);
  assert.equal(partialPrice.priceCurrency, null);

  const manual = await service.analyze({ ...input, resourceType: 'MANUAL' });
  assert.equal(manual.priceFrom, null);
});

const countries = [
  { code: 'CA', name: 'Canadá', providerName: 'Canada', iso3: 'CAN' },
  { code: 'DE', name: 'Alemania', providerName: 'Germany', iso3: 'DEU' },
];

function createService(detected: Record<string, unknown>, unavailable = false) {
  return new ResourceDocumentAnalysisService(
    { createTextResponse: async () => ({ id: 'test', outputText: JSON.stringify(detected), raw: {} as never }) },
    { listCountries: async () => { if (unavailable) throw new Error('API unavailable'); return countries; } },
  );
}

const input = { fileName: 'test.pdf', content: Buffer.from('pdf'), resourceType: 'BROCHURE' as const };

test('analysis resolves countries by API name, provider name and ISO code', async () => {
  for (const countryName of ['canada', ' Canadá ', 'CAN']) {
    const result = await createService({ ...analysis, countryCode: null, countryName }).analyze(input);
    assert.equal(result.countryCode, 'CA');
    assert.equal(result.countryName, 'Canadá');
  }
  const byCode = await createService({ ...analysis, countryCode: 'de', countryName: null }).analyze(input);
  assert.equal(byCode.countryName, 'Alemania');
  const corrected = await createService({ ...analysis, countryCode: 'CA', countryName: 'Germany' }).analyze(input);
  assert.equal(corrected.countryCode, 'DE');
});

test('unknown countries and API failures retain the detected name for manual entry', async () => {
  const unmatched = await createService({ ...analysis, countryCode: 'ZZ', countryName: 'Destino nuevo' }).analyze(input);
  assert.equal(unmatched.countryCode, null);
  assert.equal(unmatched.countryName, 'Destino nuevo');
  const offline = await createService(analysis, true).analyze(input);
  assert.equal(offline.countryCode, null);
  assert.equal(offline.countryName, 'Canadá');
});

test('city names remove descriptive prefixes and duplicates but preserve official names', async () => {
  const result = await createService({
    ...analysis,
    cities: ['Ciudad de Quebec', 'Quebec City', 'City of Montreal', 'Montreal', 'Ciudad de México', 'Ciudad del Carmen', 'Ciudad Juárez'],
  }).analyze(input);
  assert.deepEqual(result.cities, ['Quebec', 'Montreal', 'Ciudad de México', 'Ciudad del Carmen', 'Ciudad Juárez']);
});

test('analysis suggests only supported PDF seasons and leaves family and program manual', async () => {
  const service = new ResourceDocumentAnalysisService(
    { createTextResponse: async (request) => {
      assert.match(request.instructions ?? '', /No deduzcas la temporada por el país, los meses/);
      assert.match(request.instructions ?? '', /No clasifiques ni devuelvas la familia o el programa/);
      const schema = request.text?.format as { schema: { required: string[]; properties: { seasonKeys: { items: { enum: string[] } } } } };
      assert.ok(schema.schema.required.includes('seasonKeys'));
      assert.deepEqual(schema.schema.properties.seasonKeys.items.enum, ['SUMMER', 'EASTER', 'WINTER']);
      return { id: 'test', outputText: JSON.stringify({ ...analysis, seasonKeys: ['SUMMER', 'WINTER', 'SUMMER'], familyKey: 'CAMP', programName: 'BLI' }), raw: {} as never };
    } },
    { listCountries: async () => countries },
  );
  const result = await service.analyze(input);
  assert.deepEqual(result.seasonKeys, ['SUMMER', 'WINTER']);
  assert.equal(Object.hasOwn(result, 'familyKey'), false);
  assert.equal(Object.hasOwn(result, 'programName'), false);
  const manual = await service.analyze({ ...input, resourceType: 'MANUAL' });
  assert.deepEqual(manual.seasonKeys, []);
});

test('missing or ambiguous seasons are not inferred from dates or the country', async () => {
  const result = await createService({ ...analysis, validFrom: '2027-06-01', validUntil: '2027-08-30' }).analyze(input);
  assert.deepEqual(result.seasonKeys, []);
  const unknown = createService({ ...analysis, seasonKeys: ['CUSTOM'] });
  await assert.rejects(unknown.analyze(input), /invalid shape/);
});
