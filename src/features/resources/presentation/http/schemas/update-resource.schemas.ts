import { z } from 'zod';
import { optionalResourceSeasonsSchema } from './resource-season.schemas.js';

import {
  optionalNullableCurrencySchema,
  optionalNullableDateSchema,
  optionalNullableIntSchema,
  optionalNullableMoneySchema,
  optionalNullableShortStringSchema,
  validateResourceMetadata,
  writableResourceTypeSchema,
} from './resource-metadata.schemas.js';


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

const optionalLocationSlugsSchema = z.array(z.string().trim().min(1)).max(100).optional()
  .transform((value) => value ? Array.from(new Set(value)) : undefined);

const optionalLocationNamesSchema = z.array(z.string().trim().min(1).max(150)).max(100).optional()
  .transform((value) => value ? Array.from(new Set(value.map((item) => item.trim()))) : undefined);

export const updateResourceBodySchema = z
  .object({
    countryCode: optionalTrimmedStringSchema,
    countryName: optionalTrimmedStringSchema,
    familyKey: optionalTrimmedStringSchema,
    seasonKeys: optionalResourceSeasonsSchema,
    programSlug: nullableTrimmedStringSchema,
    locationSlug: nullableTrimmedStringSchema,
    locationSlugs: optionalLocationSlugsSchema,
    locationNames: optionalLocationNamesSchema,
    type: writableResourceTypeSchema.optional(),
    title: optionalTrimmedStringSchema,
    description: nullableTrimmedStringSchema,
    month: z.number().int().min(1).max(12).nullable().optional(),
    year: z.number().int().min(2000).max(2100).nullable().optional(),
    active: z.boolean().optional(),
    minWeeks: optionalNullableIntSchema(1, 104),
    maxWeeks: optionalNullableIntSchema(1, 104),
    validFrom: optionalNullableDateSchema,
    validUntil: optionalNullableDateSchema,
    minAge: optionalNullableIntSchema(0, 120),
    maxAge: optionalNullableIntSchema(0, 120),
    priceFrom: optionalNullableMoneySchema,
    priceCurrency: optionalNullableCurrencySchema,
    priceUnit: optionalNullableShortStringSchema(40),
    priceNotes: optionalNullableShortStringSchema(500),
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
    validateResourceMetadata(value, ctx);
  })
  .transform((value) => ({
    ...value,
    countryCode: value.countryCode?.toUpperCase(),
    countryName: value.countryName?.trim(),
    title: value.title?.trim(),
    programSlug: value.programSlug ?? undefined,
    locationSlug: value.locationSlug ?? undefined,
    locationSlugs: value.locationSlugs,
    locationNames: value.locationNames,
  }));

export const setResourceActiveBodySchema = z.object({
  active: z.boolean(),
});
