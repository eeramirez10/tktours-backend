import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { conversationRealtimeHub } from '../../infrastructure/realtime/conversation-realtime-hub.js';

export class MarkNotificationsSeenUseCase {
  async execute() {
    const conversations = await prisma.message.findMany({
      where: {
        direction: 'INBOUND',
        notificationSeenAt: null,
        conversation: { channel: 'WHATSAPP' },
      },
      distinct: ['conversationId'],
      select: { conversationId: true },
    });

    const result = await prisma.message.updateMany({
      where: {
        direction: 'INBOUND',
        notificationSeenAt: null,
        conversation: { channel: 'WHATSAPP' },
      },
      data: { notificationSeenAt: new Date() },
    });

    for (const conversation of conversations) {
      conversationRealtimeHub.publish({
        type: 'conversation.notifications.seen',
        conversationId: conversation.conversationId,
      });
    }

    return { updatedCount: result.count };
  }
}
