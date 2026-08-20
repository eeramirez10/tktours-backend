import { z } from 'zod';

const FAMILY_KEYS = ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] as const;
const RESOURCE_TYPES = ['QUOTE', 'INFO', 'BROCHURE', 'MANUAL', 'PRESENTATION'] as const;

const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

const nullableTrimmedStringSchema = z.preprocess((value) => {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

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

export const updateResourceBodySchema = z
  .object({
    countryCode: optionalTrimmedStringSchema,
    familyKey: z.enum(FAMILY_KEYS).optional(),
    programSlug: nullableTrimmedStringSchema,
    locationSlug: nullableTrimmedStringSchema,
    type: z.enum(RESOURCE_TYPES).optional(),
    title: optionalTrimmedStringSchema,
    description: nullableTrimmedStringSchema,
    month: z.number().int().min(1).max(12).nullable().optional(),
    year: z.number().int().min(2000).max(2100).nullable().optional(),
    active: z.boolean().optional(),
    weekOptions: optionalWeekOptionsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.month != null && value.year === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['year'],
        message: 'year must be sent when month is provided',
      });
    }

    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'at least one field is required',
      });
    }
  })
  .transform((value) => ({
    ...value,
    countryCode: value.countryCode?.toUpperCase(),
    title: value.title?.trim(),
    programSlug: value.programSlug ?? undefined,
    locationSlug: value.locationSlug ?? undefined,
  }));

export const setResourceActiveBodySchema = z.object({
  active: z.boolean(),
});
