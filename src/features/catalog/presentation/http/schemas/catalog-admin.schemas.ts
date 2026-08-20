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

