import { z } from 'zod';

export const conversationIdParamsSchema = z.object({
  conversationId: z.string().trim().uuid('conversationId must be a UUID'),
});
