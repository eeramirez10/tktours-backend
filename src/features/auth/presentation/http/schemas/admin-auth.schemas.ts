import { z } from 'zod';

export const adminLoginBodySchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1_024),
});
