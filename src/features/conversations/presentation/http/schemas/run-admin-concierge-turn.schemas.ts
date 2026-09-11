import { z } from 'zod';

export const runAdminConciergeTurnBodySchema = z.object({
  text: z.string().trim().min(1).max(4_000),
});
