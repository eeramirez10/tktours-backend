import type {
  CatalogCollectionQuery,
  CatalogCountry,
  CatalogFamily,
  CatalogProgram,
  CatalogProgramDetail,
  CatalogProgramRecommendation,
  CatalogProgramRecommendationQuery,
  ListCatalogProgramsQuery,
} from '../types/catalog.types.js';

export interface CatalogReadRepository {
  findCountries(query: CatalogCollectionQuery): Promise<CatalogCountry[]>;
  findFamilies(query: CatalogCollectionQuery): Promise<CatalogFamily[]>;
  findPrograms(query: ListCatalogProgramsQuery): Promise<CatalogProgram[]>;
  findProgramBySlug(slug: string): Promise<CatalogProgramDetail | null>;
  findRecommendedPrograms(query: CatalogProgramRecommendationQuery): Promise<CatalogProgramRecommendation[]>;
}
