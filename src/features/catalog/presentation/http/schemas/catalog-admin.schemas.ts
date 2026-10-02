import { z } from 'zod';

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

const nullableIntSchema = z.number().int().min(0).max(120).nullable().optional();
const campSeasonsSchema = z.array(z.enum(['SUMMER', 'EASTER', 'WINTER']))
  .max(3)
  .transform((seasons) => [...new Set(seasons)])
  .optional();

const catalogKeySchema = z.string().trim().min(2).max(64).regex(
  /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/,
  'key must use uppercase letters, numbers, and underscores',
);

const catalogSlugSchema = z.string().trim().min(1).max(120).regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  'slug must use lowercase letters, numbers, and hyphens',
);

export const createCatalogCountryBodySchema = z
  .object({
    code: z.string().trim().min(2).max(20),
    name: z.string().trim().min(1).max(120),
    active: z.boolean().optional(),
  })
  .transform((value) => ({
    code: value.code.trim().toUpperCase(),
    name: value.name.trim(),
    active: value.active ?? true,
  }));

export const updateCatalogCountryBodySchema = z
  .object({
    code: optionalTrimmedStringSchema,
    name: optionalTrimmedStringSchema,
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'at least one field is required',
      });
    }
  })
  .transform((value) => ({
    code: value.code?.trim().toUpperCase(),
    name: value.name?.trim(),
    active: value.active,
  }));

export const createCatalogFamilyBodySchema = z
  .object({
    key: catalogKeySchema.optional(),
    name: z.string().trim().min(1).max(120),
    active: z.boolean().optional(),
  })
  .transform((value) => ({
    key: value.key,
    name: value.name.trim(),
    active: value.active ?? true,
  }));

export const updateCatalogFamilyBodySchema = z
  .object({
    name: optionalTrimmedStringSchema,
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'at least one field is required' });
    }
  });

export const createCatalogLocationBodySchema = z
  .object({
    countryCode: z.string().trim().min(2).max(20),
    name: z.string().trim().min(1).max(120),
    venueName: nullableTrimmedStringSchema,
    description: nullableTrimmedStringSchema,
    active: z.boolean().optional(),
  })
  .transform((value) => ({
    countryCode: value.countryCode.trim().toUpperCase(),
    name: value.name.trim(),
    venueName: value.venueName ?? null,
    description: value.description ?? null,
    active: value.active ?? true,
  }));

export const updateCatalogLocationBodySchema = z
  .object({
    countryCode: optionalTrimmedStringSchema,
    name: optionalTrimmedStringSchema,
    venueName: nullableTrimmedStringSchema,
    description: nullableTrimmedStringSchema,
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'at least one field is required',
      });
    }
  })
  .transform((value) => ({
    countryCode: value.countryCode?.trim().toUpperCase(),
    name: value.name?.trim(),
    venueName: value.venueName ?? null,
    description: value.description ?? null,
    active: value.active,
  }));

export const createCatalogProgramBodySchema = z
  .object({
    countryCode: z.string().trim().min(2).max(20),
    familyKey: catalogKeySchema,
    slug: catalogSlugSchema.optional(),
    name: z.string().trim().min(1).max(160),
    description: nullableTrimmedStringSchema,
    minAge: nullableIntSchema,
    maxAge: nullableIntSchema,
    seasonKeys: campSeasonsSchema,
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.familyKey === 'CAMP' && !value.seasonKeys?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seasonKeys'], message: 'Selecciona al menos una temporada para el programa de campamentos.' });
    }
    if (value.minAge != null && value.maxAge != null && value.minAge > value.maxAge) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxAge'], message: 'maxAge must be greater than or equal to minAge' });
    }
  })
  .transform((value) => ({
    ...value,
    countryCode: value.countryCode.toUpperCase(),
    active: value.active ?? true,
  }));

export const updateCatalogProgramBodySchema = z
  .object({
    name: optionalTrimmedStringSchema,
    description: nullableTrimmedStringSchema,
    minAge: nullableIntSchema,
    maxAge: nullableIntSchema,
    seasonKeys: campSeasonsSchema,
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: 'at least one field is required' });
    }
    if (value.minAge != null && value.maxAge != null && value.minAge > value.maxAge) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maxAge'], message: 'maxAge must be greater than or equal to minAge' });
    }
  });
