import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import type { CatalogCollectionQuery, CatalogFamily } from '../../domain/types/catalog.types.js';

export class ListCatalogFamiliesUseCase {
  constructor(private readonly catalogRepository: CatalogReadRepository) {}

  execute(query: CatalogCollectionQuery): Promise<CatalogFamily[]> {
    return this.catalogRepository.findFamilies(query);
  }
}
