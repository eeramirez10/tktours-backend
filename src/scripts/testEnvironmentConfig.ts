const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/tktours?schema=public',
  CORS_ORIGIN: 'http://localhost:5173',
  ADMIN_JWT_SECRET: 'a'.repeat(32),
  PUBLIC_BASE_URL: 'https://api.example.com',
  OPENAI_API_KEY: 'test-openai-key',
  WHATSAPP_META_ACCESS_TOKEN: 'test-meta-access-token',
  WHATSAPP_META_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_META_VERIFY_TOKEN: 'test-meta-verify-token-value',
  WHATSAPP_META_APP_SECRET: '0'.repeat(32),
  WHATSAPP_META_GRAPH_API_VERSION: 'v24.0',
};

Object.assign(process.env, validEnvironment);
delete process.env.OPENAI_MODEL;
delete process.env.OPENAI_TIMEOUT_MS;
delete process.env.PORT;

const { parseEnv } = await import('../shared/config/env.js');
const parsed = parseEnv(validEnvironment);

if (parsed.OPENAI_MODEL !== 'gpt-5.6-luna') {
  throw new Error(`Expected default model gpt-5.6-luna, got ${parsed.OPENAI_MODEL}`);
}

if (parsed.OPENAI_TIMEOUT_MS !== 30_000 || parsed.PORT !== 3000) {
  throw new Error('Expected numeric environment defaults were not applied');
}

let rejectedInvalidPort = false;
try {
  parseEnv({ ...validEnvironment, PORT: '70000' });
} catch {
  rejectedInvalidPort = true;
}

if (!rejectedInvalidPort) {
  throw new Error('Expected invalid PORT to be rejected');
}

let rejectedMissingOpenAiKey = false;
try {
  const { OPENAI_API_KEY: _ignored, ...missingOpenAiKey } = validEnvironment;
  parseEnv(missingOpenAiKey);
} catch {
  rejectedMissingOpenAiKey = true;
}

if (!rejectedMissingOpenAiKey) {
  throw new Error('Expected missing OPENAI_API_KEY to be rejected');
}

console.log('Environment configuration checks passed');
