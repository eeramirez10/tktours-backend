import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';

export class AuditResourcesUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  async execute() {
    return this.resourceRepository.auditResources();
  }
}
