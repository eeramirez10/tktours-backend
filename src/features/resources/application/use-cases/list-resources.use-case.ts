import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';
import type { ListResourcesQuery } from '../../domain/types/resource.types.js';

export class ListResourcesUseCase {
  constructor(private readonly resourceReadRepository: ResourceReadRepository) {}

  execute(query: ListResourcesQuery) {
    return this.resourceReadRepository.findResources(query);
  }
}
