import { z } from 'zod';

const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;
const RESOURCE_TYPES = ['QUOTE', 'INFO', 'BROCHURE', 'MANUAL', 'PRESENTATION'] as const;

function getFirstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

const booleanQuerySchema = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);

  if (candidate === undefined || candidate === '') {
    return undefined;
  }

  if (candidate === 'true') {
    return true;
  }

  if (candidate === 'false') {
    return false;
  }

  return candidate;
}, z.boolean().optional());

const optionalTrimmedStringSchema = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);

  if (typeof candidate !== 'string') {
    return candidate;
  }

  const trimmed = candidate.trim();

  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const listResourcesQuerySchema = z
  .object({
    active: booleanQuerySchema,
    countryCode: optionalTrimmedStringSchema,
    familyKey: z.preprocess(getFirstQueryValue, z.enum(FAMILY_KEYS).optional()),
    type: z.preprocess(getFirstQueryValue, z.enum(RESOURCE_TYPES).optional()),
    programSlug: optionalTrimmedStringSchema,
    search: optionalTrimmedStringSchema,
  })
  .transform(({ active, countryCode, familyKey, type, programSlug, search }) => ({
    activeOnly: active ?? true,
    countryCode: countryCode?.toUpperCase(),
    familyKey,
    type,
    programSlug,
    search,
  }));
