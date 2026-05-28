import { z } from 'zod';

export const catalogProgramSlugParamsSchema = z.object({
  slug: z.string().trim().min(1, 'slug is required'),
});
