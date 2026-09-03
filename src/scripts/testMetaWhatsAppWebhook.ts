import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/tktours?schema=public',
  CORS_ORIGIN: 'http://localhost:5173',
  ADMIN_JWT_SECRET: 'a'.repeat(32),
  PUBLIC_BASE_URL: 'https://api.example.com',
  OPENAI_API_KEY: 'test-openai-key',
  WHATSAPP_META_ACCESS_TOKEN: 'test-meta-access-token',
  WHATSAPP_META_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_META_VERIFY_TOKEN: 'test-meta-verify-token-value',
  WHATSAPP_META_APP_SECRET: 'f'.repeat(32),
  WHATSAPP_META_GRAPH_API_VERSION: 'v24.0',
});

const { MetaWhatsAppController } = await import('../features/whatsapp/presentation/http/controllers/meta-whatsapp.controller.js');

type FakeResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeResponse;
  type: () => FakeResponse;
  send: (body: unknown) => FakeResponse;
  sendStatus: (code: number) => FakeResponse;
};

function createResponse(): FakeResponse {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      return this;
    },
  };
}

const controller = new MetaWhatsAppController();
const verificationResponse = createResponse();
controller.verifyWebhook(
  {
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': process.env.WHATSAPP_META_VERIFY_TOKEN,
      'hub.challenge': 'challenge-value',
    },
  } as never,
  verificationResponse as never,
);
assert.equal(verificationResponse.statusCode, 200);
assert.equal(verificationResponse.body, 'challenge-value');

const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
const signature = `sha256=${createHmac('sha256', process.env.WHATSAPP_META_APP_SECRET!).update(body).digest('hex')}`;
const inboundResponse = createResponse();
await controller.inboundWebhook(
  {
    rawBody: body,
    body: JSON.parse(body.toString()),
    get: (header: string) => (header.toLowerCase() === 'x-hub-signature-256' ? signature : undefined),
  } as never,
  inboundResponse as never,
  (error: unknown) => {
    throw error;
  },
);
assert.equal(inboundResponse.statusCode, 200);

const rejectedResponse = createResponse();
await controller.inboundWebhook(
  {
    rawBody: body,
    body: JSON.parse(body.toString()),
    get: () => 'sha256=invalid',
  } as never,
  rejectedResponse as never,
  (error: unknown) => {
    throw error;
  },
);
assert.equal(rejectedResponse.statusCode, 401);

console.log('Meta WhatsApp webhook checks passed');
