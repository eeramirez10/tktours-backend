import { Prisma } from '@prisma/client';

import { ConflictAppError, NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { resourceBusinessDate, resourceValidityStatus } from '../../../resources/domain/resource-validity.js';
import type { CatalogCampSeasonKey } from '../../domain/types/catalog.types.js';
import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import { canonicalConciergeFamily, normalizedFamilyKey } from '../../domain/concierge-families.js';
import type {
  CatalogCollectionQuery,
  CatalogCountry,
  CatalogFamily,
  CatalogProgram,
  CatalogProgramDetail,
  CatalogProgramLocation,
  CatalogProgramRecommendation,
  CatalogProgramRecommendationQuery,
  CatalogResourceSummary,
  CreateCatalogCountryInput,
  CreateCatalogFamilyInput,
  CreateCatalogLocationInput,
  CreateCatalogProgramInput,
  ListCatalogLocationsQuery,
  ListCatalogProgramsQuery,
  UpdateCatalogCountryInput,
  UpdateCatalogFamilyInput,
  UpdateCatalogLocationInput,
  UpdateCatalogProgramInput,
} from '../../domain/types/catalog.types.js';

const programSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  minAge: true,
  maxAge: true,
  active: true,
  country: {
    select: {
      id: true,
      code: true,
      name: true,
      active: true,
    },
  },
  family: {
    select: {
      id: true,
      key: true,
      name: true,
      active: true,
    },
  },
  location: {
    select: {
      id: true,
      slug: true,
      name: true,
      venueName: true,
      description: true,
      active: true,
      country: {
        select: {
          id: true,
          code: true,
          name: true,
          active: true,
        },
      },
    },
  },
  rule: {
    select: {
      quoteMode: true,
      minWeeks: true,
      maxWeeks: true,
      weekOptions: true,
      allowsMiniStay: true,
      miniStayGroupOnly: true,
      notes: true,
    },
  },
  prices: {
    where: { active: true },
    orderBy: [{ year: 'desc' }, { amountFrom: 'asc' }],
    select: {
      currency: true,
      amountFrom: true,
      amountTo: true,
      priceLabel: true,
      notes: true,
      year: true,
    },
  },
  accommodations: {
    where: { active: true, accommodationType: { active: true } },
    select: {
      minAge: true,
      maxAge: true,
      notes: true,
      accommodationType: {
        select: {
          key: true,
          name: true,
        },
      },
    },
  },
  startWindows: {
    where: { active: true },
    select: {
      seasonKey: true,
      startMonth: true,
      endMonth: true,
      startDay: true,
      endDay: true,
      startsEveryMonday: true,
      notes: true,
    },
  },
  resources: {
    where: { active: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { title: 'asc' }],
    select: {
      id: true,
      title: true,
      type: true,
      active: true,
      month: true,
      year: true,
      seasonKeys: true,
      shareFrom: true,
      shareUntil: true,
      validFrom: true,
      validUntil: true,
      family: { select: { key: true, active: true } },
      country: { select: { active: true } },
      versions: {
        where: { isCurrent: true },
        take: 1,
        orderBy: { versionNumber: 'desc' },
        select: {
          fileName: true,
          fileUrl: true,
          mimeType: true,
        },
      },
    },
  },
} satisfies Prisma.ProgramSelect;

type ProgramRecord = Prisma.ProgramGetPayload<{ select: typeof programSelect }>;

function mapResources(resources: ProgramRecord['resources']): CatalogResourceSummary[] {
  const today = resourceBusinessDate();
  return resources.filter((resource) => resource.country.active && resource.family?.active !== false
    && resourceValidityStatus(resource, today) === 'CURRENT'
    && (resource.family?.key !== 'CAMP' || resource.type !== 'BROCHURE'
      || resource.seasonKeys.some((key) => key === 'SUMMER' || key === 'EASTER' || key === 'WINTER'))
    && Boolean(resource.versions[0]?.fileUrl)
    && (resource.versions[0]?.mimeType === 'application/pdf'
      || (!resource.versions[0]?.mimeType && /\.pdf$/i.test(resource.versions[0]?.fileName ?? '')))).map((resource) => ({
    id: resource.id,
    title: resource.title,
    type: resource.type,
    active: resource.active,
    fileName: resource.versions[0]?.fileName ?? null,
    fileUrl: resource.versions[0]?.fileUrl ?? null,
    month: resource.month,
    year: resource.year,
    seasonKeys: resource.family?.key === 'CAMP' && resource.type === 'BROCHURE'
      ? resource.seasonKeys.filter((key): key is CatalogCampSeasonKey => key === 'SUMMER' || key === 'EASTER' || key === 'WINTER')
      : [],
    validFrom: resource.validFrom?.toISOString().slice(0, 10) ?? null,
    validUntil: resource.validUntil?.toISOString().slice(0, 10) ?? null,
  }));
}

function mapProgram(program: ProgramRecord): CatalogProgramDetail {
  const resources = mapResources(program.resources);
  const isCamp = program.family.key === 'CAMP';
  const availableSeasons = new Set(resources.flatMap((resource) => resource.seasonKeys));
  const seasonOrder: CatalogCampSeasonKey[] = ['SUMMER', 'EASTER', 'WINTER'];
  return {
    id: program.id,
    slug: program.slug,
    name: program.name,
    description: program.description,
    minAge: program.minAge,
    maxAge: program.maxAge,
    active: program.active,
    country: program.country,
    family: program.family,
    location: program.location,
    quoteMode: program.rule?.quoteMode ?? null,
    minWeeks: program.rule?.minWeeks ?? null,
    maxWeeks: program.rule?.maxWeeks ?? null,
    weekOptions: program.rule?.weekOptions ?? [],
    allowsMiniStay: program.rule?.allowsMiniStay ?? false,
    miniStayGroupOnly: program.rule?.miniStayGroupOnly ?? false,
    ruleNotes: program.rule?.notes ?? null,
    prices: program.prices.map((price) => ({
      currency: price.currency,
      amountFrom: price.amountFrom?.toString() ?? null,
      amountTo: price.amountTo?.toString() ?? null,
      priceLabel: price.priceLabel,
      notes: price.notes,
      year: price.year,
    })),
    accommodations: program.accommodations.map((accommodation) => ({
      key: accommodation.accommodationType.key,
      name: accommodation.accommodationType.name,
      minAge: accommodation.minAge,
      maxAge: accommodation.maxAge,
      notes: accommodation.notes,
    })),
    seasonKeys: isCamp && program.active && program.country.active && program.family.active
      ? seasonOrder.filter((season) => availableSeasons.has(season)) : [],
    // Historical camp windows remain stored, but availability belongs to each PDF.
    startWindows: isCamp ? [] : program.startWindows.map((startWindow) => ({
      seasonKey: startWindow.seasonKey,
      startMonth: startWindow.startMonth,
      endMonth: startWindow.endMonth,
      startDay: startWindow.startDay,
      endDay: startWindow.endDay,
      startsEveryMonday: startWindow.startsEveryMonday,
      notes: startWindow.notes,
    })),
    resources,
  };
}

function stripResources(program: CatalogProgramDetail): CatalogProgram {
  const { resources: _resources, ...rest } = program;
  return rest;
}

export class CatalogRepository implements CatalogReadRepository {
  constructor(private readonly database = prisma) {}

  findCountries(query: CatalogCollectionQuery): Promise<CatalogCountry[]> {
    return this.database.country.findMany({
      where: query.activeOnly ? { active: true } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, active: true },
    });
  }

  findFamilies(query: CatalogCollectionQuery): Promise<CatalogFamily[]> {
    return this.database.productFamily.findMany({
      where: query.activeOnly ? { active: true } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, active: true },
    });
  }

  async createFamily(input: CreateCatalogFamilyInput): Promise<CatalogFamily> {
    const key = canonicalConciergeFamily(input.key ?? '')?.key
      ?? canonicalConciergeFamily(input.name)?.key
      ?? normalizedFamilyKey(input.key || input.name);

    try {
      return await this.database.productFamily.create({
        data: {
          key,
          name: input.name.trim(),
          active: input.active,
        },
        select: { id: true, key: true, name: true, active: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppError('Ya existe esta familia en el catálogo. Utiliza la familia registrada en lugar de crear otra.');
      }
      throw error;
    }
  }

  async updateFamily(input: UpdateCatalogFamilyInput): Promise<CatalogFamily> {
    try {
      return await this.database.productFamily.update({
        where: { id: input.familyId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        select: { id: true, key: true, name: true, active: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundAppError('Family not found');
      }
      throw error;
    }
  }

  async createCountry(input: CreateCatalogCountryInput): Promise<CatalogCountry> {
    try {
      const created = await this.database.country.create({
        data: {
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          active: input.active,
        },
        select: { id: true, code: true, name: true, active: true },
      });

      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppError('Country code already exists');
      }
      throw error;
    }
  }

  async updateCountry(input: UpdateCatalogCountryInput): Promise<CatalogCountry> {
    try {
      const updated = await this.database.country.update({
        where: { id: input.countryId },
        data: {
          ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        select: { id: true, code: true, name: true, active: true },
      });

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundAppError('Country not found');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppError('Country code already exists');
      }
      throw error;
    }
  }

  async findLocations(query: ListCatalogLocationsQuery): Promise<CatalogProgramLocation[]> {
    const filters: Prisma.ProgramLocationWhereInput[] = [];
    if (query.familyKey) {
      filters.push({ OR: [
        { programs: { some: { active: true, family: { key: query.familyKey } } } },
        { resourceAssignments: { some: { resource: {
          active: true,
          family: { key: query.familyKey },
          versions: { some: { isCurrent: true } },
        } } } },
        { resources: { some: {
          active: true,
          family: { key: query.familyKey },
          versions: { some: { isCurrent: true } },
        } } },
      ] });
    }
    if (query.search) {
      filters.push({ OR: [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
        { venueName: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ] });
    }

    return this.database.programLocation.findMany({
      where: {
        ...(query.activeOnly ? { active: true } : {}),
        ...(query.countryCode ? { country: { code: query.countryCode } } : {}),
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      orderBy: [{ country: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        venueName: true,
        description: true,
        active: true,
        country: {
          select: {
            id: true,
            code: true,
            name: true,
            active: true,
          },
        },
      },
    });
  }

  async createLocation(input: CreateCatalogLocationInput): Promise<CatalogProgramLocation> {
    const country = await this.database.country.findUnique({
      where: { code: input.countryCode.trim().toUpperCase() },
      select: { id: true },
    });

    if (!country) {
      throw new NotFoundAppError(`Country not found for code ${input.countryCode}`);
    }

    try {
      const created = await this.database.programLocation.create({
        data: {
          countryId: country.id,
          name: input.name.trim(),
          slug: this.slugify(input.name),
          venueName: input.venueName?.trim() || null,
          description: input.description?.trim() || null,
          active: input.active,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          venueName: true,
          description: true,
          active: true,
          country: {
            select: { id: true, code: true, name: true, active: true },
          },
        },
      });

      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppError('Location slug already exists for that country');
      }
      throw error;
    }
  }

  async updateLocation(input: UpdateCatalogLocationInput): Promise<CatalogProgramLocation> {
    const current = await this.database.programLocation.findUnique({
      where: { id: input.locationId },
      select: {
        id: true,
        name: true,
        country: {
          select: { code: true },
        },
      },
    });

    if (!current) {
      throw new NotFoundAppError('Location not found');
    }

    if (input.countryCode !== undefined && input.countryCode.trim().toUpperCase() !== current.country.code) {
      throw new ConflictAppError('A location cannot be moved to another country; create a new location instead');
    }

    let nextCountryId: string | undefined;
    if (input.countryCode !== undefined) {
      const country = await this.database.country.findUnique({
        where: { code: input.countryCode.trim().toUpperCase() },
        select: { id: true },
      });

      if (!country) {
        throw new NotFoundAppError(`Country not found for code ${input.countryCode}`);
      }

      nextCountryId = country.id;
    }

    const nextName = input.name?.trim() ?? current.name;
    try {
      const updated = await this.database.programLocation.update({
        where: { id: input.locationId },
        data: {
          ...(nextCountryId ? { countryId: nextCountryId } : {}),
          ...(input.name !== undefined ? { name: nextName, slug: this.slugify(nextName) } : {}),
          ...(input.venueName !== undefined ? { venueName: input.venueName?.trim() || null } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        select: {
          id: true,
          slug: true,
          name: true,
          venueName: true,
          description: true,
          active: true,
          country: {
            select: { id: true, code: true, name: true, active: true },
          },
        },
      });

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundAppError('Location not found');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppError('Location slug already exists for that country');
      }
      throw error;
    }
  }

  async findPrograms(query: ListCatalogProgramsQuery): Promise<CatalogProgram[]> {
    const programs: ProgramRecord[] = await this.database.program.findMany({
      where: {
        ...(query.activeOnly ? { active: true } : {}),
        ...(query.countryCode ? { country: { code: query.countryCode } } : {}),
        ...(query.familyKey ? { family: { key: query.familyKey } } : {}),
        ...(query.locationSlug ? { location: { slug: query.locationSlug } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { slug: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
      select: programSelect,
    });

    return programs.map((program) => stripResources(mapProgram(program)));
  }

  async createProgram(input: CreateCatalogProgramInput): Promise<CatalogProgram> {
    const [country, family] = await Promise.all([
      this.database.country.findUnique({ where: { code: input.countryCode.trim().toUpperCase() }, select: { id: true } }),
      this.database.productFamily.findUnique({ where: { key: input.familyKey.trim().toUpperCase() }, select: { id: true } }),
    ]);

    if (!country) {
      throw new NotFoundAppError(`Country not found for code ${input.countryCode}`);
    }
    if (!family) {
      throw new NotFoundAppError(`Family not found for key ${input.familyKey}`);
    }

    try {
      const program = await this.database.program.create({
        data: {
          countryId: country.id,
          familyId: family.id,
          slug: input.slug?.trim() || this.slugify(input.name),
          name: input.name.trim(),
          description: input.description?.trim() || null,
          minAge: input.minAge ?? null,
          maxAge: input.maxAge ?? null,
          active: input.active,
        },
        select: programSelect,
      });

      return stripResources(mapProgram(program));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictAppError('Program slug already exists for that country');
      }
      throw error;
    }
  }

  async updateProgram(input: UpdateCatalogProgramInput): Promise<CatalogProgram> {
    return this.database.$transaction(async (tx) => {
      const current = await tx.program.findUnique({
        where: { id: input.programId },
        select: { minAge: true, maxAge: true },
      });

      if (!current) {
        throw new NotFoundAppError('Program not found');
      }

      const minAge = input.minAge === undefined ? current.minAge : input.minAge;
      const maxAge = input.maxAge === undefined ? current.maxAge : input.maxAge;
      if (minAge != null && maxAge != null && minAge > maxAge) {
        throw new ConflictAppError('Maximum age must be greater than or equal to minimum age');
      }

      const program = await tx.program.update({
        where: { id: input.programId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.minAge !== undefined ? { minAge: input.minAge } : {}),
          ...(input.maxAge !== undefined ? { maxAge: input.maxAge } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        select: programSelect,
      });

      return stripResources(mapProgram(program));
    });
  }

  async deleteProgram(programId: string): Promise<void> {
    await this.database.$transaction(async (tx) => {
      const program = await tx.program.findUnique({
        where: { id: programId },
        select: {
          name: true,
          _count: { select: { resources: true } },
        },
      });

      if (!program) {
        throw new NotFoundAppError('Program not found');
      }
      if (program._count.resources > 0) {
        throw new ConflictAppError(
          `No se puede eliminar “${program.name}” porque tiene ${program._count.resources} ${program._count.resources === 1 ? 'recurso asociado' : 'recursos asociados'}. Elimina o reasigna esos recursos primero.`,
        );
      }

      await tx.inquiryRecommendation.deleteMany({ where: { programId } });
      await tx.inquiry.updateMany({ where: { programId }, data: { programId: null } });
      await tx.program.delete({ where: { id: programId } });
    });
  }

  async findProgramBySlug(slug: string): Promise<CatalogProgramDetail | null> {
    const program = await this.database.program.findFirst({
      where: { slug },
      select: programSelect,
    });

    return program ? mapProgram(program) : null;
  }

  async findRecommendedPrograms(query: CatalogProgramRecommendationQuery): Promise<CatalogProgramRecommendation[]> {
    const programs: ProgramRecord[] = await this.database.program.findMany({
      where: {
        active: true,
        country: { code: query.countryCode },
        ...(query.familyKey ? { family: { key: query.familyKey } } : {}),
        ...(query.locationSlug ? { location: { slug: query.locationSlug } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { slug: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
      select: programSelect,
    });

    return programs
      .map((program) => this.toRecommendation(mapProgram(program), query))
      .filter((program): program is CatalogProgramRecommendation => program !== null);
  }

  private toRecommendation(
    program: CatalogProgramDetail,
    query: CatalogProgramRecommendationQuery,
  ): CatalogProgramRecommendation | null {
    const reasons: string[] = [];
    if (program.family.key === 'CAMP' && program.seasonKeys.length === 0) return null;

    if (query.studentAge != null) {
      if (program.minAge != null && query.studentAge < program.minAge) {
        return null;
      }
      if (program.maxAge != null && query.studentAge > program.maxAge) {
        return null;
      }
      reasons.push(`age ${query.studentAge} fits program range`);
    }

    if (query.weeks != null) {
      if (program.minWeeks != null && query.weeks < program.minWeeks) {
        return null;
      }
      if (program.maxWeeks != null && query.weeks > program.maxWeeks) {
        return null;
      }
      reasons.push(`stay length ${query.weeks} weeks is allowed`);
    }

    if (query.accommodationKey) {
      const match = program.accommodations.find((item) => item.key === query.accommodationKey);
      if (!match) {
        return null;
      }
      if (query.studentAge != null) {
        if (match.minAge != null && query.studentAge < match.minAge) {
          return null;
        }
        if (match.maxAge != null && query.studentAge > match.maxAge) {
          return null;
        }
      }
      reasons.push(`accommodation ${query.accommodationKey} is supported`);
    }

    if (query.preferredStartMonth != null) {
      const preferredStartMonth = query.preferredStartMonth;
      const hasMonthMatch = program.family.key === 'CAMP'
        ? program.resources.some((resource) => {
          if (resource.type !== 'BROCHURE' || resource.seasonKeys.length === 0) return false;
          const year = resource.year ?? resourceBusinessDate().getUTCFullYear();
          const monthStart = new Date(Date.UTC(year, preferredStartMonth - 1, 1)).toISOString().slice(0, 10);
          const monthEnd = new Date(Date.UTC(year, preferredStartMonth, 0)).toISOString().slice(0, 10);
          return (!resource.validFrom || resource.validFrom <= monthEnd)
            && (!resource.validUntil || resource.validUntil >= monthStart);
        })
        : program.startWindows.some((window) => {
          if (window.startsEveryMonday) {
            return true;
          }
          if (window.startMonth == null && window.endMonth == null) {
            return true;
          }
          if (window.startMonth != null && window.endMonth != null) {
            if (window.startMonth <= window.endMonth) {
              return preferredStartMonth >= window.startMonth && preferredStartMonth <= window.endMonth;
            }
            return preferredStartMonth >= window.startMonth || preferredStartMonth <= window.endMonth;
          }
          return preferredStartMonth === window.startMonth || preferredStartMonth === window.endMonth;
        });

      if (!hasMonthMatch) {
        return null;
      }
      reasons.push(`start month ${preferredStartMonth} matches available window`);
    }

    if (query.familyKey) {
      reasons.push(`family ${query.familyKey} matches`);
    }

    reasons.push(`country ${query.countryCode} matches`);

    return {
      ...program,
      matchReasons: reasons,
    };
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

}
