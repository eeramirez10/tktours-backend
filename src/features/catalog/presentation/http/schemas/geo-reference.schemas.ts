import { z } from 'zod';

export const referenceCountriesQuerySchema = z.object({ search: z.string().trim().max(100).optional() });
export const referenceCitiesQuerySchema = z.object({
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  search: z.string().trim().max(100).optional(),
});
