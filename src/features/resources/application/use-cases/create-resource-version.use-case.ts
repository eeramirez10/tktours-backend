import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';
import type { CreateResourceVersionInput } from '../../domain/types/resource.types.js';

export class CreateResourceVersionUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  execute(input: CreateResourceVersionInput) {
    return this.resourceRepository.createResourceVersion(input);
  }
}
