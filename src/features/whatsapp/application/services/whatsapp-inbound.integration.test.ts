import { ConciergeOrchestratorService } from '../../../concierge/application/services/concierge-orchestrator.service.js';
import { interpretation } from '../../../../scripts/fixtures/concierge-interpretation.js';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { env } from '../../../../shared/config/env.js';
import { conversationRealtimeHub } from '../../../conversations/infrastructure/realtime/conversation-realtime-hub.js';
import { MetaWhatsAppController } from '../../presentation/http/controllers/meta-whatsapp.controller.js';
import { MetaWhatsAppInboundService } from './meta-whatsapp-inbound.service.js';
import { WhatsAppInboxWorker } from './whatsapp-inbox-worker.service.js';

// Run only against an explicitly provisioned disposable local PostgreSQL database.
const integration = process.env.INBOX_INTEGRATION_TEST === '1';
if (integration) {
  const url = new URL(env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Use an isolated local *_test database');
}

function payload(id: string, text = 'Alex Meine') {
  return { object: 'whatsapp_business_account' as const, entry: [{ id: 'business', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: '123456789' },
    messages: [{ id, from: '525555000001', timestamp: '1794350000', type: 'text', text: { body: text } }],
  } }] }] };
}

function response() {
  return { statusCode: 0, sendStatus(code: number) { this.statusCode = code; return this; } };
}
function request(body: unknown) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = `sha256=${createHmac('sha256', env.WHATSAPP_META_APP_SECRET).update(rawBody).digest('hex')}`;
  return { body, rawBody, get: () => signature };
}

test('durable reception, deduplication, retries, worker ordering and restart', { skip: !integration }, async (t) => {
  const originalPublish = conversationRealtimeHub.publish;
  const received: string[] = [];
  conversationRealtimeHub.publish = (event) => { if (event.type === 'conversation.message.received') received.push(event.messageId!); };
  t.after(async () => {
    conversationRealtimeHub.publish = originalPublish;
    const contact = await prisma.contact.findUnique({ where: { waId: '525555000001' } });
    if (contact) {
      await prisma.conversation.deleteMany({ where: { contactId: contact.id } });
      await prisma.contact.delete({ where: { id: contact.id } });
    }
    await prisma.$disconnect();
  });
  const concierge = new ConciergeOrchestratorService(undefined, undefined, {
    getModel: () => 'fake', createTextResponse: async () => { throw new Error('AI unavailable after interpretation'); },
  } as never, { execute: async (name: string, args: { latestMessage?: string }) => {
    if (name === 'list_available_course_types') return { courseTypes: [{ familyKey: 'CAMP', name: 'Campamentos / viajes', programCount: 1, brochureCount: 0 }] };
    if (name === 'list_available_locations') return { locations: [] };
    if (name === 'list_available_programs') return { programs: [] };
    assert.equal(name, 'interpret_message');
    return interpretation(args.latestMessage === 'Alex Meine' ? { firstName: 'Alex', lastName: 'Meine' } : { intent: 'GREETING' });
  } } as never);
  const service = new MetaWhatsAppInboundService(concierge);
  const controller = new MetaWhatsAppController(service);
  const ack = response();
  await controller.inboundWebhook(request(payload('provider-first')) as never, ack as never, (error) => { throw error; });
  assert.equal(ack.statusCode, 200);
  const first = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: 'provider-first' } });
  assert.equal(first.text, 'Alex Meine');
  assert.deepEqual(received, [first.id]);
  assert.equal(await prisma.whatsAppInboundJob.count({ where: { messageId: first.id, status: 'PENDING' } }), 1);

  await Promise.all([service.processWebhook(payload('provider-first')), new MetaWhatsAppInboundService().processWebhook(payload('provider-first'))]);
  assert.equal(await prisma.message.count({ where: { providerMessageId: 'provider-first' } }), 1);
  assert.equal(received.length, 1);

  // A failed transaction must not acknowledge, even if the contact/thread already exists.
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = (async () => { throw new Error('Persistence unavailable'); }) as never;
  const failedAck = response();
  let persistenceError: unknown;
  try {
    await controller.inboundWebhook(request(payload('provider-retry')) as never, failedAck as never, (error) => { persistenceError = error; });
  } finally { prisma.$transaction = originalTransaction; }
  assert.match(String(persistenceError), /Persistence unavailable/);
  assert.equal(failedAck.statusCode, 0);
  assert.equal(await prisma.message.count({ where: { providerMessageId: 'provider-retry' } }), 0);
  await service.processWebhook(payload('provider-retry', 'Hola?'));

  // Failed job creation rolls the message back too; a provider retry can persist it again.
  const fakeService = new MetaWhatsAppInboundService(undefined, { getOrCreateThread: async () => ({ id: first.conversationId, controlMode: 'AI' }) } as never);
  prisma.$transaction = ((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => originalTransaction.call(prisma, (tx: Prisma.TransactionClient) => fn(new Proxy(tx, {
    get: (target, key) => key === 'whatsAppInboundJob' ? { create: async () => { throw new Error('Inbox insert failed'); } } : Reflect.get(target, key),
  }))) as never) as never;
  try {
    await assert.rejects(fakeService.processWebhook(payload('provider-rollback')), /Inbox insert failed/);
  } finally { prisma.$transaction = originalTransaction; }
  assert.equal(await prisma.message.count({ where: { providerMessageId: 'provider-rollback' } }), 0);
  await fakeService.processWebhook(payload('provider-rollback'));

  // The database survives service reconstruction. AI failure does not remove the inbound text.
  const failedWorker = new WhatsAppInboxWorker(service);
  await failedWorker.tick();
  assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: first.id } })).text, 'Alex Meine');
  assert.equal((await prisma.whatsAppInboundJob.findUniqueOrThrow({ where: { messageId: first.id } })).status, 'FAILED');
  const savedContact = await prisma.contact.findUniqueOrThrow({ where: { waId: '525555000001' } });
  assert.deepEqual([savedContact.firstName, savedContact.lastName], ['Alex', 'Meine']);

  // Independent worker instances must claim the same conversation in provider receipt order.
  await service.processWebhook(payload('provider-order-1'));
  await service.processWebhook(payload('provider-order-2'));
  const ids = await prisma.message.findMany({ where: { providerMessageId: { in: ['provider-order-1', 'provider-order-2'] } }, orderBy: { createdAt: 'asc' } });
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const order: string[] = [];
  const processor = { processPersistedMessage: async (job: { messageId: string }) => {
    order.push(job.messageId);
    if (order.length === 1) { started(); await gate; }
  } };
  const worker = new WhatsAppInboxWorker(processor as never);
  const draining = worker.tick();
  await ready;
  await new WhatsAppInboxWorker(processor as never).tick();
  assert.deepEqual(order, [ids[0].id]);
  release();
  await draining;
  assert.deepEqual(order, ids.map((message) => message.id));
  assert.equal(await prisma.whatsAppInboundJob.count({ where: { messageId: { in: ids.map((message) => message.id) }, status: 'COMPLETED' } }), 2);
  const history = await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversationId }, include: { messages: true, inquiries: true } });
  assert.equal(history.messages.length, 5);
  assert.equal(history.inquiries.length, 1);
  await prisma.inquiry.update({ where: { id: history.inquiries[0].id }, data: { status: 'CLOSED', weeks: 4 } });
  await prisma.conversation.update({ where: { id: first.conversationId }, data: { status: 'CLOSED', currentStage: 'CLOSED', contextJson: { openaiResponses: { lastResponseId: 'preserved-response' } } } });
  await new MetaWhatsAppInboundService().processWebhook(payload('provider-after-close', 'Hola?'));
  const reopened = await prisma.conversation.findUniqueOrThrow({ where: { id: first.conversationId }, include: { inquiries: true, messages: true } });
  assert.equal(reopened.inquiries.length, 1);
  assert.equal(reopened.inquiries[0].weeks, 4);
  assert.equal(reopened.inquiries[0].status, 'WAITING_HUMAN');
  assert.equal((reopened.contextJson as { openaiResponses: { lastResponseId: string } }).openaiResponses.lastResponseId, 'preserved-response');
  assert.equal(reopened.messages.length, 6);
  // Only an explicit AI-interpreted restart replaces the inquiry; history and response chain stay visible.
  await service.processWebhook(payload('provider-restart', 'Quiero empezar de nuevo'));
  const restartMessage = await prisma.message.findUniqueOrThrow({ where: { providerMessageId: 'provider-restart' } });
  const restarting = new ConciergeOrchestratorService(undefined, undefined, {
    getModel: () => 'fake', createTextResponse: async (args: { previousResponseId?: string }) => {
      assert.equal(args.previousResponseId, 'preserved-response');
      return { id: 'response-after-restart', raw: { output: [] }, outputText: JSON.stringify({
        replyText: 'Continuamos', shouldAskFollowUp: false, detectedNeed: 'UNKNOWN', missingFields: [], nextStage: 'START', shouldRefreshRecommendations: false,
      }) };
    },
  } as never, { execute: async (name: string) => {
    if (name === 'list_available_course_types') return { courseTypes: [{ familyKey: 'CAMP', name: 'Campamentos / viajes', programCount: 1, brochureCount: 0 }] };
    if (name === 'list_available_locations') return { locations: [] };
    if (name === 'list_available_programs') return { programs: [] };
    return interpretation({ intent: 'RESTART' });
  } } as never);
  const restarted = await restarting.runTurn({ conversationId: first.conversationId, incomingMessageId: restartMessage.id });
  assert.equal(restarted.context.activeInquiry?.weeks, null);
  assert.equal(restarted.persistedConversation.messages.length, 8);
  assert.doesNotMatch(restarted.modelResponse.structured.replyText, /Qué gusto recibirte/);
  const oldInquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: history.inquiries[0].id } });
  assert.equal(oldInquiry.status, 'CLOSED');
  assert.equal(oldInquiry.weeks, 4);
  assert.equal(await prisma.inquiry.count({ where: { conversationId: first.conversationId } }), 2);


});
