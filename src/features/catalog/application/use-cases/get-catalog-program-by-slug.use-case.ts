import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';

export class GetCatalogProgramBySlugUseCase {
  constructor(private readonly catalogRepository: CatalogReadRepository) {}

  execute(slug: string) {
    return this.catalogRepository.findProgramBySlug(slug);
  }
}
