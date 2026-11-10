export type CourseOffering = {
  familyKey: 'LANGUAGE_COURSE' | 'CAMP' | 'SCHOOL_PROGRAM';
  name: string;
  programCount: number;
  brochureCount: number;
};

export function courseMenuText(offerings: CourseOffering[]): string {
  return offerings.map((offering, index) => `${index + 1}) ${offering.name}`).join('\n');
}
