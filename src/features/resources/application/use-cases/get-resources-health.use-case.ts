import type { ResourcesHealth } from '../../domain/types/resource.types.js';

export class GetResourcesHealthUseCase {
  execute(): ResourcesHealth {
    return {
      feature: 'resources',
      ready: true,
    };
  }
}
