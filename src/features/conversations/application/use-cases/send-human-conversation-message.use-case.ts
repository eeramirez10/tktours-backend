import { Prisma } from '@prisma/client';

import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { MetaWhatsAppClient } from '../../../whatsapp/infrastructure/clients/meta-whatsapp.client.js';
import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import { conversationRealtimeHub } from '../../infrastructure/realtime/conversation-realtime-hub.js';

function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class SendHumanConversationMessageUseCase {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly whatsAppClient = new MetaWhatsAppClient(),
  ) {}

  async execute(input: {
    conversationId: string;
    text: string;
    admin: { id: string; email: string; name: string };
  }) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        id: true,
        channel: true,
        controlMode: true,
        contact: { select: { waId: true } },
      },
    });
    if (!conversation) {
      throw new NotFoundAppError('Conversation not found');
    }
    if (conversation.controlMode !== 'HUMAN') {
      throw new ConflictAppError('Take control of the conversation before sending a human message');
    }
    if (conversation.channel !== 'WHATSAPP' || !conversation.contact?.waId) {
      throw new ValidationAppError('Conversation does not have a WhatsApp recipient');
    }

    const pendingMetadata = {
      source: 'admin-chat-console',
      authorType: 'human',
      createdByAdminId: input.admin.id,
      createdByAdminEmail: input.admin.email,
      createdByAdminName: input.admin.name,
      transport: 'meta-whatsapp-cloud',
      metaStatus: 'PENDING',
    };
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          text: input.text,
          metadata: toJsonInput(pendingMetadata),
        },
        select: { id: true, createdAt: true },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: created.createdAt },
      });
      return created;
    });

    try {
      const result = await this.whatsAppClient.sendMessage({
        to: conversation.contact.waId,
        body: input.text,
      });
      await prisma.message.update({
        where: { id: message.id },
        data: {
          providerMessageId: result.messageId,
          metadata: toJsonInput({ ...pendingMetadata, metaStatus: result.status }),
        },
      });
    } catch (error) {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          metadata: toJsonInput({
            ...pendingMetadata,
            metaStatus: 'FAILED',
            failedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown Meta WhatsApp error',
          }),
        },
      });
      conversationRealtimeHub.publish({
        type: 'conversation.updated',
        conversationId: conversation.id,
        messageId: message.id,
      });
      throw error;
    }

    conversationRealtimeHub.publish({
      type: 'conversation.updated',
      conversationId: conversation.id,
      messageId: message.id,
    });

    const updated = await this.conversationRepository.findById(conversation.id);
    if (!updated) {
      throw new NotFoundAppError('Conversation not found');
    }
    return updated;
  }
}
