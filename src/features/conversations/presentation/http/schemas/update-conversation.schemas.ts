import { z } from 'zod';

const STATUS_KEYS = ['OPEN', 'PAUSED', 'CLOSED', 'ARCHIVED'] as const;
const STAGE_KEYS = ['START', 'QUALIFY_AGE', 'QUALIFY_COUNTRY', 'QUALIFY_PROGRAM', 'QUALIFY_ACCOMMODATION', 'QUALIFY_DATES', 'RECOMMEND', 'SEND_RESOURCE', 'ESCALATED', 'CLOSED'] as const;
const MESSAGE_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'SYSTEM'] as const;

const optionalNullableTrimmedString = z.preprocess((value) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}, z.string().nullable().optional());

export const updateConversationBodySchema = z.object({
  status: z.enum(STATUS_KEYS).optional(),
  currentStage: z.enum(STAGE_KEYS).optional(),
  contextJson: z.record(z.string(), z.unknown()).nullable().optional(),
  lastMessageAt: optionalNullableTrimmedString,
}).transform((value) => ({
  ...value,
  contextJson: Object.prototype.hasOwnProperty.call(value, 'contextJson') ? value.contextJson ?? null : undefined,
}));

export const createMessageBodySchema = z.object({
  direction: z.enum(MESSAGE_DIRECTIONS),
  text: z.string().trim().min(1),
  mediaUrl: optionalNullableTrimmedString,
  providerMessageId: optionalNullableTrimmedString,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
}).transform((value) => ({
  ...value,
  mediaUrl: value.mediaUrl ?? null,
  providerMessageId: value.providerMessageId ?? null,
  metadata: value.metadata ?? null,
}));
