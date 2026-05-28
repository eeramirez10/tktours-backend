import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';

export class GetResourceDownloadUseCase {
  constructor(private readonly resourceRepository: ResourceReadRepository) {}

  execute(resourceId: string, versionId: string) {
    return this.resourceRepository.getDownload(resourceId, versionId);
  }
}
