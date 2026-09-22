import { z } from 'zod';

import {
  optionalNullableCurrencySchema,
  optionalNullableDateSchema,
  optionalNullableIntSchema,
  optionalNullableMoneySchema,
  optionalNullableShortStringSchema,
  validateResourceMetadata,
  writableResourceTypeSchema,
} from './resource-metadata.schemas.js';

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

const optionalLocationSlugsSchema = z.array(z.string().trim().min(1)).max(100).optional()
  .transform((value) => value ? Array.from(new Set(value)) : undefined);

const optionalLocationNamesSchema = z.array(z.string().trim().min(1).max(150)).max(100).optional()
  .transform((value) => value ? Array.from(new Set(value.map((item) => item.trim()))) : undefined);

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
    countryName: optionalTrimmedStringSchema,
    familyKey: optionalTrimmedStringSchema,
    programSlug: optionalTrimmedStringSchema,
    locationSlug: optionalTrimmedStringSchema,
    locationSlugs: optionalLocationSlugsSchema,
    locationNames: optionalLocationNamesSchema,
    locationName: optionalTrimmedStringSchema,
    locationVenueName: optionalNullableTrimmedStringSchema,
    locationDescription: optionalNullableTrimmedStringSchema,
    type: writableResourceTypeSchema,
    title: z.string().trim().min(1).max(255),
    description: optionalNullableTrimmedStringSchema,
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
    validateResourceMetadata(value, ctx);
  })
  .transform(({
    countryCode,
    countryName,
    familyKey,
    programSlug,
    locationSlug,
    locationSlugs,
    locationNames,
    locationName,
    locationVenueName,
    locationDescription,
    type,
    title,
    description,
    month,
    year,
    active,
    minWeeks,
    maxWeeks,
    validFrom,
    validUntil,
    minAge,
    maxAge,
    priceFrom,
    priceCurrency,
    priceUnit,
    priceNotes,
    initialVersion,
  }) => ({
    countryCode: countryCode.trim().toUpperCase(),
    countryName,
    familyKey,
    programSlug,
    locationSlug,
    locationSlugs,
    locationNames,
    locationName,
    locationVenueName: locationVenueName ?? null,
    locationDescription: locationDescription ?? null,
    type,
    title: title.trim(),
    description: description ?? null,
    month: month ?? null,
    year: year ?? null,
    active: active ?? true,
    minWeeks,
    maxWeeks,
    validFrom: validFrom ?? null,
    validUntil: validUntil ?? null,
    minAge: minAge ?? null,
    maxAge: maxAge ?? null,
    priceFrom: priceFrom ?? null,
    priceCurrency: priceCurrency ?? null,
    priceUnit: priceUnit ?? null,
    priceNotes: priceNotes ?? null,
    initialVersion: initialVersion ?? null,
  }));
