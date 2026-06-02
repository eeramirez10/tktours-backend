import { Prisma } from '@prisma/client';

import { ConciergeOrchestratorService } from '../../../concierge/application/services/concierge-orchestrator.service.js';
import { env } from '../../../../shared/config/env.js';
import { logger } from '../../../../shared/config/logger.js';
import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { TwilioWhatsAppWebhookBody } from '../../presentation/http/schemas/twilio-whatsapp-webhook.schemas.js';

function toNullableJsonInput(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function withWhatsAppPrefix(value: string): string {
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`;
}

function normalizeWaId(payload: TwilioWhatsAppWebhookBody): string {
  if (payload.WaId) {
    return payload.WaId;
  }
  const from = payload.From.trim();
  if (!from.startsWith('whatsapp:')) {
    return from;
  }
  return from.replace(/^whatsapp:/, '');
}

export class TwilioWhatsAppInboundService {
  constructor(private readonly concierge = new ConciergeOrchestratorService()) {}

  async processInbound(payload: TwilioWhatsAppWebhookBody): Promise<void> {
    const from = withWhatsAppPrefix(payload.From.trim());
    const profileName = payload.ProfileName?.trim() || null;
    const waId = normalizeWaId(payload);
    const bodyText = payload.Body?.trim() || '[sin texto]';

    const contact = await prisma.contact.upsert({
      where: { waId },
      update: {
        ...(profileName ? { firstName: profileName } : {}),
      },
      create: {
        waId,
        firstName: profileName,
      },
      select: { id: true },
    });

    const conversation = await this.findOrCreateOpenConversation(contact.id);

    const inboundMessage = await this.createInboundMessage({
      conversationId: conversation.id,
      providerMessageId: payload.MessageSid,
      text: bodyText,
      metadata: {
        source: 'twilio-webhook',
        rawFrom: payload.From,
        rawTo: payload.To ?? null,
      },
    });

    if (!inboundMessage) {
      logger.info({ messageSid: payload.MessageSid }, 'twilio inbound duplicate ignored');
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

    const textResult = await this.sendWhatsAppMessage({
      to: from,
      body: replyText,
    });

    const mediaUrl = outboundMessage?.mediaUrl ?? null;
    const mediaResult =
      mediaUrl && /^https?:\/\//i.test(mediaUrl)
        ? await this.sendWhatsAppMessage({
            to: from,
            mediaUrl,
          }).catch((error) => {
            logger.error({ error, mediaUrl, messageId: outboundMessage?.id }, 'twilio media outbound request failed');
            return { sid: null, status: 'FAILED_TO_REQUEST' };
          })
        : null;

    if (!outboundMessage || !textResult.sid) {
      return;
    }

    try {
      await prisma.message.update({
        where: { id: outboundMessage.id },
        data: {
          providerMessageId: textResult.sid,
          metadata: toNullableJsonInput({
            ...(outboundMessage.metadata ?? {}),
            transport: 'twilio',
            twilioStatus: textResult.status,
            mediaTwilioSid: mediaResult?.sid ?? null,
            mediaTwilioStatus: mediaResult?.status ?? null,
          }),
        },
      });
    } catch (error) {
      logger.warn({ error, messageId: outboundMessage.id }, 'failed to persist twilio sid in outbound message');
    }
  }

  private async findOrCreateOpenConversation(contactId: string): Promise<{ id: string }> {
    const existing = await prisma.conversation.findFirst({
      where: {
        contactId,
        channel: 'WHATSAPP',
        status: 'OPEN',
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      select: { id: true },
    });

    if (existing) {
      return existing;
    }

    return prisma.conversation.create({
      data: {
        contactId,
        channel: 'WHATSAPP',
        status: 'OPEN',
        currentStage: 'START',
        contextJson: {
          source: 'twilio-webhook',
        },
      },
      select: { id: true },
    });
  }

  private async ensureOpenInquiry(conversationId: string, contactId: string): Promise<void> {
    const openInquiry = await prisma.inquiry.findFirst({
      where: {
        conversationId,
        status: {
          not: 'CLOSED',
        },
      },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (openInquiry) {
      return;
    }

    await prisma.inquiry.create({
      data: {
        conversationId,
        contactId,
        status: 'OPEN',
      },
      select: { id: true },
    });
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
        select: {
          id: true,
          createdAt: true,
        },
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

  private async sendWhatsAppMessage(params: { to: string; body?: string; mediaUrl?: string | null }): Promise<{ sid: string | null; status: string | null }> {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_WHATSAPP_FROM;

    if (!accountSid || !authToken || !from) {
      logger.warn('twilio credentials not configured, outbound whatsapp message skipped');
      return { sid: null, status: 'SKIPPED' };
    }

    const fromAddress = withWhatsAppPrefix(from.trim());
    const toAddress = withWhatsAppPrefix(params.to.trim().replace(/^whatsapp:/, ''));
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const body = new URLSearchParams({
      From: fromAddress,
      To: toAddress,
    });
    if (params.body?.trim()) {
      body.append('Body', params.body.trim());
    }
    if (params.mediaUrl && /^https?:\/\//i.test(params.mediaUrl)) {
      body.append('MediaUrl', params.mediaUrl);
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          body: json,
        },
        'twilio outbound request failed',
      );
      throw new ValidationAppError('Twilio outbound request failed', {
        status: response.status,
        response: json,
      });
    }

    const sid = typeof json.sid === 'string' ? json.sid : null;
    const status = typeof json.status === 'string' ? json.status : null;

    return { sid, status };
  }
}
