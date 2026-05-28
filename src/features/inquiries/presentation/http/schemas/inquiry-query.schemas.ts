import { z } from 'zod';

const STATUS_KEYS = ['OPEN', 'QUALIFYING', 'READY_TO_RECOMMEND', 'RECOMMENDED', 'WAITING_HUMAN', 'CLOSED'] as const;
const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;

function getFirstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

const optionalTrimmedStringSchema = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);
  if (typeof candidate !== 'string') {
    return candidate;
  }
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const listInquiriesQuerySchema = z.object({
  status: z.preprocess(getFirstQueryValue, z.enum(STATUS_KEYS).optional()),
  countryCode: optionalTrimmedStringSchema,
  familyKey: z.preprocess(getFirstQueryValue, z.enum(FAMILY_KEYS).optional()),
  search: optionalTrimmedStringSchema,
}).transform((value) => ({
  ...value,
  countryCode: value.countryCode?.toUpperCase(),
}));
