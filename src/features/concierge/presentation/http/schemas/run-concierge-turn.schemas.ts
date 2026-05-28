import { z } from "zod";

export const runConciergeTurnBodySchema = z.object({
  conversationId: z.string().trim().uuid('ConversationID must be a UUID'),
  incomingMessageId: z.string().trim().uuid('incomingMessageId must be a UUID'),
})