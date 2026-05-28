import { z } from 'zod';

const CHANNELS = ['WHATSAPP', 'WEB', 'EMAIL'] as const;
const STATUS_KEYS = ['OPEN', 'PAUSED', 'CLOSED', 'ARCHIVED'] as const;

function getFirstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

const optionalTrimmedString = z.preprocess((value) => {
  const candidate = getFirstQueryValue(value);
  if (typeof candidate !== 'string') return candidate;
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const listConversationsQuerySchema = z.object({
  status: z.preprocess(getFirstQueryValue, z.enum(STATUS_KEYS).optional()),
  channel: z.preprocess(getFirstQueryValue, z.enum(CHANNELS).optional()),
  contactId: optionalTrimmedString,
  search: optionalTrimmedString,
});
