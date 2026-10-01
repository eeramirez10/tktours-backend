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
  const service = Object.create(ResourceDocumentAnalysisService.prototype) as {
    responsesClient: { createTextResponse: () => Promise<{ outputText: string }> };
    analyze: (input: { fileName: string; content: Buffer; requestedFamilyKey?: string; resourceType: 'BROCHURE' | 'MANUAL' }) => Promise<typeof analysis>;
  };
  service.responsesClient = { createTextResponse: async () => ({ outputText: JSON.stringify(detected) }) };
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
