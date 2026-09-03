import assert from 'node:assert/strict';

import { prisma } from '../shared/infrastructure/database/prisma.js';
import { MetaWhatsAppStatusService } from '../features/whatsapp/application/services/meta-whatsapp-status.service.js';

async function main() {
  const source = `meta-whatsapp-status-test-${Date.now()}`;
  const conversation = await prisma.conversation.create({
    data: {
      channel: 'WHATSAPP',
      status: 'OPEN',
      currentStage: 'SEND_RESOURCE',
      contextJson: { source },
    },
    select: { id: true },
  });

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      text: 'Mensaje de prueba',
      providerMessageId: `wamid.test.${Date.now()}`,
      mediaUrl: 'https://example.com/file.pdf',
      metadata: {
        source,
        metaMediaMessageIds: ['wamid.test.primary', 'wamid.test.secondary'],
        metaMediaStatuses: ['sent', 'sent'],
      },
    },
    select: { id: true, providerMessageId: true },
  });

  const service = new MetaWhatsAppStatusService();

  try {
    await service.processStatusCallback({
      id: message.providerMessageId!,
      status: 'delivered',
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

    await service.processStatusCallback({
      id: 'wamid.test.secondary',
      status: 'failed',
      timestamp: String(Math.floor(Date.now() / 1000)),
      errors: [{ code: 131026, title: 'Message undeliverable' }],
    });

    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
      select: { metadata: true },
    });

    const metadata = (stored.metadata as Record<string, unknown> | null) ?? {};
    const mediaStatuses = Array.isArray(metadata.metaMediaStatuses) ? metadata.metaMediaStatuses : [];
    assert.equal(metadata.metaStatus, 'delivered');
    assert.equal(mediaStatuses[1], 'failed');
    assert.deepEqual(metadata.metaErrors, [{ code: 131026, title: 'Message undeliverable' }]);

    console.log('OK: Meta WhatsApp status callback test passed');
    console.log(`conversationId=${conversation.id}`);
  } finally {
    await prisma.conversation.delete({ where: { id: conversation.id } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL: Meta WhatsApp status callback test failed');
  console.error(error);
  process.exitCode = 1;
});
