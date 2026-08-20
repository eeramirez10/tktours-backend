export type CatalogFamilyKey = 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';

export type CatalogQuoteMode = 'WEEK' | 'SEMESTER' | 'YEAR' | 'MINI_STAY';

export type CatalogSeasonKey =
  | 'SUMMER'
  | 'WINTER'
  | 'EASTER'
  | 'YEAR_ROUND'
  | 'JANUARY'
  | 'SEPTEMBER'
  | 'CUSTOM';

export type CatalogAccommodationKey =
  | 'HOST_FAMILY'
  | 'UNIVERSITY_RESIDENCE'
  | 'SHARED_APARTMENT';

export type ResourceTypeKey = 'QUOTE' | 'INFO' | 'BROCHURE' | 'MANUAL' | 'PRESENTATION';

export type CatalogCollectionQuery = {
  activeOnly: boolean;
};

export type ListCatalogProgramsQuery = CatalogCollectionQuery & {
  countryCode?: string;
  familyKey?: CatalogFamilyKey;
  locationSlug?: string;
  search?: string;
};

export type ListCatalogLocationsQuery = CatalogCollectionQuery & {
  countryCode?: string;
  familyKey?: CatalogFamilyKey;
  search?: string;
};

export type CatalogProgramRecommendationQuery = {
  countryCode: string;
  familyKey?: CatalogFamilyKey;
  locationSlug?: string;
  studentAge?: number;
  accommodationKey?: CatalogAccommodationKey;
  preferredStartMonth?: number;
  weeks?: number;
  search?: string;
};

export type CatalogHealth = {
  feature: 'catalog';
  ready: boolean;
};

export type CatalogCountry = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

export type CreateCatalogCountryInput = {
  code: string;
  name: string;
  active: boolean;
};

export type UpdateCatalogCountryInput = {
  countryId: string;
  code?: string;
  name?: string;
  active?: boolean;
};

export type CatalogFamily = {
  id: string;
  key: CatalogFamilyKey;
  name: string;
  active: boolean;
};

export type CatalogProgramLocation = {
  id: string;
  slug: string;
  name: string;
  venueName: string | null;
  description: string | null;
  active: boolean;
  country: CatalogCountry;
};

export type CreateCatalogLocationInput = {
  countryCode: string;
  name: string;
  venueName?: string | null;
  description?: string | null;
  active: boolean;
};

export type UpdateCatalogLocationInput = {
  locationId: string;
  countryCode?: string;
  name?: string;
  venueName?: string | null;
  description?: string | null;
  active?: boolean;
};

export type CatalogProgramPrice = {
  currency: string;
  amountFrom: string | null;
  amountTo: string | null;
  priceLabel: string | null;
  notes: string | null;
  year: number | null;
};

export type CatalogProgramAccommodation = {
  key: CatalogAccommodationKey;
  name: string;
  minAge: number | null;
  maxAge: number | null;
  notes: string | null;
};

export type CatalogProgramStartWindow = {
  seasonKey: CatalogSeasonKey;
  startMonth: number | null;
  endMonth: number | null;
  startDay: number | null;
  endDay: number | null;
  startsEveryMonday: boolean;
  notes: string | null;
};

export type CatalogProgram = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  minAge: number | null;
  maxAge: number | null;
  active: boolean;
  country: CatalogCountry;
  family: CatalogFamily;
  location: CatalogProgramLocation | null;
  quoteMode: CatalogQuoteMode | null;
  minWeeks: number | null;
  maxWeeks: number | null;
  weekOptions: number[];
  allowsMiniStay: boolean;
  miniStayGroupOnly: boolean;
  ruleNotes: string | null;
  prices: CatalogProgramPrice[];
  accommodations: CatalogProgramAccommodation[];
  startWindows: CatalogProgramStartWindow[];
};

export type CatalogResourceSummary = {
  id: string;
  title: string;
  type: ResourceTypeKey;
  active: boolean;
  fileName: string | null;
  fileUrl: string | null;
  month: number | null;
  year: number | null;
};

export type CatalogProgramDetail = CatalogProgram & {
  resources: CatalogResourceSummary[];
};

export type CatalogProgramRecommendation = CatalogProgramDetail & {
  matchReasons: string[];
};
