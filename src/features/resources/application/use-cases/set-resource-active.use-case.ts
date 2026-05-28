import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';
import type { SetResourceActiveInput } from '../../domain/types/resource.types.js';

export class SetResourceActiveUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  execute(input: SetResourceActiveInput) {
    return this.resourceRepository.setResourceActive(input);
  }
}
