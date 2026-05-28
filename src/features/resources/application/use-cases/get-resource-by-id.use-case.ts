import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';

export class GetResourceByIdUseCase {
  constructor(private readonly resourceReadRepository: ResourceReadRepository) {}

  execute(resourceId: string) {
    return this.resourceReadRepository.findResourceById(resourceId);
  }
}
