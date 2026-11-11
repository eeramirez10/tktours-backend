import { z } from 'zod';

// Every semantic decision comes from this single, validated interpretation of the turn.
export const conciergeMessageInterpretationSchema = z.object({
  intent: z.enum(['GREETING', 'RESTART', 'CLOSE', 'ASK_AVAILABLE_COUNTRIES', 'ASK_AVAILABLE_PROGRAMS', 'REQUEST_QUOTE', 'ASK_LANGUAGE_COURSES', 'ASK_CAMPS', 'ASK_CIRCUITS', 'UNKNOWN']),
  countryCode: z.string().nullable(),
  locationSlug: z.string().nullable(),
  programSlug: z.string().nullable(),
  familyKey: z.enum(['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM']).nullable(),
  studentAge: z.number().int().min(1).max(120).nullable(),
  residenceCountry: z.string().nullable(),
  cityOfResidence: z.string().nullable(),
  tripDays: z.number().int().positive().nullable(),
  accommodationKey: z.enum(['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT']).nullable(),
  preferredStartMonth: z.number().int().min(1).max(12).nullable(),
  preferredStartYear: z.number().int().min(1900).max(2200).nullable(),
  preferredStartUndecided: z.boolean(),
  weeks: z.number().int().positive().nullable(),
  weeksUndecided: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  menuWasShown: z.boolean(),
  asksAccommodationOptions: z.boolean(),
  asksForCities: z.boolean(),
  isQuestion: z.boolean(),
  changesTopic: z.boolean(),
  isNegativeProgramAnswer: z.boolean(),
  handoffStep: z.enum(['ask_name', 'ask_email', 'confirm_handoff', 'none']),
  requestsResource: z.boolean(),
  brochureAction: z.enum(['SEND', 'DECLINE', 'CLARIFY', 'UNKNOWN']),
  selectedSeasonKeys: z.array(z.enum(['SUMMER', 'EASTER', 'WINTER'])),
  sendAllResources: z.boolean(),
  maintainTravelMonth: z.boolean(),
  priceQuestion: z.enum(['NONE', 'PRICE', 'PACKAGE', 'EXTRA_WEEK']),
  requestedTariffWeeks: z.number().int().positive().nullable(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

export type ConciergeMessageInterpretation = z.infer<typeof conciergeMessageInterpretationSchema>;
export type InterpretConciergeMessageArgs = {
  latestMessage: string;
  previousAssistantMessage: string | null;
  expectedField: string | null;
  recentMessages: Array<{ direction: string; text: string }>;
  inquirySnapshot: Record<string, unknown> | null;
  availableCourseTypes: Array<{ familyKey: string; name: string }>;
  availableCities: Array<{ slug: string; name: string }>;
  availablePrograms?: Array<{ slug: string; name: string; countryCode: string; familyKey: string; locationSlug: string | null }>;
  brochureState?: unknown;
  displayedCityMenu: unknown;
  nowIso: string;
};
