import { z } from 'zod';

const CHANNELS = ['WHATSAPP', 'WEB', 'EMAIL'] as const;
const STATUS_KEYS = ['OPEN', 'QUALIFYING', 'READY_TO_RECOMMEND', 'RECOMMENDED', 'WAITING_HUMAN', 'CLOSED'] as const;
const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;
const ACCOMMODATION_KEYS = ['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT'] as const;

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

const optionalNullableTrimmedString = z.preprocess((value) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

const contactSchema = z.object({
  waId: optionalTrimmedString,
  firstName: optionalTrimmedString,
  lastName: optionalTrimmedString,
  email: optionalTrimmedString,
  phone: optionalTrimmedString,
  city: optionalTrimmedString,
  notes: optionalNullableTrimmedString,
}).optional();

export const createInquiryBodySchema = z.object({
  conversationId: optionalTrimmedString,
  contactId: optionalTrimmedString,
  contact: contactSchema,
  channel: z.enum(CHANNELS).optional(),
  countryCode: optionalTrimmedString,
  familyKey: z.enum(FAMILY_KEYS).optional(),
  locationSlug: optionalTrimmedString,
  programSlug: optionalTrimmedString,
  studentAge: z.number().int().min(1).max(99).nullable().optional(),
  cityOfResidence: optionalNullableTrimmedString,
  preferredStartMonth: z.number().int().min(1).max(12).nullable().optional(),
  preferredStartYear: z.number().int().min(2024).max(2100).nullable().optional(),
  accommodationKey: z.enum(ACCOMMODATION_KEYS).optional(),
  weeks: z.number().int().min(1).max(52).nullable().optional(),
  notes: optionalNullableTrimmedString,
  qualificationJson: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(STATUS_KEYS).optional(),
}).transform((value) => ({
  ...value,
  countryCode: value.countryCode?.toUpperCase(),
  qualificationJson: value.qualificationJson ?? null,
}));
