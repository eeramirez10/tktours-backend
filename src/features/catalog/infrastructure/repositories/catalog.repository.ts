import { Prisma } from '@prisma/client';

import { ConflictAppError, NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
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
  CreateCatalogLocationInput,
  ListCatalogLocationsQuery,
  ListCatalogProgramsQuery,
  UpdateCatalogCountryInput,
  UpdateCatalogLocationInput,
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
      versions: {
        where: { isCurrent: true },
        take: 1,
        orderBy: { versionNumber: 'desc' },
        select: {
          fileName: true,
          fileUrl: true,
        },
      },
    },
  },
} satisfies Prisma.ProgramSelect;

type ProgramRecord = Prisma.ProgramGetPayload<{ select: typeof programSelect }>;

function mapResources(resources: ProgramRecord['resources']): CatalogResourceSummary[] {
  return resources.map((resource) => ({
    id: resource.id,
    title: resource.title,
    type: resource.type,
    active: resource.active,
    fileName: resource.versions[0]?.fileName ?? null,
    fileUrl: resource.versions[0]?.fileUrl ?? null,
    month: resource.month,
    year: resource.year,
  }));
}

function mapProgram(program: ProgramRecord): CatalogProgramDetail {
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
    startWindows: program.startWindows.map((startWindow) => ({
      seasonKey: startWindow.seasonKey,
      startMonth: startWindow.startMonth,
      endMonth: startWindow.endMonth,
      startDay: startWindow.startDay,
      endDay: startWindow.endDay,
      startsEveryMonday: startWindow.startsEveryMonday,
      notes: startWindow.notes,
    })),
    resources: mapResources(program.resources),
  };
}

function stripResources(program: CatalogProgramDetail): CatalogProgram {
  const { resources: _resources, ...rest } = program;
  return rest;
}

export class CatalogRepository implements CatalogReadRepository {
  findCountries(query: CatalogCollectionQuery): Promise<CatalogCountry[]> {
    return prisma.country.findMany({
      where: query.activeOnly ? { active: true } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, active: true },
    });
  }

  findFamilies(query: CatalogCollectionQuery): Promise<CatalogFamily[]> {
    return prisma.productFamily.findMany({
      where: query.activeOnly ? { active: true } : undefined,
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, active: true },
    });
  }

  async createCountry(input: CreateCatalogCountryInput): Promise<CatalogCountry> {
    try {
      const created = await prisma.country.create({
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
      const updated = await prisma.country.update({
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
    return prisma.programLocation.findMany({
      where: {
        ...(query.activeOnly ? { active: true } : {}),
        ...(query.countryCode ? { country: { code: query.countryCode } } : {}),
        ...(query.familyKey ? { programs: { some: { active: true, family: { key: query.familyKey } } } } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { slug: { contains: query.search, mode: 'insensitive' } },
                { venueName: { contains: query.search, mode: 'insensitive' } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
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
    const country = await prisma.country.findUnique({
      where: { code: input.countryCode.trim().toUpperCase() },
      select: { id: true },
    });

    if (!country) {
      throw new NotFoundAppError(`Country not found for code ${input.countryCode}`);
    }

    try {
      const created = await prisma.programLocation.create({
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
    const current = await prisma.programLocation.findUnique({
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

    let nextCountryId: string | undefined;
    if (input.countryCode !== undefined) {
      const country = await prisma.country.findUnique({
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
      const updated = await prisma.programLocation.update({
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
    const programs: ProgramRecord[] = await prisma.program.findMany({
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

  async findProgramBySlug(slug: string): Promise<CatalogProgramDetail | null> {
    const program = await prisma.program.findFirst({
      where: { slug },
      select: programSelect,
    });

    return program ? mapProgram(program) : null;
  }

  async findRecommendedPrograms(query: CatalogProgramRecommendationQuery): Promise<CatalogProgramRecommendation[]> {
    const programs: ProgramRecord[] = await prisma.program.findMany({
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
      const hasMonthMatch = program.startWindows.some((window) => {
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
