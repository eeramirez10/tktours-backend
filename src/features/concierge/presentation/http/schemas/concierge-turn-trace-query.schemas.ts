import { z } from 'zod';

const TURN_STATUSES = ['STARTED', 'COMPLETED', 'FAILED'] as const;

function getFirstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

const optionalTrimmedString = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);
  if (typeof candidate !== 'string') return candidate;
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

const optionalNumber = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);
  if (candidate === undefined || candidate === '') return undefined;
  if (typeof candidate === 'string') return Number(candidate);
  return candidate;
}, z.number().int().positive().optional());

export const listConciergeTurnTraceQuerySchema = z.object({
  conversationId: optionalTrimmedString,
  inquiryId: optionalTrimmedString,
  status: z.preprocess(getFirstQueryValue, z.enum(TURN_STATUSES).optional()),
  limit: optionalNumber,
}).transform((value) => ({
  conversationId: value.conversationId,
  inquiryId: value.inquiryId,
  status: value.status,
  limit: value.limit ?? 20,
}));

export const conciergeTurnTraceParamsSchema = z.object({
  turnId: z.string().trim().uuid('turnId must be a UUID'),
});
