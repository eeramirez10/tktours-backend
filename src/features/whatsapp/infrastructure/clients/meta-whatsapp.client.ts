import { env } from '../../../../shared/config/env.js';
import { logger } from '../../../../shared/config/logger.js';
import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';

export type SendMetaWhatsAppMessageInput = {
  to: string;
  body?: string;
  mediaUrl?: string | null;
};

export type SendMetaWhatsAppMessageResult = {
  messageId: string | null;
  status: 'ACCEPTED';
};

export function normalizeWhatsAppPhoneNumber(value: string): string {
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

export class MetaWhatsAppClient {
  async sendMessage(params: SendMetaWhatsAppMessageInput): Promise<SendMetaWhatsAppMessageResult> {
    const body = params.body?.trim();
    const mediaUrl = params.mediaUrl?.trim();
    if (!body && (!mediaUrl || !/^https?:\/\//i.test(mediaUrl))) {
      throw new ValidationAppError('Meta WhatsApp message requires text or a public document URL');
    }

    const filename = mediaUrl ? getDocumentFilename(mediaUrl) : undefined;
    const payload = mediaUrl
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizeWhatsAppPhoneNumber(params.to),
          type: 'document',
          document: {
            link: mediaUrl,
            ...(filename ? { filename } : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizeWhatsAppPhoneNumber(params.to),
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
