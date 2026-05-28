import { z } from 'zod';

const CHANNELS = ['WHATSAPP', 'WEB', 'EMAIL'] as const;
const STATUS_KEYS = ['OPEN', 'PAUSED', 'CLOSED', 'ARCHIVED'] as const;
const STAGE_KEYS = ['START', 'QUALIFY_AGE', 'QUALIFY_COUNTRY', 'QUALIFY_PROGRAM', 'QUALIFY_ACCOMMODATION', 'QUALIFY_DATES', 'RECOMMEND', 'SEND_RESOURCE', 'ESCALATED', 'CLOSED'] as const;

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const createConversationBodySchema = z.object({
  contactId: optionalTrimmedString,
  channel: z.enum(CHANNELS).optional(),
  status: z.enum(STATUS_KEYS).optional(),
  currentStage: z.enum(STAGE_KEYS).optional(),
  contextJson: z.record(z.string(), z.unknown()).nullable().optional(),
}).transform((value) => ({
  ...value,
  contextJson: value.contextJson ?? null,
}));
