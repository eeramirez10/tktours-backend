export type ResourceTripCompatibility = 'CONFIRMED' | 'INCOMPATIBLE' | 'UNCONFIRMED';

// Publication dates never establish when a customer can travel.
export function resourceTripCompatibility(
  resource: { year: number | null; validFrom: Date | string | null; validUntil: Date | string | null },
  month?: number | null,
  year?: number | null,
): ResourceTripCompatibility {
  if (year != null && resource.year != null && year !== resource.year) return 'INCOMPATIBLE';
  if (month == null) return 'UNCONFIRMED';
  if (!resource.validFrom || !resource.validUntil) return 'UNCONFIRMED';
  const start = new Date(resource.validFrom);
  const end = new Date(resource.validUntil);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return 'UNCONFIRMED';
  const firstYear = year ?? start.getUTCFullYear();
  const lastYear = year ?? end.getUTCFullYear();
  for (let candidateYear = firstYear; candidateYear <= lastYear; candidateYear++) {
    const monthStart = new Date(Date.UTC(candidateYear, month - 1, 1));
    const monthEnd = new Date(Date.UTC(candidateYear, month, 0));
    if (start <= monthEnd && end >= monthStart) return 'CONFIRMED';
  }
  return 'INCOMPATIBLE';
}
