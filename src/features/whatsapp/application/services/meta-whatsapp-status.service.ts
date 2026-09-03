import { Prisma } from '@prisma/client';

import { logger } from '../../../../shared/config/logger.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

function toNullableJsonInput(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export type MetaWhatsAppStatusPayload = {
  id: string;
  status: string;
  timestamp: string;
  recipientId?: string;
  errors?: unknown[];
};

export class MetaWhatsAppStatusService {
  async processStatusCallback(payload: MetaWhatsAppStatusPayload): Promise<void> {
    const messageId = payload.id.trim();
    if (!messageId) {
      return;
    }

    const directMatch = await prisma.message.findFirst({
      where: { providerMessageId: messageId },
      select: { id: true, metadata: true },
    });

    if (directMatch) {
      await prisma.message.update({
        where: { id: directMatch.id },
        data: {
          metadata: toNullableJsonInput({
            ...((directMatch.metadata as Record<string, unknown> | null) ?? {}),
            transport: 'meta-whatsapp-cloud',
            metaStatusCallbackAt: new Date().toISOString(),
            metaStatus: payload.status,
            metaRecipientId: payload.recipientId ?? null,
            metaErrors: payload.errors ?? [],
          }),
        },
      });
      return;
    }

    const recentOutbound = await prisma.message.findMany({
      where: { direction: 'OUTBOUND' },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      select: { id: true, metadata: true },
    });

    const matched = recentOutbound.find((message) => {
      const metadata = message.metadata as Record<string, unknown> | null;
      return Boolean(metadata && Array.isArray(metadata.metaMediaMessageIds) && metadata.metaMediaMessageIds.includes(messageId));
    });

    if (!matched) {
      logger.warn({ messageId, status: payload.status }, 'meta whatsapp status callback did not match an outbound message');
      return;
    }

    const metadata = (matched.metadata as Record<string, unknown> | null) ?? {};
    const mediaMessageIds = Array.isArray(metadata.metaMediaMessageIds) ? metadata.metaMediaMessageIds : [];
    const mediaStatuses = Array.isArray(metadata.metaMediaStatuses) ? [...metadata.metaMediaStatuses] : [];
    const matchIndex = mediaMessageIds.findIndex((value) => value === messageId);
    if (matchIndex >= 0) {
      mediaStatuses[matchIndex] = payload.status;
    }

    await prisma.message.update({
      where: { id: matched.id },
      data: {
        metadata: toNullableJsonInput({
          ...metadata,
          transport: 'meta-whatsapp-cloud',
          metaMediaStatusCallbackAt: new Date().toISOString(),
          metaMediaStatus: matchIndex === 0 ? payload.status : metadata.metaMediaStatus ?? null,
          metaMediaStatuses: mediaStatuses,
          metaRecipientId: payload.recipientId ?? null,
          metaErrors: payload.errors ?? [],
        }),
      },
    });
  }
}
