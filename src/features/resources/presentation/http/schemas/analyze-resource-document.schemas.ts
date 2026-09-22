import { z } from 'zod';

import { writableResourceTypeSchema } from './resource-metadata.schemas.js';

export const analyzeResourceDocumentBodySchema = z.object({
  familyKey: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed || undefined;
  }, z.string().max(80).optional()),
  type: writableResourceTypeSchema.optional().default('BROCHURE'),
});
