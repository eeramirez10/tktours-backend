import { z } from 'zod';

const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;

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

export const listCatalogCollectionQuerySchema = z
  .object({
    active: booleanQuerySchema,
  })
  .transform(({ active }) => ({
    activeOnly: active ?? true,
  }));

export const listCatalogProgramsQuerySchema = z
  .object({
    active: booleanQuerySchema,
    countryCode: optionalTrimmedStringSchema,
    familyKey: z.preprocess(getFirstQueryValue, z.enum(FAMILY_KEYS).optional()),
    locationSlug: optionalTrimmedStringSchema,
    search: optionalTrimmedStringSchema,
  })
  .transform(({ active, countryCode, familyKey, locationSlug, search }) => ({
    activeOnly: active ?? true,
    countryCode: countryCode?.toUpperCase(),
    familyKey,
    locationSlug,
    search,
  }));

export const listCatalogLocationsQuerySchema = z
  .object({
    active: booleanQuerySchema,
    countryCode: optionalTrimmedStringSchema,
    familyKey: z.preprocess(getFirstQueryValue, z.enum(FAMILY_KEYS).optional()),
    search: optionalTrimmedStringSchema,
  })
  .transform(({ active, countryCode, familyKey, search }) => ({
    activeOnly: active ?? true,
    countryCode: countryCode?.toUpperCase(),
    familyKey,
    search,
  }));
