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
    updatedById: nullableTrimmedStringSchema,
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
    updatedById: value.updatedById ?? null,
  }));

export const setResourceActiveBodySchema = z.object({
  active: z.boolean(),
  updatedById: nullableTrimmedStringSchema,
});
