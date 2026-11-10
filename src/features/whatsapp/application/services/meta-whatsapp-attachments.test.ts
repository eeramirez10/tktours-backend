import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { ResourceDeliveryGuardService } from '../../../resources/application/services/resource-delivery-guard.service.js';
import { MetaWhatsAppInboundService } from './meta-whatsapp-inbound.service.js';

test('legacy message URLs are resolved to named attachments and persisted independently', async (t) => {
  const originals = { find: prisma.conversation.findUniqueOrThrow, update: prisma.message.update, guard: ResourceDeliveryGuardService.prototype.prepareDelivery };
  t.after(() => { prisma.conversation.findUniqueOrThrow = originals.find; prisma.message.update = originals.update; ResourceDeliveryGuardService.prototype.prepareDelivery = originals.guard; });
  const urls = ['https://example.com/a/download', 'https://example.com/b/download'];
  const descriptors = urls.map((url, i) => ({ url, resourceId: `resource-${i}`, versionId: `version-${i}`, fileName: `Recurso ${i}.pdf`, resourceTitle: `Recurso ${i}`, mimeType: 'application/pdf' }));
  ResourceDeliveryGuardService.prototype.prepareDelivery = async () => ({ urls, versions: descriptors });
  prisma.conversation.findUniqueOrThrow = (async () => ({ id: 'conversation', controlMode: 'AI' })) as never;
  let saved: any;
  prisma.message.update = (async (args: unknown) => { saved = args; }) as never;
  const requests: any[] = [];
  const service = new MetaWhatsAppInboundService({ runTurn: async () => ({
    context: { activeInquiry: null }, modelResponse: { structured: { replyText: 'Folletos' } },
    persistedConversation: { messages: [{ id: 'outbound', direction: 'OUTBOUND', mediaUrl: urls[0], metadata: { mediaUrls: urls } }] },
  }) } as never, undefined, undefined, { sendMessage: async (args: unknown) => { requests.push(args); return { messageId: `provider-${requests.length}`, status: 'ACCEPTED' }; } } as never);
  await service.processPersistedMessage({ conversationId: 'conversation', messageId: 'incoming', recipientWaId: '525555000001' });
  assert.equal(requests[0].body, 'Folletos');
  assert.deepEqual(requests.slice(1).map(({ mediaUrl, fileName }) => ({ mediaUrl, fileName })), urls.map((mediaUrl, i) => ({ mediaUrl, fileName: `Recurso ${i}.pdf` })));
  assert.deepEqual(saved.data.metadata.attachments, descriptors);
});
