import { Prisma, ResourceSourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';
import type {
  CreateResourceInput,
  CreateResourceVersionInput,
  ResourceCurrentExtraction,
  ResourceCurrentVersion,
  ResourceDetail,
  ResourceDownload,
  ResourceListItem,
  ResourceVersionItem,
  SetResourceActiveInput,
  UpdateResourceInput,
  ListResourcesQuery,
} from '../../domain/types/resource.types.js';
import { LocalResourceStorageService } from '../storage/local-resource-storage.service.js';

const listSelect = {
  id: true,
  type: true,
  title: true,
  description: true,
  month: true,
  year: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  country: { select: { id: true, code: true, name: true } },
  family: { select: { id: true, key: true, name: true } },
  program: { select: { id: true, slug: true, name: true } },
  versions: {
    where: { isCurrent: true },
    orderBy: { versionNumber: 'desc' },
    take: 1,
    select: {
      id: true,
      versionNumber: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      sourceType: true,
      storageProvider: true,
      storageKey: true,
      isCurrent: true,
      createdAt: true,
      extraction: {
        select: {
          status: true,
          summary: true,
          detectedLanguage: true,
          extractedAt: true,
        },
      },
    },
  },
} satisfies Prisma.ResourceSelect;

const detailSelect = {
  ...listSelect,
  versions: {
    orderBy: [{ versionNumber: 'desc' }],
    select: {
      id: true,
      versionNumber: true,
      fileUrl: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      sourceType: true,
      storageProvider: true,
      storageKey: true,
      isCurrent: true,
      createdAt: true,
      extraction: {
        select: {
          status: true,
          summary: true,
          detectedLanguage: true,
          extractedAt: true,
        },
      },
    },
  },
} satisfies Prisma.ResourceSelect;

type ResourceListRecord = Prisma.ResourceGetPayload<{ select: typeof listSelect }>;
type ResourceDetailRecord = Prisma.ResourceGetPayload<{ select: typeof detailSelect }>;

type ResolvedRelations = {
  countryId: string;
  familyId: string | null;
  programId: string | null;
};

function mapExtraction(extraction: ResourceListRecord['versions'][number]['extraction'] | null): ResourceCurrentExtraction | null {
  if (!extraction) {
    return null;
  }

  return {
    status: extraction.status,
    summary: extraction.summary,
    detectedLanguage: extraction.detectedLanguage,
    extractedAt: extraction.extractedAt,
  };
}

function mapVersion(version: ResourceDetailRecord['versions'][number]): ResourceVersionItem {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    fileUrl: version.fileUrl,
    fileName: version.fileName,
    mimeType: version.mimeType,
    fileSize: version.fileSize,
    sourceType: version.sourceType,
    storageProvider: version.storageProvider,
    storageKey: version.storageKey,
    isCurrent: version.isCurrent,
    createdAt: version.createdAt,
    extraction: mapExtraction(version.extraction),
  };
}

function mapCurrentVersion(version: ResourceListRecord['versions'][number] | null): ResourceCurrentVersion | null {
  if (!version) {
    return null;
  }

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    fileUrl: version.fileUrl,
    fileName: version.fileName,
    mimeType: version.mimeType,
    fileSize: version.fileSize,
    sourceType: version.sourceType,
    storageProvider: version.storageProvider,
    createdAt: version.createdAt,
  };
}

function mapListResource(resource: ResourceListRecord): ResourceListItem {
  const currentVersion = resource.versions[0] ?? null;

  return {
    id: resource.id,
    type: resource.type,
    title: resource.title,
    description: resource.description,
    month: resource.month,
    year: resource.year,
    active: resource.active,
    country: resource.country,
    family: resource.family,
    program: resource.program,
    currentVersion: mapCurrentVersion(currentVersion),
    currentExtraction: mapExtraction(currentVersion?.extraction ?? null),
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

function mapDetailResource(resource: ResourceDetailRecord): ResourceDetail {
  return {
    ...mapListResource(resource),
    versions: resource.versions.map(mapVersion),
  };
}

export class ResourceRepository implements ResourceReadRepository {
  constructor(private readonly storage = new LocalResourceStorageService()) {}

  async findResources(query: ListResourcesQuery): Promise<ResourceListItem[]> {
    const where: Prisma.ResourceWhereInput = {
      ...(query.activeOnly ? { active: true } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.countryCode ? { country: { code: query.countryCode } } : {}),
      ...(query.familyKey ? { family: { key: query.familyKey } } : {}),
      ...(query.programSlug ? { program: { slug: query.programSlug } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { program: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const resources = await prisma.resource.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { title: 'asc' }],
      select: listSelect,
    });

    return resources.map(mapListResource);
  }

  async findResourceById(resourceId: string): Promise<ResourceDetail | null> {
    const resource = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: detailSelect,
    });

    return resource ? mapDetailResource(resource) : null;
  }

  async createResource(input: CreateResourceInput): Promise<ResourceDetail> {
    const relations = await this.resolveRelations(input);

    const resource = await prisma.resource.create({
      data: {
        countryId: relations.countryId,
        familyId: relations.familyId,
        programId: relations.programId,
        type: input.type,
        title: input.title,
        description: input.description,
        month: input.month,
        year: input.year,
        active: input.active,
        createdById: input.createdById ?? null,
        updatedById: input.createdById ?? null,
      },
      select: detailSelect,
    });

    if (!input.initialVersion) {
      return mapDetailResource(resource);
    }

    return this.createResourceVersion({
      resourceId: resource.id,
      uploadedById: input.createdById ?? null,
      version: input.initialVersion,
    });
  }

  async updateResource(input: UpdateResourceInput): Promise<ResourceDetail> {
    const current = await prisma.resource.findUnique({
      where: { id: input.resourceId },
      select: {
        id: true,
        country: { select: { code: true } },
        family: { select: { key: true } },
        program: { select: { slug: true } },
      },
    });

    if (!current) {
      throw new NotFoundAppError('Resource not found');
    }

    const nextCountryCode = input.countryCode ?? current.country.code;
    const nextFamilyKey = input.familyKey ?? current.family?.key;
    const nextProgramSlug = Object.prototype.hasOwnProperty.call(input, 'programSlug')
      ? input.programSlug ?? undefined
      : current.program?.slug;

    const relations = await this.resolveRelations({
      countryCode: nextCountryCode,
      familyKey: nextFamilyKey,
      programSlug: nextProgramSlug,
    });

    const updated = await prisma.resource.update({
      where: { id: input.resourceId },
      data: {
        countryId: relations.countryId,
        familyId: relations.familyId,
        programId: relations.programId,
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.month !== undefined ? { month: input.month } : {}),
        ...(input.year !== undefined ? { year: input.year } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        updatedById: input.updatedById ?? null,
      },
      select: detailSelect,
    });

    return mapDetailResource(updated);
  }

  async setResourceActive(input: SetResourceActiveInput): Promise<ResourceDetail> {
    try {
      const updated = await prisma.resource.update({
        where: { id: input.resourceId },
        data: {
          active: input.active,
          updatedById: input.updatedById ?? null,
        },
        select: detailSelect,
      });

      return mapDetailResource(updated);
    } catch (error) {
      if (this.isPrismaNotFound(error)) {
        throw new NotFoundAppError('Resource not found');
      }
      throw error;
    }
  }

  async createResourceVersion(input: CreateResourceVersionInput): Promise<ResourceDetail> {
    const resource = await prisma.resource.findUnique({
      where: { id: input.resourceId },
      select: {
        id: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: { id: true, versionNumber: true, storageKey: true, sourceType: true },
          take: 1,
        },
      },
    });

    if (!resource) {
      throw new NotFoundAppError('Resource not found');
    }

    const nextVersionNumber = (resource.versions[0]?.versionNumber ?? 0) + 1;
    const versionId = randomUUID();

    let storageKey: string | null = null;
    let fileUrl: string;
    let fileSize: number | null = null;
    let mimeType: string | null = input.version.mimeType ?? null;
    let storageProvider: Prisma.ResourceVersionCreateInput['storageProvider'];

    if (input.version.sourceType === ResourceSourceType.UPLOAD) {
      const content = this.decodeBase64(input.version.fileContentBase64);
      fileSize = content.byteLength;
      storageProvider = input.version.storageProvider ?? 'SUPABASE';
      storageKey = await this.storage.writeVersionFile({
        resourceId: input.resourceId,
        versionId,
        fileName: input.version.fileName,
        content,
      });
      fileUrl = `/api/resources/${input.resourceId}/versions/${versionId}/download`;
    } else {
      storageProvider = 'EXTERNAL';
      fileUrl = input.version.externalUrl;
    }

    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.resourceVersion.updateMany({
          where: { resourceId: input.resourceId, isCurrent: true },
          data: { isCurrent: false },
        });

        await tx.resourceVersion.create({
          data: {
            id: versionId,
            resourceId: input.resourceId,
            versionNumber: nextVersionNumber,
            storageProvider,
            sourceType: input.version.sourceType,
            fileUrl,
            storageKey,
            fileName: input.version.fileName,
            mimeType,
            fileSize,
            uploadedById: input.uploadedById ?? null,
            isCurrent: true,
            extraction: {
              create: {
                status: 'PENDING',
              },
            },
          },
        });
      });
    } catch (error) {
      await this.storage.deleteByStorageKey(storageKey);
      throw error;
    }

    const detail = await this.findResourceById(input.resourceId);
    if (!detail) {
      throw new NotFoundAppError('Resource not found after version creation');
    }

    return detail;
  }

  async getDownload(resourceId: string, versionId: string): Promise<ResourceDownload | null> {
    const version = await prisma.resourceVersion.findFirst({
      where: {
        id: versionId,
        resourceId,
      },
      select: {
        id: true,
        resourceId: true,
        fileName: true,
        mimeType: true,
        sourceType: true,
        fileUrl: true,
        storageKey: true,
      },
    });

    if (!version) {
      return null;
    }

    return {
      resourceId: version.resourceId,
      versionId: version.id,
      fileName: version.fileName,
      mimeType: version.mimeType,
      sourceType: version.sourceType,
      externalUrl: version.sourceType === 'EXTERNAL_LINK' ? version.fileUrl : null,
      storageKey: version.storageKey,
    };
  }

  async deleteResource(resourceId: string): Promise<void> {
    const versions = await prisma.resourceVersion.findMany({
      where: { resourceId },
      select: { storageKey: true },
    });

    try {
      await prisma.resource.delete({ where: { id: resourceId } });
    } catch (error) {
      if (this.isPrismaNotFound(error)) {
        throw new NotFoundAppError('Resource not found');
      }
      throw error;
    }

    await Promise.allSettled(
      versions.map((version: { storageKey: string | null }) => this.storage.deleteByStorageKey(version.storageKey)),
    );
  }

  private async resolveRelations(input: {
    countryCode: string;
    familyKey?: string;
    programSlug?: string;
  }): Promise<ResolvedRelations> {
    const country = await prisma.country.findUnique({
      where: { code: input.countryCode },
      select: { id: true },
    });

    if (!country) {
      throw new NotFoundAppError(`Country not found for code ${input.countryCode}`);
    }

    const family = input.familyKey
      ? await prisma.productFamily.findUnique({
          where: { key: input.familyKey as never },
          select: { id: true },
        })
      : null;

    if (input.familyKey && !family) {
      throw new NotFoundAppError(`Family not found for key ${input.familyKey}`);
    }

    const program = input.programSlug
      ? await prisma.program.findFirst({
          where: {
            slug: input.programSlug,
            countryId: country.id,
          },
          select: {
            id: true,
            familyId: true,
          },
        })
      : null;

    if (input.programSlug && !program) {
      throw new NotFoundAppError(`Program not found for slug ${input.programSlug} in country ${input.countryCode}`);
    }

    if (program && family && program.familyId !== family.id) {
      throw new ConflictAppError('Program does not belong to the provided family');
    }

    if (program && !family) {
      throw new ValidationAppError('familyKey is required when programSlug is provided');
    }

    return {
      countryId: country.id,
      familyId: family?.id ?? null,
      programId: program?.id ?? null,
    };
  }

  private decodeBase64(value: string): Buffer {
    const normalized = value.includes(',') ? value.split(',').pop() ?? '' : value;
    const trimmed = normalized.trim();

    if (!trimmed) {
      throw new ValidationAppError('fileContentBase64 is required for uploaded files');
    }

    try {
      return Buffer.from(trimmed, 'base64');
    } catch {
      throw new ValidationAppError('fileContentBase64 must be valid base64');
    }
  }

  private isPrismaNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }
}
