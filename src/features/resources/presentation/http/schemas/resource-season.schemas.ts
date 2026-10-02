import { z } from 'zod';

export const optionalResourceSeasonsSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}, z.array(z.enum(['SUMMER', 'EASTER', 'WINTER'])).max(3).optional())
  .transform((value) => value ? [...new Set(value)] : undefined);
