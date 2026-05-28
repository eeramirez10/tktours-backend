import { z } from 'zod';

const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;
const ACCOMMODATION_KEYS = ['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT'] as const;

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

const optionalIntSchema = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);
  if (candidate === undefined || candidate === '') {
    return undefined;
  }
  if (typeof candidate === 'string') {
    return Number(candidate);
  }
  return candidate;
}, z.number().int().optional());

export const listCatalogRecommendationsQuerySchema = z
  .object({
    countryCode: z.preprocess(getFirstQueryValue, z.string().trim().min(2).max(3)),
    familyKey: z.preprocess(getFirstQueryValue, z.enum(FAMILY_KEYS).optional()),
    studentAge: optionalIntSchema,
    accommodationKey: z.preprocess(getFirstQueryValue, z.enum(ACCOMMODATION_KEYS).optional()),
    preferredStartMonth: optionalIntSchema,
    weeks: optionalIntSchema,
    search: optionalTrimmedStringSchema,
  })
  .transform((value) => ({
    ...value,
    countryCode: value.countryCode.toUpperCase(),
  }));
