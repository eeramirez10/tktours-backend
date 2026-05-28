import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';
import type { UpdateResourceInput } from '../../domain/types/resource.types.js';

export class UpdateResourceUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  execute(input: UpdateResourceInput) {
    return this.resourceRepository.updateResource(input);
  }
}
