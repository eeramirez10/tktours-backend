import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';

test('factual answers read only reviewed resource fields and expose missing facts as unconfirmed', async (t) => {
  const originals = { inquiry: prisma.inquiry.findUnique, resources: prisma.resource.findMany, chunks: prisma.resourceChunk.findMany };
  t.after(() => { prisma.inquiry.findUnique = originals.inquiry; prisma.resource.findMany = originals.resources; prisma.resourceChunk.findMany = originals.chunks; });
  prisma.inquiry.findUnique = (async () => ({ countryId: 'ca', resourceSends: [], preferredStartMonth: 1, preferredStartYear: null })) as never;
  prisma.resourceChunk.findMany = (() => { throw new Error('PDF text must never be consulted during chat'); }) as never;
  prisma.resource.findMany = (async () => [{
    id: 'bli', title: 'BLI', description: 'Resumen revisado por administrador', type: 'BROCHURE', active: true,
    year: 2027, shareFrom: new Date('2026-01-01'), shareUntil: new Date('2027-08-31'),
    validFrom: new Date('2027-07-04'), validUntil: new Date('2027-08-08'),
    minWeeks: null, maxWeeks: null, tariffs: [], minAge: null, maxAge: null,
    priceFrom: null, priceCurrency: null, priceUnit: null, priceNotes: null,
    country: { code: 'CA' }, family: { key: 'CAMP' }, program: null, location: null, locationAssignments: [], seasonKeys: ['SUMMER'],
  }]) as never;
  const result = await new ConciergeToolExecutorService().execute('search_resource_content', { inquiryId: 'inquiry', query: '¿Cuánto cuesta una semana extra?' }) as {
    source: string; matches: Array<{ description: string; tripCompatibility: string; minWeeks: number | null; tariffs: unknown[]; priceFrom: number | null }>;
  };
  assert.equal(result.source, 'CONFIRMED_RESOURCE_FORM');
  assert.equal(result.matches[0]!.description, 'Resumen revisado por administrador');
  assert.equal(result.matches[0]!.tripCompatibility, 'INCOMPATIBLE');
  assert.equal(result.matches[0]!.minWeeks, null);
  assert.equal(result.matches[0]!.priceFrom, null);
  assert.deepEqual(result.matches[0]!.tariffs, []);
});
