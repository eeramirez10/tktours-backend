import { Prisma, QuoteMode, ResourceSourceType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { env } from '../../../../shared/config/env.js';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { ResourceReadRepository } from '../../domain/repositories/resource-read.repository.js';
import type {
  CreateResourceInput,
  CreateResourceVersionInput,
  ResourceAuditIssue,
  ResourceAuditReport,
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
  program: {
    select: {
      id: true,
      slug: true,
      name: true,
      rule: {
        select: {
          weekOptions: true,
        },
      },
    },
  },
  location: { select: { id: true, slug: true, name: true, venueName: true, description: true } },
  locationAssignments: {
    orderBy: { location: { name: 'asc' } },
    select: { location: { select: { id: true, slug: true, name: true, venueName: true, description: true } } },
  },
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
  countryCode: string;
  countryName: string;
  familyId: string | null;
  familyKey: string | null;
  programId: string | null;
  programSlug: string | null;
  programName: string | null;
  programSeasonKeys: string[];
  locationId: string | null;
  locationIds: string[];
};

function toPublicUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const baseUrl = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return pathOrUrl;
  }

  const relative = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${relative}`;
}

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
  const weekOptions = resource.program?.rule?.weekOptions ?? [];
  const program = resource.program
    ? {
        id: resource.program.id,
        slug: resource.program.slug,
        name: resource.program.name,
        weekOptions,
      }
    : null;
  const locations = resource.locationAssignments.map((assignment) => assignment.location);
  const primaryLocation = resource.location ?? locations[0];

  return {
    id: resource.id,
    type: resource.type,
    title: resource.title,
    description: resource.description,
    month: resource.month,
    year: resource.year,
    active: resource.active,
    weekOptions,
    country: resource.country,
    family: resource.family,
    program,
    location: primaryLocation,
    locations,
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
      ...(query.locationSlug ? { locationAssignments: { some: { location: { slug: query.locationSlug } } } } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { program: { name: { contains: query.search, mode: 'insensitive' } } },
              { locationAssignments: { some: { location: { name: { contains: query.search, mode: 'insensitive' } } } } },
              { locationAssignments: { some: { location: { venueName: { contains: query.search, mode: 'insensitive' } } } } },
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
    const resource = await prisma.$transaction(async (tx) => {
      const relations = await this.resolveRelations(input, tx);
      await this.validateResourceRelations({
        relations,
        resourceId: null,
        type: input.type,
        active: input.active,
      }, tx);

      const created = await tx.resource.create({
        data: {
          countryId: relations.countryId,
          familyId: relations.familyId,
          programId: relations.programId,
          locationId: relations.locationId,
          locationAssignments: {
            create: relations.locationIds.map((locationId) => ({ locationId })),
          },
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

      await this.syncProgramWeekOptions(tx, {
        programId: relations.programId,
        weekOptions: input.weekOptions,
      });

      return created;
    });

    if (!input.initialVersion) {
      return (await this.findResourceById(resource.id)) ?? mapDetailResource(resource);
    }

    return this.createResourceVersion({
      resourceId: resource.id,
      uploadedById: input.createdById ?? null,
      version: input.initialVersion,
    });
  }

  async updateResource(input: UpdateResourceInput): Promise<ResourceDetail> {
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.resource.findUnique({
        where: { id: input.resourceId },
        select: {
          id: true,
          type: true,
          active: true,
          country: { select: { code: true } },
          family: { select: { key: true } },
          program: { select: { slug: true } },
          location: { select: { slug: true } },
          locationAssignments: { select: { location: { select: { slug: true } } } },
        },
      });

      if (!current) {
        throw new NotFoundAppError('Resource not found');
      }

      const hasLocationNames = Object.prototype.hasOwnProperty.call(input, 'locationNames');
      const nextCountryCode = input.countryCode ?? current.country.code;
      const nextFamilyKey = input.familyKey ?? current.family?.key;
      const nextProgramSlug = Object.prototype.hasOwnProperty.call(input, 'programSlug')
        ? input.programSlug ?? undefined
        : current.program?.slug;
      const nextLocationSlugs = hasLocationNames
        ? []
        : Object.prototype.hasOwnProperty.call(input, 'locationSlugs')
          ? input.locationSlugs
          : Object.prototype.hasOwnProperty.call(input, 'locationSlug')
            ? input.locationSlug ? [input.locationSlug] : []
            : current.locationAssignments.length > 0
              ? current.locationAssignments.map((assignment) => assignment.location.slug)
              : current.location?.slug ? [current.location.slug] : [];
      const nextType = input.type ?? current.type;
      const nextActive = input.active ?? current.active;

      const relations = await this.resolveRelations({
        countryCode: nextCountryCode,
        countryName: input.countryName,
        familyKey: nextFamilyKey,
        programSlug: nextProgramSlug,
        locationSlugs: nextLocationSlugs,
        locationNames: hasLocationNames ? input.locationNames : undefined,
      }, tx);
      await this.validateResourceRelations({
        relations,
        resourceId: input.resourceId,
        type: nextType,
        active: nextActive,
      }, tx);

      const resource = await tx.resource.update({
        where: { id: input.resourceId },
        data: {
          countryId: relations.countryId,
          familyId: relations.familyId,
          programId: relations.programId,
          locationId: relations.locationId,
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

      await tx.resourceLocationAssignment.deleteMany({ where: { resourceId: input.resourceId } });
      if (relations.locationIds.length > 0) {
        await tx.resourceLocationAssignment.createMany({
          data: relations.locationIds.map((locationId) => ({ resourceId: input.resourceId, locationId })),
          skipDuplicates: true,
        });
      }

      await this.syncProgramWeekOptions(tx, {
        programId: relations.programId,
        weekOptions: input.weekOptions,
      });

      return resource;
    });

    return (await this.findResourceById(updated.id)) ?? mapDetailResource(updated);
  }

  async setResourceActive(input: SetResourceActiveInput): Promise<ResourceDetail> {
    try {
      if (input.active) {
        const current = await prisma.resource.findUnique({
          where: { id: input.resourceId },
          select: {
            id: true,
            type: true,
            country: { select: { code: true } },
            family: { select: { key: true } },
            program: { select: { slug: true } },
            location: { select: { slug: true } },
            locationAssignments: { select: { location: { select: { slug: true } } } },
          },
        });

        if (!current) {
          throw new NotFoundAppError('Resource not found');
        }

        const relations = await this.resolveRelations({
          countryCode: current.country.code,
          familyKey: current.family?.key ?? undefined,
          programSlug: current.program?.slug ?? undefined,
          locationSlugs: current.locationAssignments.length > 0
            ? current.locationAssignments.map((assignment) => assignment.location.slug)
            : current.location?.slug ? [current.location.slug] : [],
        });
        await this.validateResourceRelations({
          relations,
          resourceId: input.resourceId,
          type: current.type,
          active: true,
        });
      }

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
      fileUrl = toPublicUrl(`/api/resources/${input.resourceId}/versions/${versionId}/download`);
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

  async auditResources(): Promise<ResourceAuditReport> {
    const resources = await prisma.resource.findMany({
      select: {
        id: true,
        title: true,
        type: true,
        active: true,
        country: { select: { code: true, name: true } },
        family: { select: { key: true } },
        program: {
          select: {
            id: true,
            slug: true,
            name: true,
            startWindows: {
              where: { active: true },
              select: { seasonKey: true },
            },
          },
        },
        versions: {
          where: { isCurrent: true },
          take: 1,
          select: {
            id: true,
            extraction: {
              select: {
                status: true,
              },
            },
          },
        },
      },
      orderBy: [{ title: 'asc' }],
    });

    const issues: ResourceAuditIssue[] = [];
    const groupedCampBrochures = new Map<string, string[]>();

    for (const resource of resources) {
      const currentVersion = resource.versions[0] ?? null;

      if (!currentVersion) {
        issues.push({
          code: 'RESOURCE_MISSING_CURRENT_VERSION',
          severity: 'error',
          message: 'El resource no tiene una versión actual activa.',
          resourceId: resource.id,
          resourceTitle: resource.title,
          countryCode: resource.country.code,
          countryName: resource.country.name,
        });
      } else if (currentVersion.extraction?.status === 'PENDING' || currentVersion.extraction?.status === 'FAILED') {
        issues.push({
          code: 'RESOURCE_PENDING_EXTRACTION',
          severity: 'warning',
          message: `La extracción del resource está en estado ${currentVersion.extraction.status}.`,
          resourceId: resource.id,
          resourceTitle: resource.title,
          countryCode: resource.country.code,
          countryName: resource.country.name,
        });
      }

      if (resource.family?.key !== 'CAMP' || resource.type !== 'BROCHURE' || !resource.active) {
        continue;
      }

      if (!resource.program) {
        issues.push({
          code: 'CAMP_BROCHURE_MISSING_PROGRAM',
          severity: 'error',
          message: 'El brochure de campamento activo no está ligado a un programa.',
          resourceId: resource.id,
          resourceTitle: resource.title,
          countryCode: resource.country.code,
          countryName: resource.country.name,
        });
        continue;
      }

      const seasonKeys = this.extractSeasonKeys(resource.program.startWindows.map((window) => window.seasonKey));
      if (seasonKeys.length === 0) {
        issues.push({
          code: 'CAMP_BROCHURE_MISSING_SEASON',
          severity: 'error',
          message: 'El brochure de campamento activo no tiene temporada válida asociada en su programa.',
          resourceId: resource.id,
          resourceTitle: resource.title,
          countryCode: resource.country.code,
          countryName: resource.country.name,
        });
        continue;
      }

      for (const seasonKey of seasonKeys) {
        const groupKey = `${resource.country.code}:${seasonKey}`;
        const list = groupedCampBrochures.get(groupKey) ?? [];
        list.push(resource.id);
        groupedCampBrochures.set(groupKey, list);
      }
    }

    for (const [groupKey, resourceIds] of groupedCampBrochures.entries()) {
      if (resourceIds.length <= 1) continue;
      const [countryCode, seasonKey] = groupKey.split(':');
      issues.push({
        code: 'CAMP_BROCHURE_DUPLICATE_SEASON',
        severity: 'warning',
        message: 'Hay más de un brochure de campamento activo para la misma temporada y país.',
        countryCode,
        seasonKey,
        relatedResourceIds: resourceIds,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        resourcesChecked: resources.length,
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      },
      issues,
    };
  }

  private async resolveRelations(input: {
    countryCode: string;
    countryName?: string;
    familyKey?: string;
    programSlug?: string;
    locationSlug?: string;
    locationSlugs?: string[];
    locationNames?: string[];
    locationName?: string;
    locationVenueName?: string | null;
    locationDescription?: string | null;
  }, db: Prisma.TransactionClient = prisma): Promise<ResolvedRelations> {
    const countryCode = input.countryCode.trim().toUpperCase();
    const providedCountryName = input.countryName?.trim();
    let country = providedCountryName
      ? await db.country.upsert({
          where: { code: countryCode },
          create: { code: countryCode, name: providedCountryName, active: true },
          update: { active: true },
          select: { id: true, code: true, name: true, active: true },
        })
      : await db.country.findUnique({
          where: { code: countryCode },
          select: { id: true, code: true, name: true, active: true },
        });

    if (!country) {
      throw new NotFoundAppError(`Country not found for code ${countryCode}`);
    } else if (!country.active) {
      country = await db.country.update({
        where: { id: country.id },
        data: { active: true },
        select: { id: true, code: true, name: true, active: true },
      });
    }

    const family = input.familyKey
      ? await db.productFamily.findUnique({
          where: { key: input.familyKey as never },
          select: { id: true, key: true },
        })
      : null;

    if (input.familyKey && !family) {
      throw new NotFoundAppError(`Family not found for key ${input.familyKey}`);
    }

    const locationNames = Array.from(new Set([
      ...(input.locationNames ?? []),
      ...(input.locationName ? [input.locationName] : []),
    ].map((name) => name.trim()).filter(Boolean)));
    const locationNamesBySlug = new Map(locationNames.map((name) => [this.slugify(name), name]));
    if ([...locationNamesBySlug.keys()].some((slug) => !slug)) {
      throw new ValidationAppError('A location name cannot be converted to a valid slug');
    }
    const requestedLocationSlugs = Array.from(new Set([
      ...(input.locationSlugs ?? []),
      ...(input.locationSlug ? [input.locationSlug] : []),
      ...locationNamesBySlug.keys(),
    ].map((slug) => slug.trim()).filter(Boolean)));
    let locations = requestedLocationSlugs.length > 0
      ? await db.programLocation.findMany({
          where: { slug: { in: requestedLocationSlugs }, countryId: country.id },
          select: { id: true, slug: true },
        })
      : [];

    for (const [slug, name] of locationNamesBySlug) {
      const location = await db.programLocation.upsert({
        where: {
          countryId_slug: { countryId: country.id, slug },
        },
        create: {
          countryId: country.id,
          slug,
          name,
          venueName: name === input.locationName?.trim() ? input.locationVenueName ?? null : null,
          description: name === input.locationName?.trim() ? input.locationDescription ?? null : null,
          active: true,
        },
        update: { active: true },
        select: { id: true, slug: true },
      });
      locations = [...locations.filter((item) => item.slug !== slug), location];
    }

    const foundLocationSlugs = new Set(locations.map((location) => location.slug));
    const missingLocationSlugs = requestedLocationSlugs.filter((slug) => !foundLocationSlugs.has(slug));
    if (missingLocationSlugs.length > 0) {
      throw new NotFoundAppError(`Locations not found in country ${countryCode}: ${missingLocationSlugs.join(', ')}`);
    }

    const program = input.programSlug
      ? await db.program.findFirst({
          where: {
            slug: input.programSlug,
            countryId: country.id,
          },
          select: {
            id: true,
            familyId: true,
            locationId: true,
            slug: true,
            name: true,
            startWindows: {
              where: { active: true },
              select: { seasonKey: true },
            },
          },
        })
      : null;

    if (input.programSlug && !program) {
      throw new NotFoundAppError(`Program not found for slug ${input.programSlug} in country ${countryCode}`);
    }

    if (program && family && program.familyId !== family.id) {
      throw new ConflictAppError('Program does not belong to the provided family');
    }

    if (program && !family) {
      throw new ValidationAppError('familyKey is required when programSlug is provided');
    }

    const locationIdsBySlug = new Map(locations.map((location) => [location.slug, location.id]));
    const explicitLocationIds = requestedLocationSlugs
      .map((slug) => locationIdsBySlug.get(slug))
      .filter((id): id is string => Boolean(id));
    const hasExplicitLocationSelection = input.locationSlugs !== undefined || input.locationSlug !== undefined || input.locationNames !== undefined || input.locationName !== undefined;
    const locationIds = hasExplicitLocationSelection
      ? explicitLocationIds
      : explicitLocationIds.length > 0
        ? explicitLocationIds
        : program?.locationId ? [program.locationId] : [];

    return {
      countryId: country.id,
      countryCode: country.code,
      countryName: country.name,
      familyId: family?.id ?? null,
      familyKey: family?.key ?? null,
      programId: program?.id ?? null,
      programSlug: program?.slug ?? null,
      programName: program?.name ?? null,
      programSeasonKeys: this.extractSeasonKeys((program?.startWindows ?? []).map((window) => window.seasonKey)),
      locationId: locationIds[0] ?? null,
      locationIds,
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

  private async validateResourceRelations(input: {
    relations: ResolvedRelations;
    resourceId: string | null;
    type?: string;
    active: boolean;
  }, db: Prisma.TransactionClient = prisma): Promise<void> {
    if (input.relations.familyKey !== 'CAMP' || input.type !== 'BROCHURE' || !input.active) {
      return;
    }

    if (!input.relations.programId) {
      throw new ValidationAppError('Camp brochures must be linked to a program');
    }

    if (input.relations.programSeasonKeys.length === 0) {
      throw new ValidationAppError('Camp brochure program must define at least one seasonal start window');
    }

    const duplicateResource = await db.resource.findFirst({
      where: {
        ...(input.resourceId ? { id: { not: input.resourceId } } : {}),
        active: true,
        type: 'BROCHURE',
        countryId: input.relations.countryId,
        family: { key: 'CAMP' },
        program: {
          startWindows: {
            some: {
              active: true,
              seasonKey: { in: input.relations.programSeasonKeys as never[] },
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    if (duplicateResource) {
      const seasons = input.relations.programSeasonKeys.map((seasonKey) => this.toSeasonLabel(seasonKey)).join(', ');
      throw new ConflictAppError(
        `There is already an active camp brochure for ${input.relations.countryName} in ${seasons || 'that season'}`,
      );
    }
  }

  private async syncProgramWeekOptions(
    tx: Prisma.TransactionClient,
    input: {
      programId: string | null;
      weekOptions: number[] | undefined;
    },
  ): Promise<void> {
    if (input.weekOptions === undefined) {
      return;
    }

    if (!input.programId) {
      throw new ValidationAppError('weekOptions requires a linked program');
    }

    await tx.programRule.upsert({
      where: { programId: input.programId },
      create: {
        programId: input.programId,
        quoteMode: QuoteMode.WEEK,
        weekOptions: input.weekOptions,
      },
      update: {
        weekOptions: input.weekOptions,
      },
    });
  }

  private extractSeasonKeys(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value === 'SUMMER' || value === 'EASTER' || value === 'WINTER')));
  }

  private toSeasonLabel(seasonKey: string): string {
    switch (seasonKey) {
      case 'SUMMER':
        return 'verano';
      case 'EASTER':
        return 'Semana Santa';
      case 'WINTER':
        return 'invierno';
      default:
        return seasonKey;
    }
  }

  private slugify(value: string): string {
    return value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private isPrismaNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }
}
