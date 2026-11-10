import { resourceBusinessDate } from './resource-validity.js';
import { resourceTripCompatibility, type ResourceTripCompatibility } from './resource-trip-compatibility.js';

export function resourceStayCompatibility(resource: {
  year: number | null; validFrom: Date | string | null; validUntil: Date | string | null;
  minWeeks: number | null; maxWeeks: number | null;
}, month: number, weeks: number, year?: number | null, today = resourceBusinessDate()): ResourceTripCompatibility {
  if ((resource.minWeeks != null && weeks < resource.minWeeks) || (resource.maxWeeks != null && weeks > resource.maxWeeks)) return 'INCOMPATIBLE';
  const trip = resourceTripCompatibility(resource, month, year);
  if (trip !== 'CONFIRMED') return trip;
  if (resource.minWeeks == null || resource.maxWeeks == null) return 'UNCONFIRMED';
  const start = new Date(resource.validFrom!);
  const end = new Date(resource.validUntil!);
  for (let candidateYear = year ?? Math.max(start.getUTCFullYear(), today.getUTCFullYear()); candidateYear <= (year ?? end.getUTCFullYear()); candidateYear++) {
    const earliest = Math.max(start.getTime(), Date.UTC(candidateYear, month - 1, 1), today.getTime());
    const latest = Math.min(Date.UTC(candidateYear, month, 0), end.getTime() - (weeks * 7 - 1) * 86400000);
    if (earliest <= latest) return 'CONFIRMED';
  }
  return 'INCOMPATIBLE';
}
