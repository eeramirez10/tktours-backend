import { z } from 'zod';

export const setConversationControlModeBodySchema = z.object({
  controlMode: z.enum(['AI', 'HUMAN']),
});

export const sendHumanConversationMessageBodySchema = z.object({
  text: z.string().trim().min(1).max(4096),
});
