import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import type { CatalogProgramRecommendationQuery } from '../../domain/types/catalog.types.js';

export class ListCatalogRecommendedProgramsUseCase {
  constructor(private readonly catalogRepository: CatalogReadRepository) {}

  execute(query: CatalogProgramRecommendationQuery) {
    return this.catalogRepository.findRecommendedPrograms(query);
  }
}
