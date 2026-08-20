import assert from 'node:assert/strict';

import { prisma } from '../shared/infrastructure/database/prisma.js';
import { TwilioWhatsAppStatusService } from '../features/whatsapp/application/services/twilio-whatsapp-status.service.js';

async function main() {
  const source = `twilio-status-test-${Date.now()}`;
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
      providerMessageId: `SM-test-${Date.now()}`,
      mediaUrl: 'https://example.com/file.pdf',
      metadata: {
        source,
        mediaTwilioSid: 'MM-test-primary',
        mediaTwilioSids: ['MM-test-primary', 'MM-test-secondary'],
        mediaTwilioStatuses: ['queued', 'queued'],
      },
    },
    select: { id: true, providerMessageId: true },
  });

  const service = new TwilioWhatsAppStatusService();

  try {
    await service.processStatusCallback({
      MessageSid: message.providerMessageId!,
      MessageStatus: 'delivered',
    });

    await service.processStatusCallback({
      MessageSid: 'MM-test-secondary',
      MessageStatus: 'failed',
      ErrorCode: '63019',
      ErrorMessage: 'Unable to fetch media',
    });

    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: message.id },
      select: { metadata: true },
    });

    const metadata = (stored.metadata as Record<string, unknown> | null) ?? {};
    const mediaStatuses = Array.isArray(metadata.mediaTwilioStatuses) ? metadata.mediaTwilioStatuses : [];
    assert.equal(metadata.twilioStatus, 'delivered');
    assert.equal(mediaStatuses[1], 'failed');
    assert.equal(metadata.twilioErrorCode, '63019');

    console.log('OK: twilio status callback test passed');
    console.log(`conversationId=${conversation.id}`);
  } finally {
    await prisma.conversation.delete({ where: { id: conversation.id } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL: twilio status callback test failed');
  console.error(error);
  process.exitCode = 1;
});
