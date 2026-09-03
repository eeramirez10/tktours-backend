import { z } from 'zod';

export const metaWhatsAppWebhookBodySchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string().trim().min(1),
      changes: z.array(
        z.object({
          field: z.string().trim().min(1),
          value: z.unknown(),
        }),
      ),
    }),
  ),
});

export type MetaWhatsAppWebhookBody = z.infer<typeof metaWhatsAppWebhookBodySchema>;
