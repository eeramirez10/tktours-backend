import { z } from 'zod';

const STORAGE_PROVIDERS = ['S3', 'R2', 'SUPABASE'] as const;

const trimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const createResourceVersionBodySchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('UPLOAD'),
    fileName: z.string().trim().min(1).max(255),
    mimeType: trimmedString.nullable().optional(),
    storageProvider: z.enum(STORAGE_PROVIDERS).optional(),
    fileContentBase64: z.string().trim().min(1),
    uploadedById: trimmedString.nullable().optional(),
  }),
  z.object({
    sourceType: z.literal('EXTERNAL_LINK'),
    fileName: z.string().trim().min(1).max(255),
    mimeType: trimmedString.nullable().optional(),
    externalUrl: z.url(),
    uploadedById: trimmedString.nullable().optional(),
  }),
]);
