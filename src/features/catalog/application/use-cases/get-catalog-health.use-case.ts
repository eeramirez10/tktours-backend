import type { CatalogHealth } from '../../domain/types/catalog.types.js';

export class GetCatalogHealthUseCase {
  execute(): CatalogHealth {
    return {
      feature: 'catalog',
      ready: true,
    };
  }
}
