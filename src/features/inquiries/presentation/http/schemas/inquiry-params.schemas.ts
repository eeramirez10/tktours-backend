import { z } from 'zod';

export const inquiryIdParamsSchema = z.object({
  inquiryId: z.string().trim().uuid('inquiryId must be a UUID'),
});
