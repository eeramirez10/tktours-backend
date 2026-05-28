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

const initialVersionSchema = z
  .discriminatedUnion('sourceType', [
    z.object({
      sourceType: z.literal('UPLOAD'),
      fileName: z.string().trim().min(1).max(255),
      mimeType: optionalNullableTrimmedStringSchema,
      storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
      fileContentBase64: z.string().trim().min(1),
    }),
    z.object({
      sourceType: z.literal('EXTERNAL_LINK'),
      fileName: z.string().trim().min(1).max(255),
      mimeType: optionalNullableTrimmedStringSchema,
      externalUrl: z.url(),
    }),
  ])
  .optional();

export const createResourceBodySchema = z
  .object({
    countryCode: z.string().trim().min(2).max(3),
    familyKey: z.enum(FAMILY_KEYS).optional(),
    programSlug: optionalTrimmedStringSchema,
    type: z.enum(RESOURCE_TYPES),
    title: z.string().trim().min(1).max(255),
    description: optionalNullableTrimmedStringSchema,
    month: z.number().int().min(1).max(12).nullable().optional(),
    year: z.number().int().min(2000).max(2100).nullable().optional(),
    active: z.boolean().optional(),
    createdById: optionalNullableTrimmedStringSchema,
    initialVersion: initialVersionSchema,
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
  .transform(({ countryCode, familyKey, programSlug, type, title, description, month, year, active, createdById, initialVersion }) => ({
    countryCode: countryCode.trim().toUpperCase(),
    familyKey,
    programSlug,
    type,
    title: title.trim(),
    description: description ?? null,
    month: month ?? null,
    year: year ?? null,
    active: active ?? true,
    createdById: createdById ?? null,
    initialVersion: initialVersion ?? null,
  }));
