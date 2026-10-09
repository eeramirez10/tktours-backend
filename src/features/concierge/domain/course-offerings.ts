import { canonicalConciergeFamily } from '../../catalog/domain/concierge-families.js';

export type CourseOffering = {
  familyKey: 'LANGUAGE_COURSE' | 'CAMP' | 'SCHOOL_PROGRAM';
  name: string;
  programCount: number;
  brochureCount: number;
};

export function courseMenuText(offerings: CourseOffering[]): string {
  return offerings.map((offering, index) => `${index + 1}) ${offering.name}`).join('\n');
}

export function displayedCourseChoice(message: string, previousReply: string | null): CourseOffering['familyKey'] | null {
  const choice = message.trim().match(/^(\d{1,2})[.)]?$/)?.[1];
  if (!choice || !previousReply) return null;
  for (const line of previousReply.split('\n')) {
    const option = line.trim().match(/^(\d{1,2})[.)]\s+(.+)$/);
    if (option?.[1] === choice) return canonicalConciergeFamily(option[2]!)?.key ?? null;
  }
  return null;
}
