import { env } from '../../../../shared/config/env.js';
import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';

type ReferenceCountry = { code: string; iso3: string; name: string; providerName: string };
type CacheEntry<T> = { expiresAt: number; value: T };
type CountriesNowResponse<T> = { error?: boolean; msg?: string; data?: T };

export class GeoReferenceService {
  private countriesCache: CacheEntry<ReferenceCountry[]> | null = null;
  private readonly citiesCache = new Map<string, CacheEntry<string[]>>();
  private readonly displayNames = new Intl.DisplayNames(['es'], { type: 'region' });

  async listCountries(search?: string): Promise<ReferenceCountry[]> {
    const countries = await this.getCountries();
    const normalizedSearch = this.normalize(search ?? '');
    if (!normalizedSearch) return countries;
    return countries.filter((country) =>
      this.normalize(`${country.name} ${country.providerName} ${country.code} ${country.iso3}`).includes(normalizedSearch),
    );
  }

  async listCities(countryCode: string, search?: string): Promise<string[]> {
    const normalizedCode = countryCode.trim().toUpperCase();
    const country = (await this.getCountries()).find((item) => item.code === normalizedCode);
    if (!country) throw new ValidationAppError(`Unknown country code ${normalizedCode}`);

    const cached = this.citiesCache.get(normalizedCode);
    let cities: string[];
    if (cached && cached.expiresAt > Date.now()) {
      cities = cached.value;
    } else {
      const response = await this.fetchJson<string[]>(`/cities/q?country=${encodeURIComponent(country.providerName)}`);
      cities = Array.from(new Set((response.data ?? []).map((city) => city.trim()).filter(Boolean)))
        .sort((left, right) => left.localeCompare(right, 'es'));
      this.citiesCache.set(normalizedCode, { value: cities, expiresAt: Date.now() + env.GEO_CATALOG_CACHE_TTL_MS });
    }

    const normalizedSearch = this.normalize(search ?? '');
    const filtered = normalizedSearch ? cities.filter((city) => this.normalize(city).includes(normalizedSearch)) : cities;
    return filtered.slice(0, 100);
  }

  private async getCountries(): Promise<ReferenceCountry[]> {
    if (this.countriesCache && this.countriesCache.expiresAt > Date.now()) return this.countriesCache.value;

    const response = await this.fetchJson<Array<{ name?: string; Iso2?: string; Iso3?: string }>>('/iso');
    const countries = (response.data ?? []).map((country) => {
      const code = country.Iso2?.trim().toUpperCase() ?? '';
      const providerName = country.name?.trim() ?? '';
      if (!code || !providerName) return null;
      return { code, iso3: country.Iso3?.trim().toUpperCase() ?? '', name: this.displayNames.of(code) ?? providerName, providerName };
    }).filter((country): country is ReferenceCountry => country !== null)
      .sort((left, right) => left.name.localeCompare(right.name, 'es'));

    this.countriesCache = { value: countries, expiresAt: Date.now() + env.GEO_CATALOG_CACHE_TTL_MS };
    return countries;
  }

  private async fetchJson<T>(path: string): Promise<CountriesNowResponse<T>> {
    const response = await fetch(`${env.GEO_CATALOG_BASE_URL.replace(/\/+$/, '')}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(env.GEO_CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) throw new ValidationAppError('The geographic catalog service is temporarily unavailable');
    const payload = await response.json() as CountriesNowResponse<T>;
    if (payload.error || !Array.isArray(payload.data)) throw new ValidationAppError(payload.msg || 'Invalid geographic catalog response');
    return payload;
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}
