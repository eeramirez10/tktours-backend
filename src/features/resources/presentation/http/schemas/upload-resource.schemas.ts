import { z } from 'zod';

const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;
const RESOURCE_TYPES = ['QUOTE', 'INFO', 'BROCHURE', 'MANUAL', 'PRESENTATION'] as const;
const STORAGE_PROVIDERS = ['S3', 'R2', 'SUPABASE'] as const;

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

const optionalNullableTrimmedStringSchema = z.preprocess((value) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

const optionalBooleanStringSchema = z.preprocess((value) => {
  if (value === undefined || value === '') {
    return undefined;
  }

  if (value === 'true' || value === true) {
    return true;
  }

  if (value === 'false' || value === false) {
    return false;
  }

  return value;
}, z.boolean().optional());

const optionalIntStringSchema = z.preprocess((value) => {
  if (value === undefined || value === '') {
    return undefined;
  }

  if (typeof value === 'string') {
    return Number(value);
  }

  return value;
}, z.number().int().optional());

const optionalWeekOptionsSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return trimmed
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item));
    }
  }

  return value;
}, z.array(z.number().int().min(1).max(104)).max(52).optional())
  .transform((value) => (value ? Array.from(new Set(value)).sort((a, b) => a - b) : undefined));

export const uploadResourceBodySchema = z
  .object({
    countryCode: z.string().trim().min(2).max(3),
    familyKey: z.enum(FAMILY_KEYS).optional(),
    programSlug: optionalTrimmedStringSchema,
    locationSlug: optionalTrimmedStringSchema,
    locationName: optionalTrimmedStringSchema,
    locationVenueName: optionalNullableTrimmedStringSchema,
    locationDescription: optionalNullableTrimmedStringSchema,
    type: z.enum(RESOURCE_TYPES),
    title: z.string().trim().min(1).max(255),
    description: optionalNullableTrimmedStringSchema,
    month: optionalIntStringSchema.pipe(z.number().int().min(1).max(12).optional()),
    year: optionalIntStringSchema.pipe(z.number().int().min(2000).max(2100).optional()),
    active: optionalBooleanStringSchema,
    weekOptions: optionalWeekOptionsSchema,
    storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
    extractText: optionalBooleanStringSchema,
  })
  .superRefine((value, ctx) => {
    if (value.month != null && value.year == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['year'],
        message: 'year is required when month is provided',
      });
    }
  })
  .transform((value) => ({
    countryCode: value.countryCode.trim().toUpperCase(),
    familyKey: value.familyKey,
    programSlug: value.programSlug,
    locationSlug: value.locationSlug,
    locationName: value.locationName,
    locationVenueName: value.locationVenueName ?? null,
    locationDescription: value.locationDescription ?? null,
    type: value.type,
    title: value.title.trim(),
    description: value.description ?? null,
    month: value.month ?? null,
    year: value.year ?? null,
    active: value.active ?? true,
    weekOptions: value.weekOptions,
    storageProvider: value.storageProvider ?? 'SUPABASE',
    extractText: value.extractText ?? true,
  }));

export const uploadResourceVersionBodySchema = z
  .object({
    storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
    extractText: optionalBooleanStringSchema,
  })
  .transform((value) => ({
    storageProvider: value.storageProvider ?? 'SUPABASE',
    extractText: value.extractText ?? true,
  }));
