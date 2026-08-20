import { Prisma } from '@prisma/client';

import { logger } from '../../../../shared/config/logger.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

function toNullableJsonInput(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export type TwilioWhatsAppStatusPayload = {
  MessageSid: string;
  MessageStatus?: string;
  SmsStatus?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
};

export class TwilioWhatsAppStatusService {
  async processStatusCallback(payload: TwilioWhatsAppStatusPayload): Promise<void> {
    const status = payload.MessageStatus?.trim() || payload.SmsStatus?.trim() || null;
    const sid = payload.MessageSid.trim();
    if (!sid) {
      return;
    }

    const directMatch = await prisma.message.findFirst({
      where: { providerMessageId: sid },
      select: { id: true, metadata: true },
    });

    if (directMatch) {
      await prisma.message.update({
        where: { id: directMatch.id },
        data: {
          metadata: toNullableJsonInput({
            ...(directMatch.metadata as Record<string, unknown> | null ?? {}),
            transport: 'twilio',
            twilioStatusCallbackAt: new Date().toISOString(),
            twilioStatus: status,
            twilioErrorCode: payload.ErrorCode?.trim() || null,
            twilioErrorMessage: payload.ErrorMessage?.trim() || null,
          }),
        },
      });
      return;
    }

    const recentOutbound = await prisma.message.findMany({
      where: { direction: 'OUTBOUND' },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        metadata: true,
      },
    });

    const matched = recentOutbound.find((message) => {
      const metadata = message.metadata as Record<string, unknown> | null;
      if (!metadata || typeof metadata !== 'object') return false;
      if (metadata.mediaTwilioSid === sid) return true;
      return Array.isArray(metadata.mediaTwilioSids) && metadata.mediaTwilioSids.some((value) => value === sid);
    });

    if (!matched) {
      logger.warn({ sid, status }, 'twilio status callback did not match any outbound message');
      return;
    }

    const metadata = (matched.metadata as Record<string, unknown> | null) ?? {};
    const mediaTwilioSids = Array.isArray(metadata.mediaTwilioSids) ? metadata.mediaTwilioSids : [];
    const existingStatuses = Array.isArray(metadata.mediaTwilioStatuses) ? [...metadata.mediaTwilioStatuses] : [];
    const matchIndex = mediaTwilioSids.findIndex((value) => value === sid);
    if (matchIndex >= 0) {
      existingStatuses[matchIndex] = status;
    }

    await prisma.message.update({
      where: { id: matched.id },
      data: {
        metadata: toNullableJsonInput({
          ...metadata,
          transport: 'twilio',
          mediaTwilioStatusCallbackAt: new Date().toISOString(),
          mediaTwilioStatus: matchIndex === 0 ? status : metadata.mediaTwilioStatus ?? null,
          mediaTwilioStatuses: existingStatuses,
          twilioErrorCode: payload.ErrorCode?.trim() || null,
          twilioErrorMessage: payload.ErrorMessage?.trim() || null,
        }),
      },
    });
  }
}
