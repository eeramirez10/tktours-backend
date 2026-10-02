export type ResourceFamilyKey = string;
export type ResourceSeasonKey = 'SUMMER' | 'EASTER' | 'WINTER';

export type ResourceTypeKey = 'QUOTE' | 'INFO' | 'BROCHURE' | 'MANUAL' | 'PRESENTATION';
export type WritableResourceTypeKey = 'BROCHURE' | 'MANUAL';

export type ResourceSourceType = 'UPLOAD' | 'EXTERNAL_LINK';

export type ResourceStorageProvider = 'S3' | 'R2' | 'SUPABASE' | 'EXTERNAL';

export type ResourceExtractionStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export type ListResourcesQuery = {
  activeOnly: boolean;
  countryCode?: string;
  familyKey?: ResourceFamilyKey;
  type?: ResourceTypeKey;
  programSlug?: string;
  locationSlug?: string;
  search?: string;
};

export type ResourcesHealth = {
  feature: 'resources';
  ready: boolean;
};

export type ResourceBaseInput = {
  countryCode: string;
  countryName?: string;
  familyKey?: ResourceFamilyKey;
  seasonKeys?: ResourceSeasonKey[];
  programSlug?: string;
  locationSlug?: string;
  locationSlugs?: string[];
  locationNames?: string[];
  locationName?: string;
  locationVenueName?: string | null;
  locationDescription?: string | null;
  type: WritableResourceTypeKey;
  title: string;
  description: string | null;
  month: number | null;
  year: number | null;
  active: boolean;
  minWeeks?: number | null;
  maxWeeks?: number | null;
  shareFrom?: Date | null;
  shareUntil?: Date | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  minAge?: number | null;
  maxAge?: number | null;
  priceFrom?: number | null;
  priceCurrency?: string | null;
  priceUnit?: string | null;
  priceNotes?: string | null;
};

export type CreateResourceInput = ResourceBaseInput & {
  createdById?: string | null;
  initialVersion?: CreateResourceVersionPayload | null;
};

export type UpdateResourceInput = {
  resourceId: string;
  countryCode?: string;
  countryName?: string;
  familyKey?: ResourceFamilyKey;
  seasonKeys?: ResourceSeasonKey[];
  programSlug?: string | null;
  locationSlug?: string | null;
  locationSlugs?: string[];
  locationNames?: string[];
  type?: WritableResourceTypeKey;
  title?: string;
  description?: string | null;
  month?: number | null;
  year?: number | null;
  active?: boolean;
  minWeeks?: number | null;
  maxWeeks?: number | null;
  shareFrom?: Date | null;
  shareUntil?: Date | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  minAge?: number | null;
  maxAge?: number | null;
  priceFrom?: number | null;
  priceCurrency?: string | null;
  priceUnit?: string | null;
  priceNotes?: string | null;
  updatedById?: string | null;
};

export type SetResourceActiveInput = {
  resourceId: string;
  active: boolean;
  updatedById?: string | null;
};

export type CreateResourceVersionUploadPayload = {
  sourceType: 'UPLOAD';
  fileName: string;
  mimeType?: string | null;
  storageProvider?: Exclude<ResourceStorageProvider, 'EXTERNAL'> | null;
  fileContentBase64: string;
};

export type CreateResourceVersionExternalPayload = {
  sourceType: 'EXTERNAL_LINK';
  fileName: string;
  mimeType?: string | null;
  externalUrl: string;
};

export type CreateResourceVersionPayload =
  | CreateResourceVersionUploadPayload
  | CreateResourceVersionExternalPayload;

export type CreateResourceVersionInput = {
  resourceId: string;
  uploadedById?: string | null;
  version: CreateResourceVersionPayload;
};

export type ResourceCountry = {
  id: string;
  code: string;
  name: string;
};

export type ResourceFamily = {
  id: string;
  key: ResourceFamilyKey;
  name: string;
};

export type ResourceProgram = {
  id: string;
  slug: string;
  name: string;
  minAge: number | null;
  maxAge: number | null;
  minWeeks: number | null;
  maxWeeks: number | null;
};

export type ResourceLocation = {
  id: string;
  slug: string;
  name: string;
  venueName: string | null;
  description: string | null;
};

export type ResourceCurrentVersion = {
  id: string;
  versionNumber: number;
  fileUrl: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  sourceType: ResourceSourceType;
  storageProvider: ResourceStorageProvider;
  createdAt: Date;
};

export type ResourceCurrentExtraction = {
  status: ResourceExtractionStatus;
  summary: string | null;
  detectedLanguage: string | null;
  extractedAt: Date | null;
};

export type ResourceVersionItem = ResourceCurrentVersion & {
  storageKey: string | null;
  isCurrent: boolean;
  extraction: ResourceCurrentExtraction | null;
};

export type ResourceListItem = {
  id: string;
  seasonKeys: string[];
  type: ResourceTypeKey;
  title: string;
  description: string | null;
  month: number | null;
  year: number | null;
  shareFrom: Date | null;
  shareUntil: Date | null;
  validityStatus: import("../resource-validity.js").ResourceValidityStatus;
  validFrom: Date | null;
  validUntil: Date | null;
  minAge: number | null;
  maxAge: number | null;
  priceFrom: number | null;
  priceCurrency: string | null;
  priceUnit: string | null;
  priceNotes: string | null;
  active: boolean;
  minWeeks: number | null;
  maxWeeks: number | null;
  country: ResourceCountry;
  family: ResourceFamily | null;
  program: ResourceProgram | null;
  location: ResourceLocation | null;
  locations: ResourceLocation[];
  currentVersion: ResourceCurrentVersion | null;
  currentExtraction: ResourceCurrentExtraction | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ResourceDetail = ResourceListItem & {
  versions: ResourceVersionItem[];
};

export type ResourceDownload = {
  resourceId: string;
  versionId: string;
  fileName: string;
  mimeType: string | null;
  sourceType: ResourceSourceType;
  externalUrl: string | null;
  storageKey: string | null;
};

export type ResourceAuditIssueSeverity = 'error' | 'warning';

export type ResourceAuditIssue = {
  code:
    | 'CAMP_BROCHURE_MISSING_PROGRAM'
    | 'CAMP_BROCHURE_MISSING_SEASON'
    | 'RESOURCE_MISSING_CURRENT_VERSION'
    | 'RESOURCE_PENDING_EXTRACTION';
  severity: ResourceAuditIssueSeverity;
  message: string;
  resourceId?: string;
  resourceTitle?: string;
  countryCode?: string;
  countryName?: string;
  seasonKey?: string | null;
  relatedResourceIds?: string[];
};

export type ResourceAuditReport = {
  generatedAt: string;
  summary: {
    resourcesChecked: number;
    errors: number;
    warnings: number;
  };
  issues: ResourceAuditIssue[];
};
