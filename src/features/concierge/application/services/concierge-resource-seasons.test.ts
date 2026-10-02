import assert from 'node:assert/strict';
import test from 'node:test';

import { ConciergeOrchestratorService, type ConciergeTurnContext } from './concierge-orchestrator.service.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

type Candidate = { resourceId: string; resourceTitle: string; versionId: string; seasonKeys: string[] };
const service = Object.create(ConciergeOrchestratorService.prototype) as {
  getSeasonalCampBrochureCandidates: (candidates: Candidate[]) => Candidate[];
  getCampBrochureSeasonLabels: (candidates: Candidate[]) => string[];
  selectCampBrochureCandidatesForReply: (candidates: Candidate[], action: { sendAll: boolean; selectedSeasonKeys: string[] }) => Candidate[];
  haveSameCampBrochureCandidates: (left: Candidate[], right: Candidate[]) => boolean;
  toCampBrochureCandidate: (resource: Record<string, unknown>) => Candidate | null;
};
const first = { resourceId: '1', versionId: 'v1', resourceTitle: 'Montreal BLI', seasonKeys: ['SUMMER'] };
const second = { resourceId: '2', versionId: 'v2', resourceTitle: 'Quebec deportivo', seasonKeys: ['SUMMER'] };
const multi = { resourceId: '3', versionId: 'v3', resourceTitle: 'Campamento dos temporadas', seasonKeys: ['EASTER', 'WINTER'] };

test('multiple offers in one season survive filtering and are sent on confirmation', () => {
  const candidates = service.getSeasonalCampBrochureCandidates([first, second, first, multi]);
  assert.equal(candidates.length, 3);
  assert.deepEqual(service.selectCampBrochureCandidatesForReply(candidates, { sendAll: false, selectedSeasonKeys: ['SUMMER'] }), [first, second]);
  assert.deepEqual(service.selectCampBrochureCandidatesForReply([first, second], { sendAll: false, selectedSeasonKeys: [] }), [first, second]);
});

test('multi-season PDFs list all their seasons and are never sent twice', () => {
  assert.deepEqual(service.getCampBrochureSeasonLabels([first, multi]), ['verano', 'Semana Santa', 'invierno']);
  assert.deepEqual(service.selectCampBrochureCandidatesForReply([first, multi], { sendAll: false, selectedSeasonKeys: ['WINTER'] }), [multi]);
  assert.deepEqual(service.selectCampBrochureCandidatesForReply([first, multi], { sendAll: false, selectedSeasonKeys: ['EASTER', 'WINTER'] }), [multi]);
  assert.deepEqual(service.selectCampBrochureCandidatesForReply([first], { sendAll: false, selectedSeasonKeys: ['WINTER'] }), []);
});

test('brochure season changes invalidate the cached offer even when the file version is unchanged', () => {
  assert.equal(service.haveSameCampBrochureCandidates([first], [{ ...first, seasonKeys: ['WINTER'] }]), false);
  assert.equal(service.haveSameCampBrochureCandidates([multi], [{ ...multi, seasonKeys: ['WINTER', 'EASTER'] }]), true);
});

test('brochure candidates do not inherit all seasons from their program', () => {
  const candidate = service.toCampBrochureCandidate({
    id: 'resource', title: 'Canadá Verano', countryCode: 'CA',
    seasonKeys: ['SUMMER'], programSeasonKeys: ['SUMMER', 'EASTER', 'WINTER'],
    currentVersion: { id: 'version', fileName: 'camp.pdf', fileUrl: 'https://example.com/camp.pdf' },
  });
  assert.deepEqual(candidate?.seasonKeys, ['SUMMER']);
  const unclassified = service.toCampBrochureCandidate({
    id: 'resource', title: 'Sin clasificar', countryCode: 'CA',
    programSeasonKeys: ['SUMMER'],
    currentVersion: { id: 'version', fileName: 'camp.pdf', fileUrl: 'https://example.com/camp.pdf' },
  });
  assert.deepEqual(unclassified?.seasonKeys, []);
});

test('a selected program and city filter the brochure query without falling back to another city', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const orchestrator = Object.create(ConciergeOrchestratorService.prototype) as {
    toolExecutor: { execute: (name: string, args: Record<string, unknown>) => Promise<{ resources: unknown[] }> };
    findCampBrochureCandidates: (context: ConciergeTurnContext) => Promise<Candidate[]>;
  };
  orchestrator.toolExecutor = { execute: async (_name, args) => { calls.push(args); return { resources: [] }; } };
  const result = await orchestrator.findCampBrochureCandidates({
    activeInquiry: {
      family: { key: 'CAMP' }, country: { code: 'CA' },
      program: { slug: 'camp-bli' }, location: { slug: 'montreal' }, studentAge: 16,
    },
  } as unknown as ConciergeTurnContext);
  assert.deepEqual(result, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.programSlug, 'camp-bli');
  assert.equal(calls[0]?.locationSlug, 'montreal');
});

test('resource tools expose PDF seasons and exclude unclassified camp brochures', async (context) => {
  const resource = {
    id: 'test', title: 'PDF de verano', type: 'BROCHURE', description: null,
    seasonKeys: ['SUMMER'], validFrom: null, validUntil: null,
    country: { code: 'CA', name: 'Canadá' }, family: { key: 'CAMP', name: 'Campamentos' },
    location: null, locationAssignments: [], program: null,
    versions: [{ id: 'v1', fileName: 'camp.pdf', sourceType: 'EXTERNAL_LINK', fileUrl: 'https://example.com/camp.pdf' }],
  };
  const original = prisma.resource.findMany;
  context.after(() => { prisma.resource.findMany = original; });
  prisma.resource.findMany = (async (query: { select: { seasonKeys: boolean } }) => {
    assert.equal(query.select.seasonKeys, true);
    return [resource, { ...resource, id: 'unclassified', seasonKeys: [] }];
  }) as unknown as typeof prisma.resource.findMany;
  const executor = Object.create(ConciergeToolExecutorService.prototype) as {
    listAvailableResources: (args: Record<string, unknown>) => Promise<{ resources: Array<{ id: string; seasonKeys: string[] }> }>;
  };
  const result = await executor.listAvailableResources({ countryCode: 'CA', familyKey: 'CAMP' });
  assert.equal(result.resources.length, 1);
  assert.deepEqual(result.resources[0]?.seasonKeys, ['SUMMER']);
});
