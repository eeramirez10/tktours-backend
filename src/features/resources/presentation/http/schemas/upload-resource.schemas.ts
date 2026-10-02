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

const optionalLocationSlugsSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(',');
    }
  }
  return value;
}, z.array(z.string().trim().min(1)).max(100).optional())
  .transform((value) => value ? Array.from(new Set(value.map((item) => item.trim()).filter(Boolean))) : undefined);

const optionalLocationNamesSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(',');
    }
  }
  return value;
}, z.array(z.string().trim().min(1).max(150)).max(100).optional())
  .transform((value) => value ? Array.from(new Set(value.map((item) => item.trim()).filter(Boolean))) : undefined);

export const uploadResourceBodySchema = z
  .object({
    countryCode: z.string().trim().min(2).max(3),
    countryName: optionalTrimmedStringSchema,
    familyKey: optionalTrimmedStringSchema,
    seasonKeys: optionalResourceSeasonsSchema,
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
    month: optionalIntStringSchema.pipe(z.number().int().min(1).max(12).optional()),
    year: optionalIntStringSchema.pipe(z.number().int().min(2000).max(2100).optional()),
    active: optionalBooleanStringSchema,
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
    storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
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
  .transform((value) => ({
    countryCode: value.countryCode.trim().toUpperCase(),
    countryName: value.countryName,
    familyKey: value.familyKey,
    seasonKeys: value.seasonKeys,
    programSlug: value.programSlug,
    locationSlug: value.locationSlug,
    locationSlugs: value.locationSlugs,
    locationNames: value.locationNames,
    locationName: value.locationName,
    locationVenueName: value.locationVenueName ?? null,
    locationDescription: value.locationDescription ?? null,
    type: value.type,
    title: value.title.trim(),
    description: value.description ?? null,
    month: value.month ?? null,
    year: value.year ?? null,
    active: value.active ?? true,
    minWeeks: value.minWeeks,
    maxWeeks: value.maxWeeks,
    validFrom: value.validFrom ?? null,
    validUntil: value.validUntil ?? null,
    minAge: value.minAge ?? null,
    maxAge: value.maxAge ?? null,
    priceFrom: value.priceFrom ?? null,
    priceCurrency: value.priceCurrency ?? null,
    priceUnit: value.priceUnit ?? null,
    priceNotes: value.priceNotes ?? null,
    storageProvider: value.storageProvider ?? 'SUPABASE',
  }));

export const uploadResourceVersionBodySchema = z
  .object({
    storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
  })
  .transform((value) => ({
    storageProvider: value.storageProvider ?? 'SUPABASE',
  }));
