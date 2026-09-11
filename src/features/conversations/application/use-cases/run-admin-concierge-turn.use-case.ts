import { Prisma } from '@prisma/client';

import { ConciergeOrchestratorService } from '../../../concierge/application/services/concierge-orchestrator.service.js';
import { NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { PrismaConversationRepository } from '../../infrastructure/repositories/prisma-conversation.repository.js';

function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class RunAdminConciergeTurnUseCase {
  constructor(
    private readonly conversationRepository = new PrismaConversationRepository(),
    private readonly concierge = new ConciergeOrchestratorService(),
  ) {}

  async execute(input: { conversationId: string; text: string; admin: { id: string; email: string } }) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, contactId: true },
    });
    if (!conversation) {
      throw new NotFoundAppError('Conversation not found');
    }

    const inboundMessage = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'INBOUND',
          text: input.text,
          metadata: toJsonInput({
            source: 'admin-chat-console',
            createdByAdminId: input.admin.id,
            createdByAdminEmail: input.admin.email,
          }),
        },
        select: { id: true, createdAt: true },
      });

      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });

      if (conversation.contactId) {
        const openInquiry = await tx.inquiry.findFirst({
          where: { conversationId: conversation.id, status: { not: 'CLOSED' } },
          select: { id: true },
          orderBy: { updatedAt: 'desc' },
        });
        if (!openInquiry) {
          await tx.inquiry.create({
            data: { conversationId: conversation.id, contactId: conversation.contactId, status: 'OPEN' },
          });
        }
      }

      return message;
    });

    await this.concierge.runTurn({
      conversationId: conversation.id,
      incomingMessageId: inboundMessage.id,
    });

    const updatedConversation = await this.conversationRepository.findById(conversation.id);
    if (!updatedConversation) {
      throw new NotFoundAppError('Conversation not found');
    }

    return updatedConversation;
  }
}
