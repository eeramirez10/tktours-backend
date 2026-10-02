import { z } from 'zod';

export const writableResourceTypeSchema = z.enum(['BROCHURE', 'MANUAL']);

export const optionalNullableDateSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return value;
}, z.union([z.iso.date(), z.date(), z.null()]).optional()).transform((value) => {
  if (typeof value === 'string') return new Date(`${value}T00:00:00.000Z`);
  return value;
});

export const optionalNullableIntSchema = (minimum: number, maximum: number) => z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' ? Number(value) : value;
}, z.number().int().min(minimum).max(maximum).nullable().optional());

export const optionalNullableMoneySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' ? Number(value) : value;
}, z.number().finite().nonnegative().max(999_999_999.99).nullable().optional());

export const optionalNullableCurrencySchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}, z.string().regex(/^[A-Z]{3}$/, 'priceCurrency must be an ISO 4217 code').nullable().optional());

export const optionalNullableShortStringSchema = (maximum: number) => z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' ? value.trim() : value;
}, z.string().min(1).max(maximum).nullable().optional());

export function validateResourceMetadata(
  value: {
    familyKey?: string | null;
    type?: string;
    shareFrom?: Date | null;
    shareUntil?: Date | null;
    validFrom?: Date | null;
    validUntil?: Date | null;
    minAge?: number | null;
    maxAge?: number | null;
    minWeeks?: number | null;
    maxWeeks?: number | null;
    priceFrom?: number | null;
    priceCurrency?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.shareFrom && value.shareUntil && value.shareFrom > value.shareUntil) {
    ctx.addIssue({ code: 'custom', path: ['shareUntil'], message: 'La vigencia para compartir debe terminar después de su inicio.' });
  }

  if (value.validFrom && value.validUntil && value.validFrom > value.validUntil) {
    ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'validUntil must be on or after validFrom' });
  }

  if (value.minAge != null && value.maxAge != null && value.minAge > value.maxAge) {
    ctx.addIssue({ code: 'custom', path: ['maxAge'], message: 'maxAge must be greater than or equal to minAge' });
  }

  if (value.minWeeks != null && value.maxWeeks != null && value.minWeeks > value.maxWeeks) {
    ctx.addIssue({ code: 'custom', path: ['maxWeeks'], message: 'maxWeeks must be greater than or equal to minWeeks' });
  }

  if (value.priceFrom != null && (value.familyKey !== 'CAMP' || value.type !== 'BROCHURE')) {
    ctx.addIssue({
      code: 'custom',
      path: ['priceFrom'],
      message: 'Resource prices are only allowed for CAMP brochures',
    });
  }
}
