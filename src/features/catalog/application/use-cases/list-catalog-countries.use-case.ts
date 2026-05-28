import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import type { CatalogCollectionQuery, CatalogCountry } from '../../domain/types/catalog.types.js';

export class ListCatalogCountriesUseCase {
  constructor(private readonly catalogRepository: CatalogReadRepository) {}

  execute(query: CatalogCollectionQuery): Promise<CatalogCountry[]> {
    return this.catalogRepository.findCountries(query);
  }
}
