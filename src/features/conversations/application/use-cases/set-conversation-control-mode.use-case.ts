import { ConflictAppError, NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import type { SetConversationControlModeInput } from '../../domain/types/conversation.types.js';
import { conversationRealtimeHub } from '../../infrastructure/realtime/conversation-realtime-hub.js';

export class SetConversationControlModeUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  async execute(input: SetConversationControlModeInput) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        id: true,
        controlMode: true,
        _count: {
          select: {
            conciergeTurns: { where: { status: 'STARTED' } },
          },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundAppError('Conversation not found');
    }

    if (conversation.controlMode !== input.controlMode) {
      if (input.controlMode === 'HUMAN' && conversation._count.conciergeTurns > 0) {
        throw new ConflictAppError('Wait for the concierge response before taking control');
      }

      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: { controlMode: input.controlMode },
        select: { id: true },
      });

      conversationRealtimeHub.publish({
        type: 'conversation.control.changed',
        conversationId: input.conversationId,
      });
    }

    const updated = await this.conversationRepository.findById(input.conversationId);
    if (!updated) {
      throw new NotFoundAppError('Conversation not found');
    }
    return updated;
  }
}
