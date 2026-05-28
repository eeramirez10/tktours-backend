import type { Prisma } from '@prisma/client';

import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { CatalogReadRepository } from '../../domain/repositories/catalog-read.repository.js';
import type {
  CatalogCollectionQuery,
  CatalogCountry,
  CatalogFamily,
  CatalogProgram,
  CatalogProgramDetail,
  CatalogProgramRecommendation,
  CatalogProgramRecommendationQuery,
  CatalogResourceSummary,
  ListCatalogProgramsQuery,
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
  rule: {
    select: {
      quoteMode: true,
      minWeeks: true,
      maxWeeks: true,
      allowsMiniStay: true,
      miniStayGroupOnly: true,
      notes: true,
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
    quoteMode: program.rule?.quoteMode ?? null,
    minWeeks: program.rule?.minWeeks ?? null,
    maxWeeks: program.rule?.maxWeeks ?? null,
    allowsMiniStay: program.rule?.allowsMiniStay ?? false,
    miniStayGroupOnly: program.rule?.miniStayGroupOnly ?? false,
    ruleNotes: program.rule?.notes ?? null,
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

  async findPrograms(query: ListCatalogProgramsQuery): Promise<CatalogProgram[]> {
    const programs: ProgramRecord[] = await prisma.program.findMany({
      where: {
        ...(query.activeOnly ? { active: true } : {}),
        ...(query.countryCode ? { country: { code: query.countryCode } } : {}),
        ...(query.familyKey ? { family: { key: query.familyKey } } : {}),
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
}
