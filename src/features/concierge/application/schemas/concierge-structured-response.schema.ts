import { z } from 'zod';

const DETECTED_NEEDS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM', 'UNKNOWN'] as const;
const MISSING_FIELDS = [
  'country',
  'studentAge',
  'residenceCountry',
  'cityOfResidence',
  'family',
  'program',
  'accommodation',
  'preferredStartMonth',
  'preferredStartYear',
  'weeks',
] as const;

const NEXT_STAGES = [
  'START',
  'QUALIFY_AGE',
  'QUALIFY_COUNTRY',
  'QUALIFY_PROGRAM',
  'QUALIFY_ACCOMMODATION',
  'QUALIFY_DATES',
  'RECOMMEND',
  'SEND_RESOURCE',
  'ESCALATED',
  'CLOSED',
] as const;

export const conciergeStructuredResponseSchema = z.object({
  replyText: z.string().trim().min(1),
  shouldAskFollowUp: z.boolean(),
  detectedNeed: z.enum(DETECTED_NEEDS),
  missingFields: z.array(z.string()).transform((fields) => {
    const allowed = new Set<string>(MISSING_FIELDS);
    return fields.filter((field): field is (typeof MISSING_FIELDS)[number] => allowed.has(field));
  }),
  nextStage: z.enum(NEXT_STAGES).nullable().optional(),
  shouldRefreshRecommendations: z.boolean().optional(),
});
