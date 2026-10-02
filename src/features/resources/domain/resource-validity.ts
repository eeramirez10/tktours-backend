import type { Prisma } from '@prisma/client';

export type ResourceValidityStatus = 'CURRENT' | 'UPCOMING' | 'EXPIRED' | 'PENDING' | 'INACTIVE';
type ValidityResource = {
  active: boolean;
  type: string;
  family: { key: string } | null;
  year: number | null;
  shareFrom: Date | null;
  shareUntil: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
};

// Date-only columns are compared against the business day, not the server's timezone.
export function resourceBusinessDate(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

export function resourceValidityStatus(resource: ValidityResource, today = resourceBusinessDate()): ResourceValidityStatus {
  if (!resource.active) return 'INACTIVE';
  if ((resource.shareUntil && resource.shareUntil < today)
    || (resource.validUntil && resource.validUntil < today)
    || (resource.year != null && resource.year < today.getUTCFullYear())) return 'EXPIRED';
  if (resource.type === 'BROCHURE' && resource.family?.key === 'CAMP'
    && (resource.year == null || !resource.shareFrom || !resource.shareUntil)) return 'PENDING';
  if (resource.shareFrom && resource.shareUntil && resource.shareFrom > resource.shareUntil) return 'PENDING';
  if (resource.validFrom && resource.validUntil && resource.validFrom > resource.validUntil) return 'PENDING';
  if (resource.shareFrom && resource.shareFrom > today) return 'UPCOMING';
  return 'CURRENT';
}

export function resourceEligibilityFilters(targetDate: Date | null = null, today = resourceBusinessDate()): Prisma.ResourceWhereInput[] {
  const filters: Prisma.ResourceWhereInput[] = [
    { active: true },
    { OR: [{ shareFrom: null }, { shareFrom: { lte: today } }] },
    { OR: [{ shareUntil: null }, { shareUntil: { gte: today } }] },
    { OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
    { OR: [{ year: null }, { year: { gte: today.getUTCFullYear() } }] },
    { OR: [
      { type: { not: 'BROCHURE' } },
      { family: null },
      { family: { key: { not: 'CAMP' } } },
      { AND: [
        { year: { not: null } }, { shareFrom: { not: null } }, { shareUntil: { not: null } },
        { seasonKeys: { hasSome: ['SUMMER', 'EASTER', 'WINTER'] } },
      ] },
    ] },
  ];
  if (targetDate) {
    const year = targetDate.getUTCFullYear();
    const monthStart = new Date(Date.UTC(year, targetDate.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(year, targetDate.getUTCMonth() + 1, 0));
    filters.push(
      { OR: [{ year: null }, { year }] },
      { OR: [{ validFrom: null }, { validFrom: { lte: monthEnd } }] },
      { OR: [{ validUntil: null }, { validUntil: { gte: monthStart } }] },
    );
  }
  return filters;
}
