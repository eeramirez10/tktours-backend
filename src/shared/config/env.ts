import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const httpUrl = z.url().refine((value) => /^https?:\/\//i.test(value), 'Must use http or https');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: nonEmptyString.refine(
    (value) => /^(postgresql|postgres|prisma\+postgres):\/\//i.test(value),
    'Must be a PostgreSQL connection URL',
  ),
  CORS_ORIGIN: httpUrl,
  ADMIN_JWT_SECRET: z.string().min(32, 'Must contain at least 32 characters'),
  ADMIN_AUTH_TOKEN_TTL: z.string().trim().regex(/^\d+(s|m|h|d|w)$/, 'Use a duration such as 8h or 15m').default('8h'),
  RESOURCES_STORAGE_DIR: nonEmptyString.default('./storage/resources'),
  PUBLIC_BASE_URL: httpUrl,
  OPENAI_API_KEY: nonEmptyString,
  OPENAI_MODEL: nonEmptyString.default('gpt-5.6-luna'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  TWILIO_ACCOUNT_SID: z.string().trim().regex(/^AC[a-fA-F0-9]{32}$/, 'Must be a Twilio Account SID'),
  TWILIO_AUTH_TOKEN: nonEmptyString,
  TWILIO_WHATSAPP_FROM: z.string().trim().regex(/^whatsapp:\+\d{8,15}$/, 'Must be a WhatsApp sender number'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parseEnv(process.env);
