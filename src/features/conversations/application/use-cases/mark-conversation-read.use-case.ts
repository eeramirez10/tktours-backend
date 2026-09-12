import { NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import { conversationRealtimeHub } from '../../infrastructure/realtime/conversation-realtime-hub.js';

export class MarkConversationReadUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  async execute(conversationId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true },
    });
    if (!conversation) {
      throw new NotFoundAppError('Conversation not found');
    }

    const result = await prisma.message.updateMany({
      where: {
        conversationId,
        direction: 'INBOUND',
        readByAdminAt: null,
      },
      data: { readByAdminAt: new Date() },
    });

    if (result.count > 0) {
      conversationRealtimeHub.publish({
        type: 'conversation.read.changed',
        conversationId,
      });
    }

    const updated = await this.conversationRepository.findById(conversationId);
    if (!updated) {
      throw new NotFoundAppError('Conversation not found');
    }
    return updated;
  }
}
