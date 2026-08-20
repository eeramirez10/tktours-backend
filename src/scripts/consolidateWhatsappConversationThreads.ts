import { prisma } from '../shared/infrastructure/database/prisma.js';
import { WhatsappConversationThreadService } from '../features/whatsapp/application/services/whatsapp-conversation-thread.service.js';

async function main() {
  const service = new WhatsappConversationThreadService();
  const result = await service.consolidateAllThreads();

  console.log('CONSOLIDATION_RESULT', JSON.stringify(result));

  const remainingDuplicates = await prisma.conversation.groupBy({
    by: ['contactId'],
    where: {
      contactId: { not: null },
      channel: 'WHATSAPP',
    },
    _count: { _all: true },
    having: {
      contactId: {
        _count: {
          gt: 1,
        },
      },
    },
  });

  console.log('REMAINING_DUPLICATE_GROUPS', JSON.stringify(remainingDuplicates));
}

main()
  .catch((error) => {
    console.error('CONSOLIDATE_WHATSAPP_THREADS_ERROR', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
