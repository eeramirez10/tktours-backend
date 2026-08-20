import { z } from 'zod';

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const twilioWhatsAppWebhookBodySchema = z.object({
  MessageSid: z.string().trim().min(1),
  From: z.string().trim().min(1),
  To: optionalTrimmedString,
  Body: optionalTrimmedString,
  WaId: optionalTrimmedString,
  ProfileName: optionalTrimmedString,
});

export type TwilioWhatsAppWebhookBody = z.infer<typeof twilioWhatsAppWebhookBodySchema>;

export const twilioWhatsAppStatusBodySchema = z.object({
  MessageSid: z.string().trim().min(1),
  MessageStatus: optionalTrimmedString,
  SmsStatus: optionalTrimmedString,
  ErrorCode: optionalTrimmedString,
  ErrorMessage: optionalTrimmedString,
});

export type TwilioWhatsAppStatusBody = z.infer<typeof twilioWhatsAppStatusBodySchema>;
