import type {
  CreateResourceInput,
  CreateResourceVersionInput,
  ListResourcesQuery,
  ResourceDetail,
  ResourceDownload,
  ResourceListItem,
  SetResourceActiveInput,
  UpdateResourceInput,
} from '../types/resource.types.js';

export interface ResourceReadRepository {
  findResources(query: ListResourcesQuery): Promise<ResourceListItem[]>;
  findResourceById(resourceId: string): Promise<ResourceDetail | null>;
  createResource(input: CreateResourceInput): Promise<ResourceDetail>;
  updateResource(input: UpdateResourceInput): Promise<ResourceDetail>;
  setResourceActive(input: SetResourceActiveInput): Promise<ResourceDetail>;
  createResourceVersion(input: CreateResourceVersionInput): Promise<ResourceDetail>;
  getDownload(resourceId: string, versionId: string): Promise<ResourceDownload | null>;
  deleteResource(resourceId: string): Promise<void>;
}
