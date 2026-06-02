import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import type { ListCatalogLocationsQuery } from '../../domain/types/catalog.types.js';

export class ListCatalogLocationsUseCase {
  constructor(private readonly catalogRepository: CatalogReadRepository) {}

  execute(query: ListCatalogLocationsQuery) {
    return this.catalogRepository.findLocations(query);
  }
}
