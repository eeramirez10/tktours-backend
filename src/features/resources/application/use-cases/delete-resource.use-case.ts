import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';

export class DeleteResourceUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  execute(resourceId: string) {
    return this.resourceRepository.deleteResource(resourceId);
  }
}
