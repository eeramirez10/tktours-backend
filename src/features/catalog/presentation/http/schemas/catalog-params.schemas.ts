import { z } from 'zod';

export const catalogProgramSlugParamsSchema = z.object({
  slug: z.string().trim().min(1, 'slug is required'),
});

export const catalogCountryIdParamsSchema = z.object({
  countryId: z.string().uuid(),
});

export const catalogLocationIdParamsSchema = z.object({
  locationId: z.string().uuid(),
});
