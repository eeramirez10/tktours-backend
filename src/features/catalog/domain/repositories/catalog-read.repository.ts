import type {
  CatalogCollectionQuery,
  CatalogCountry,
  CatalogFamily,
  CatalogProgramLocation,
  CatalogProgram,
  CatalogProgramDetail,
  CatalogProgramRecommendation,
  CatalogProgramRecommendationQuery,
  ListCatalogProgramsQuery,
  ListCatalogLocationsQuery,
} from '../types/catalog.types.js';

export interface CatalogReadRepository {
  findCountries(query: CatalogCollectionQuery): Promise<CatalogCountry[]>;
  findFamilies(query: CatalogCollectionQuery): Promise<CatalogFamily[]>;
  findLocations(query: ListCatalogLocationsQuery): Promise<CatalogProgramLocation[]>;
  findPrograms(query: ListCatalogProgramsQuery): Promise<CatalogProgram[]>;
  findProgramBySlug(slug: string): Promise<CatalogProgramDetail | null>;
  findRecommendedPrograms(query: CatalogProgramRecommendationQuery): Promise<CatalogProgramRecommendation[]>;
}
