import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { ConciergeOrchestratorService } from '../../../concierge/application/services/concierge-orchestrator.service.js';
import { env } from '../../../../shared/config/env.js';
import { logger } from '../../../../shared/config/logger.js';
import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { MetaWhatsAppWebhookBody } from '../../presentation/http/schemas/meta-whatsapp-webhook.schemas.js';
import { WhatsappConversationThreadService } from './whatsapp-conversation-thread.service.js';
import { MetaWhatsAppStatusService } from './meta-whatsapp-status.service.js';

const metaMessagesValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().trim().min(1),
  }),
  contacts: z.array(
    z.object({
      wa_id: z.string().trim().min(1),
      profile: z.object({ name: z.string().trim().min(1).optional() }).optional(),
    }),
  ).optional(),
  messages: z.array(
    z.object({
      from: z.string().trim().min(1),
      id: z.string().trim().min(1),
      timestamp: z.string().trim().min(1),
      type: z.string().trim().min(1),
      text: z.object({ body: z.string() }).optional(),
    }).passthrough(),
  ).optional(),
  statuses: z.array(
    z.object({
      id: z.string().trim().min(1),
      status: z.string().trim().min(1),
      timestamp: z.string().trim().min(1),
      recipient_id: z.string().trim().min(1).optional(),
      errors: z.array(z.unknown()).optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

type MetaMessagesValue = z.infer<typeof metaMessagesValueSchema>;

function toNullableJsonInput(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function normalizePhoneNumber(value: string): string {
  const normalized = value.replace(/\D/g, '');
  if (normalized.length < 8 || normalized.length > 15) {
    throw new ValidationAppError('Invalid WhatsApp phone number');
  }
  return normalized;
}

function getDocumentFilename(url: string): string | undefined {
  try {
    const filename = new URL(url).pathname.split('/').pop()?.trim();
    return filename && filename.length > 0 ? filename : undefined;
  } catch {
    return undefined;
  }
}

export class MetaWhatsAppInboundService {
  constructor(
    private readonly concierge = new ConciergeOrchestratorService(),
    private readonly threadService = new WhatsappConversationThreadService(),
    private readonly statusService = new MetaWhatsAppStatusService(),
  ) {}

  async processWebhook(payload: MetaWhatsAppWebhookBody): Promise<void> {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') {
          continue;
        }

        const parsedValue = metaMessagesValueSchema.safeParse(change.value);
        if (!parsedValue.success) {
          logger.warn({ issues: parsedValue.error.flatten() }, 'ignored unsupported Meta WhatsApp webhook payload');
          continue;
        }

        await this.processMessagesValue(parsedValue.data);
      }
    }
  }

  private async processMessagesValue(value: MetaMessagesValue): Promise<void> {
    const contactNames = new Map(
      (value.contacts ?? []).map((contact) => [contact.wa_id, contact.profile?.name?.trim() || null]),
    );

    for (const status of value.statuses ?? []) {
      await this.statusService.processStatusCallback({
        id: status.id,
        status: status.status,
        timestamp: status.timestamp,
        recipientId: status.recipient_id,
        errors: status.errors,
      });
    }

    for (const message of value.messages ?? []) {
      await this.processInboundMessage({
        providerMessageId: message.id,
        from: message.from,
        profileName: contactNames.get(message.from) ?? null,
        bodyText: message.type === 'text' ? message.text?.body?.trim() || '[sin texto]' : `[mensaje ${message.type}]`,
        messageType: message.type,
        phoneNumberId: value.metadata.phone_number_id,
      });
    }
  }

  private async processInboundMessage(params: {
    providerMessageId: string;
    from: string;
    profileName: string | null;
    bodyText: string;
    messageType: string;
    phoneNumberId: string;
  }): Promise<void> {
    const waId = normalizePhoneNumber(params.from);
    const contact = await prisma.contact.upsert({
      where: { waId },
      update: {
        ...(params.profileName ? { firstName: params.profileName } : {}),
      },
      create: {
        waId,
        firstName: params.profileName,
      },
      select: { id: true },
    });

    const conversation = await this.threadService.getOrCreateThread(contact.id);
    const inboundMessage = await this.createInboundMessage({
      conversationId: conversation.id,
      providerMessageId: params.providerMessageId,
      text: params.bodyText,
      metadata: {
        source: 'meta-whatsapp-webhook',
        rawFrom: params.from,
        messageType: params.messageType,
        phoneNumberId: params.phoneNumberId,
      },
    });

    if (!inboundMessage) {
      logger.info({ messageId: params.providerMessageId }, 'meta whatsapp inbound duplicate ignored');
      return;
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: inboundMessage.createdAt },
    });

    await this.ensureOpenInquiry(conversation.id, contact.id);

    const turn = await this.concierge.runTurn({
      conversationId: conversation.id,
      incomingMessageId: inboundMessage.id,
    });

    const replyText = turn.modelResponse.structured.replyText.trim();
    if (!replyText) {
      return;
    }

    const outboundMessage =
      [...turn.persistedConversation.messages].reverse().find((message) => message.direction === 'OUTBOUND') ?? null;
    const textResult = await this.sendWhatsAppMessage({ to: waId, body: replyText });
    const mediaUrls = this.getOutboundMediaUrls(outboundMessage);
    const mediaResults = await Promise.all(
      mediaUrls.map(async (mediaUrl) => {
        try {
          return await this.sendWhatsAppMessage({ to: waId, mediaUrl });
        } catch (error) {
          logger.error({ error, mediaUrl, messageId: outboundMessage?.id }, 'meta whatsapp document request failed');
          return { messageId: null, status: 'FAILED_TO_REQUEST' };
        }
      }),
    );

    if (!outboundMessage || !textResult.messageId) {
      return;
    }

    await prisma.message.update({
      where: { id: outboundMessage.id },
      data: {
        providerMessageId: textResult.messageId,
        metadata: toNullableJsonInput({
          ...((outboundMessage.metadata as Record<string, unknown> | null) ?? {}),
          transport: 'meta-whatsapp-cloud',
          metaStatus: textResult.status,
          metaMediaMessageIds: mediaResults.map((result) => result.messageId),
          metaMediaStatuses: mediaResults.map((result) => result.status),
          mediaUrls,
        }),
      },
    });
  }

  private getOutboundMediaUrls(outboundMessage: { mediaUrl: string | null; metadata: Record<string, unknown> | null } | null): string[] {
    const metadata = outboundMessage?.metadata;
    const metadataMediaUrls =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) && Array.isArray(metadata.mediaUrls)
        ? metadata.mediaUrls.filter((item): item is string => typeof item === 'string' && /^https?:\/\//i.test(item))
        : [];

    if (metadataMediaUrls.length > 0) {
      return metadataMediaUrls;
    }

    return outboundMessage?.mediaUrl && /^https?:\/\//i.test(outboundMessage.mediaUrl) ? [outboundMessage.mediaUrl] : [];
  }

  private async ensureOpenInquiry(conversationId: string, contactId: string): Promise<void> {
    const openInquiry = await prisma.inquiry.findFirst({
      where: { conversationId, status: { not: 'CLOSED' } },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (!openInquiry) {
      await prisma.inquiry.create({
        data: { conversationId, contactId, status: 'OPEN' },
        select: { id: true },
      });
    }
  }

  private async createInboundMessage(params: {
    conversationId: string;
    providerMessageId: string;
    text: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string; createdAt: Date } | null> {
    try {
      return await prisma.message.create({
        data: {
          conversationId: params.conversationId,
          direction: 'INBOUND',
          text: params.text,
          providerMessageId: params.providerMessageId,
          metadata: toNullableJsonInput(params.metadata),
        },
        select: { id: true, createdAt: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicated = await prisma.message.findFirst({
          where: { providerMessageId: params.providerMessageId },
          select: { id: true },
        });
        return duplicated ? null : Promise.reject(error);
      }
      throw error;
    }
  }

  private async sendWhatsAppMessage(params: {
    to: string;
    body?: string;
    mediaUrl?: string | null;
  }): Promise<{ messageId: string | null; status: string }> {
    const body = params.body?.trim();
    const mediaUrl = params.mediaUrl?.trim();
    if (!body && (!mediaUrl || !/^https?:\/\//i.test(mediaUrl))) {
      throw new ValidationAppError('Meta WhatsApp message requires text or a public document URL');
    }

    const payload = mediaUrl
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizePhoneNumber(params.to),
          type: 'document',
          document: {
            link: mediaUrl,
            ...(getDocumentFilename(mediaUrl) ? { filename: getDocumentFilename(mediaUrl) } : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizePhoneNumber(params.to),
          type: 'text',
          text: { preview_url: false, body },
        };

    const endpoint = `https://graph.facebook.com/${env.WHATSAPP_META_GRAPH_API_VERSION}/${env.WHATSAPP_META_PHONE_NUMBER_ID}/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      logger.error({ status: response.status, body: json }, 'meta whatsapp outbound request failed');
      throw new ValidationAppError('Meta WhatsApp outbound request failed', {
        status: response.status,
        response: json,
      });
    }

    const messages = Array.isArray(json.messages) ? json.messages : [];
    const firstMessage = messages[0] && typeof messages[0] === 'object' ? (messages[0] as Record<string, unknown>) : null;
    return {
      messageId: typeof firstMessage?.id === 'string' ? firstMessage.id : null,
      status: 'ACCEPTED',
    };
  }
}
