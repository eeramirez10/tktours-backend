import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import type { CatalogProgram, ListCatalogProgramsQuery } from '../../domain/types/catalog.types.js';

export class ListCatalogProgramsUseCase {
  constructor(private readonly catalogRepository: CatalogReadRepository) {}

  execute(query: ListCatalogProgramsQuery): Promise<CatalogProgram[]> {
    return this.catalogRepository.findPrograms(query);
  }
}
