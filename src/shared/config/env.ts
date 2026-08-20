import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().url().optional(),
  ADMIN_JWT_SECRET: z.string().min(32),
  ADMIN_AUTH_TOKEN_TTL: z.string().trim().min(2).default('8h'),
  RESOURCES_STORAGE_DIR: z.string().min(1).default('./storage/resources'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_WHATSAPP_FROM: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);
