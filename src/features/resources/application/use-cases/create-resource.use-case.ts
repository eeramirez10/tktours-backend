import type { CreateResourceInput, ResourceListItem } from '../../domain/types/resource.types.js';
import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';

export class CreateResourceUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  execute(input: CreateResourceInput): Promise<ResourceListItem> {
    return this.resourceRepository.createResource(input);
  }
}
