import { KeyedTaskQueue } from '../../../../shared/application/keyed-task-queue.js';
import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { ResourceSendHistoryService } from '../../../resources/application/services/resource-send-history.service.js';
import { ResourceDeliveryGuardService } from '../../../resources/application/services/resource-delivery-guard.service.js';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { conversationRealtimeHub } from '../../../conversations/infrastructure/realtime/conversation-realtime-hub.js';
import { ConciergeOrchestratorService } from '../../../concierge/application/services/concierge-orchestrator.service.js';
import { logger } from '../../../../shared/config/logger.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { MetaWhatsAppClient, normalizeWhatsAppPhoneNumber } from '../../infrastructure/clients/meta-whatsapp.client.js';
import type { MetaWhatsAppWebhookBody } from '../../presentation/http/schemas/meta-whatsapp-webhook.schemas.js';
import { WhatsappConversationThreadService } from './whatsapp-conversation-thread.service.js';
import { MetaWhatsAppStatusService } from './meta-whatsapp-status.service.js';

const inboundMessageSchema = z.object({
  from: z.string().trim().min(1),
  id: z.string().trim().min(1),
  timestamp: z.string().trim().min(1),
  type: z.string().trim().min(1),
  text: z.object({ body: z.string() }).optional(),
}).passthrough();

const statusCallbackSchema = z.object({
  id: z.string().trim().min(1),
  status: z.string().trim().min(1),
  timestamp: z.string().trim().min(1),
  recipient_id: z.string().trim().min(1).optional(),
  errors: z.array(z.unknown()).optional(),
}).passthrough();

const contactSchema = z.object({
  wa_id: z.string().trim().min(1),
  profile: z.object({ name: z.string().optional() }).optional(),
});

const metaMessagesValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().trim().min(1),
  }),
  contacts: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.unknown()).optional(),
}).passthrough();

const inboundPersistenceQueue = new KeyedTaskQueue();

type MetaMessagesValue = z.infer<typeof metaMessagesValueSchema>;

function toNullableJsonInput(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export class MetaWhatsAppInboundService {
  constructor(
    private readonly concierge = new ConciergeOrchestratorService(),
    private readonly threadService = new WhatsappConversationThreadService(),
    private readonly statusService = new MetaWhatsAppStatusService(),
    private readonly whatsAppClient = new MetaWhatsAppClient(),
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
    const contactNames = new Map<string, string | null>();
    for (const rawContact of value.contacts ?? []) {
      const contact = contactSchema.safeParse(rawContact);
      if (contact.success) contactNames.set(contact.data.wa_id, contact.data.profile?.name?.trim() || null);
    }

    for (const rawMessage of value.messages ?? []) {
      const parsedMessage = inboundMessageSchema.safeParse(rawMessage);
      if (!parsedMessage.success) {
        logger.warn({ issues: parsedMessage.error.flatten() }, 'ignored invalid Meta WhatsApp message');
        continue;
      }
      const message = parsedMessage.data;
      await inboundPersistenceQueue.run(message.from, () => this.persistInboundMessage({
        providerMessageId: message.id,
        providerTimestamp: message.timestamp,
        from: message.from,
        profileName: contactNames.get(message.from) ?? null,
        bodyText: message.type === 'text' ? message.text?.body?.trim() || '[sin texto]' : `[mensaje ${message.type}]`,
        messageType: message.type,
        phoneNumberId: value.metadata.phone_number_id,
      }));
    }

    for (const rawStatus of value.statuses ?? []) {
      const parsedStatus = statusCallbackSchema.safeParse(rawStatus);
      if (!parsedStatus.success) {
        logger.warn({ issues: parsedStatus.error.flatten() }, 'ignored invalid Meta WhatsApp status callback');
        continue;
      }
      const status = parsedStatus.data;
      await this.statusService.processStatusCallback({
        id: status.id,
        status: status.status,
        timestamp: status.timestamp,
        recipientId: status.recipient_id,
        errors: status.errors,
      });
    }
  }

  private async persistInboundMessage(params: {
    providerMessageId: string;
    providerTimestamp: string;
    from: string;
    profileName: string | null;
    bodyText: string;
    messageType: string;
    phoneNumberId: string;
  }): Promise<void> {
    const waId = normalizeWhatsAppPhoneNumber(params.from);
    const contact = await prisma.contact.upsert({
      where: { waId },
      update: {},
      create: { waId },
      select: { id: true },
    });

    const conversation = await this.threadService.getOrCreateThread(contact.id);
    const inboundMessage = await this.createInboundMessage({
      conversationId: conversation.id,
      contactId: contact.id,
      providerMessageId: params.providerMessageId,
      recipientWaId: waId,
      processWithAi: conversation.controlMode === 'AI',
      text: params.bodyText,
      metadata: {
        source: 'meta-whatsapp-webhook', rawFrom: params.from, profileName: params.profileName,
        messageType: params.messageType, phoneNumberId: params.phoneNumberId, providerTimestamp: params.providerTimestamp,
      },
    });
    if (!inboundMessage) {
      logger.info({ messageId: params.providerMessageId }, 'meta whatsapp inbound duplicate ignored');
      return;
    }
    conversationRealtimeHub.publish({ type: 'conversation.message.received', conversationId: conversation.id, messageId: inboundMessage.id });
  }

  async processPersistedMessage(job: { conversationId: string; messageId: string; recipientWaId: string }): Promise<void> {
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: job.conversationId }, select: { id: true, controlMode: true } });
    if (conversation.controlMode === 'HUMAN') return;
    const inboundMessage = { id: job.messageId };
    const waId = job.recipientWaId;
    conversationRealtimeHub.publish({
      type: 'concierge.processing',
      conversationId: conversation.id,
      messageId: inboundMessage.id,
    });

    let turn;
    try {
      turn = await this.concierge.runTurn({
        conversationId: conversation.id,
        incomingMessageId: inboundMessage.id,
      });
    } catch (error) {
      conversationRealtimeHub.publish({
        type: 'concierge.failed',
        conversationId: conversation.id,
        messageId: inboundMessage.id,
        error: error instanceof Error ? error.message : 'Unknown concierge error',
      });
      throw error;
    }

    const outboundMessage =
      [...turn.persistedConversation.messages].reverse().find((message) => message.direction === 'OUTBOUND') ?? null;
    conversationRealtimeHub.publish({
      type: 'concierge.replied',
      conversationId: conversation.id,
      ...(outboundMessage ? { messageId: outboundMessage.id } : {}),
    });

    let replyText = turn.modelResponse.structured.replyText.trim();
    if (!replyText) {
      return;
    }

    const requestedMediaUrls = this.getOutboundMediaUrls(outboundMessage);
    const validatedDelivery = await new ResourceDeliveryGuardService().prepareDelivery(requestedMediaUrls, turn.context.activeInquiry?.id ?? null);
    const mediaUrls = validatedDelivery.urls;
    if (mediaUrls.length !== requestedMediaUrls.length) {
      replyText = mediaUrls.length
        ? 'Te comparto los folletos vigentes. Un asesor de TKTours puede ayudarte con las otras opciones.'
        : 'Ese folleto ya no está disponible para compartir. Con gusto, un asesor de TKTours te ayudará con información actualizada.';
      if (outboundMessage) await prisma.message.update({
        where: { id: outboundMessage.id },
        data: { text: replyText, mediaUrl: mediaUrls[0] ?? null },
      });
    }
    const deliveries = outboundMessage?.metadata?.resourceDeliveries;
    let textResult;
    try {
      textResult = await this.whatsAppClient.sendMessage({ to: waId, body: replyText });
    } catch (error) {
      // The document requests have not started, regardless of the text request's outcome.
      if (Array.isArray(deliveries)) await Promise.all(deliveries.map(async (delivery: { sendId?: string }) => {
        if (typeof delivery.sendId === 'string') await new ResourceSendHistoryService().recordTransportResult(delivery.sendId, 'FAILED_TO_REQUEST', null);
      }));
      throw error;
    }
    const mediaResults = await Promise.all(
      mediaUrls.map(async (mediaUrl) => {
        try {
          return await this.whatsAppClient.sendMessage({ to: waId, mediaUrl, fileName: validatedDelivery.versions.find((version) => version.url === mediaUrl)?.fileName });
        } catch (error) {
          logger.error({ error, mediaUrl, messageId: outboundMessage?.id }, 'meta whatsapp document request failed');
          const rejected = error instanceof ValidationAppError
            && typeof (error.details as { status?: unknown } | undefined)?.status === 'number';
          return { messageId: null, status: rejected ? 'FAILED_TO_REQUEST' : 'UNKNOWN' };
        }
      }),
    );

    if (Array.isArray(deliveries)) {
      await Promise.all(deliveries.map(async (delivery: { sendId?: string; url?: string }) => {
        if (typeof delivery.sendId !== 'string') return;
        const index = mediaUrls.indexOf(delivery.url ?? '');
        const result = mediaResults[index];
        await new ResourceSendHistoryService().recordTransportResult(
          delivery.sendId, result?.status ?? 'FAILED_TO_REQUEST', result?.messageId ?? null,
        );
      }));
    }

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
          attachments: validatedDelivery.versions,
        }),
      },
    });

    conversationRealtimeHub.publish({
      type: 'conversation.updated',
      conversationId: conversation.id,
      messageId: outboundMessage.id,
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

  private async createInboundMessage(params: {
    conversationId: string;
    providerMessageId: string;
    contactId: string;
    recipientWaId: string;
    processWithAi: boolean;
    text: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string; createdAt: Date } | null> {
    try {
      return await prisma.$transaction(async (tx) => {
        // The contact row serializes thread/inquiry creation across webhook requests.
        await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${params.contactId}::uuid FOR UPDATE`;
        const duplicate = await tx.message.findUnique({ where: { providerMessageId: params.providerMessageId }, select: { id: true } });
        if (duplicate) return null;
        const message = await tx.message.create({ data: {
          conversationId: params.conversationId, direction: 'INBOUND', text: params.text,
          providerMessageId: params.providerMessageId, metadata: toNullableJsonInput(params.metadata),
        }, select: { id: true, createdAt: true } });
        await tx.conversation.updateMany({ where: { id: params.conversationId, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: message.createdAt } }] }, data: { lastMessageAt: message.createdAt } });
        const openInquiry = await tx.inquiry.findFirst({ where: { conversationId: params.conversationId, status: { not: 'CLOSED' } }, select: { id: true } });
        if (!openInquiry) await tx.inquiry.create({ data: { conversationId: params.conversationId, contactId: params.contactId, status: 'OPEN' } });
        if (params.processWithAi) {
          const job = await tx.whatsAppInboundJob.create({ data: {
            messageId: message.id, conversationId: params.conversationId, recipientWaId: params.recipientWaId,
          } });
          await tx.message.update({ where: { id: message.id }, data: { metadata: toNullableJsonInput({ ...params.metadata, inboxJobId: job.id.toString() }) } });
        }
        return message;
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
}
