import type { ConciergeCity } from '../../domain/city-selection.js';

type ToolExecutor = { execute: (name: string, args: unknown) => Promise<unknown> };
type Resource = Record<string, unknown>;

export class ConciergeCityResourcesService {
  constructor(private readonly tools: ToolExecutor) {}

  async load(input: { countryCode: string; familyKey: string; studentAge?: number; targetDate?: string; locationSlug?: string; programSlug?: string }) {
    const [locationsResult, programsResult, resourcesResult] = await Promise.all([
      this.tools.execute('list_available_locations', { countryCode: input.countryCode, familyKey: input.familyKey, activeOnly: true }),
      this.tools.execute('list_available_programs', { countryCode: input.countryCode, familyKey: input.familyKey, activeOnly: true }),
      this.tools.execute('list_available_resources', { ...input, type: 'BROCHURE', activeOnly: true }),
    ]);
    const records = (value: unknown, key: string): Resource[] => {
      if (!value || typeof value !== 'object') return [];
      const list = (value as Resource)[key];
      return Array.isArray(list) ? list.filter((item): item is Resource => Boolean(item) && typeof item === 'object') : [];
    };
    const resources = records(resourcesResult, 'resources');
    const programs = records(programsResult, 'programs');
    const allowed = new Map<string, string>();
    for (const program of programs) {
      if (typeof program.locationSlug === 'string' && typeof program.locationName === 'string') allowed.set(program.locationSlug, program.locationName);
    }
    for (const resource of resources) {
      const slugs = Array.isArray(resource.locationSlugs) ? resource.locationSlugs : [];
      const names = Array.isArray(resource.locationNames) ? resource.locationNames : [];
      slugs.forEach((slug, index) => { if (typeof slug === 'string' && typeof names[index] === 'string') allowed.set(slug, names[index]); });
      if (typeof resource.locationSlug === 'string' && typeof resource.locationName === 'string' && !allowed.has(resource.locationSlug)) {
        allowed.set(resource.locationSlug, resource.locationName);
      }
    }
    for (const location of records(locationsResult, 'locations')) {
      if (typeof location.slug === 'string' && typeof location.name === 'string' && allowed.has(location.slug)) allowed.set(location.slug, location.name);
    }
    const cities: ConciergeCity[] = [...allowed].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return { cities, resources, programs };
  }
}
