export type ResourceFamilyKey = 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';

export type ResourceTypeKey = 'QUOTE' | 'INFO' | 'BROCHURE' | 'MANUAL' | 'PRESENTATION';

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
  familyKey?: ResourceFamilyKey;
  programSlug?: string;
  locationSlug?: string;
  locationName?: string;
  locationVenueName?: string | null;
  locationDescription?: string | null;
  type: ResourceTypeKey;
  title: string;
  description: string | null;
  month: number | null;
  year: number | null;
  active: boolean;
};

export type CreateResourceInput = ResourceBaseInput & {
  createdById?: string | null;
  initialVersion?: CreateResourceVersionPayload | null;
};

export type UpdateResourceInput = {
  resourceId: string;
  countryCode?: string;
  familyKey?: ResourceFamilyKey;
  programSlug?: string | null;
  locationSlug?: string | null;
  type?: ResourceTypeKey;
  title?: string;
  description?: string | null;
  month?: number | null;
  year?: number | null;
  active?: boolean;
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
  type: ResourceTypeKey;
  title: string;
  description: string | null;
  month: number | null;
  year: number | null;
  active: boolean;
  country: ResourceCountry;
  family: ResourceFamily | null;
  program: ResourceProgram | null;
  location: ResourceLocation | null;
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
