import { NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { conversationRealtimeHub } from '../../infrastructure/realtime/conversation-realtime-hub.js';

export class DeleteConversationUseCase {
  async execute(conversationId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, contactId: true },
      });
      if (!conversation) {
        throw new NotFoundAppError('Conversation not found');
      }

      await tx.conversation.delete({ where: { id: conversationId } });

      let contactDeleted = false;
      if (conversation.contactId) {
        const contact = await tx.contact.findUnique({
          where: { id: conversation.contactId },
          select: {
            _count: {
              select: { conversations: true, inquiries: true },
            },
          },
        });

        if (contact && contact._count.conversations === 0 && contact._count.inquiries === 0) {
          await tx.contact.delete({ where: { id: conversation.contactId } });
          contactDeleted = true;
        }
      }

      return { conversationId, contactDeleted };
    });

    conversationRealtimeHub.publish({
      type: 'conversation.deleted',
      conversationId,
    });

    return result;
  }
}
