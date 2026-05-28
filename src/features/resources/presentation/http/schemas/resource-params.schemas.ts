import { z } from 'zod';

export const resourceIdParamsSchema = z.object({
  resourceId: z.string().trim().min(1, 'resourceId is required'),
});

export const resourceDownloadParamsSchema = z.object({
  resourceId: z.string().trim().min(1, 'resourceId is required'),
  versionId: z.string().trim().min(1, 'versionId is required'),
});
