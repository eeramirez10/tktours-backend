import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { env } from '../../../../../shared/config/env.js';
import { logger } from '../../../../../shared/config/logger.js';
import { ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { MetaWhatsAppInboundService } from '../../../application/services/meta-whatsapp-inbound.service.js';
import { metaWhatsAppWebhookBodySchema } from '../schemas/meta-whatsapp-webhook.schemas.js';

const service = new MetaWhatsAppInboundService();

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isValidSignature(req: Request): boolean {
  const signature = req.get('x-hub-signature-256');
  if (!signature || !req.rawBody) {
    return false;
  }

  const expected = `sha256=${createHmac('sha256', env.WHATSAPP_META_APP_SECRET).update(req.rawBody).digest('hex')}`;
  return safeEqual(signature, expected);
}

export class MetaWhatsAppController {
  getHealth(_req: Request, res: Response) {
    return res.json({
      ok: true,
      data: {
        feature: 'meta-whatsapp-webhook',
        ready: true,
      },
    });
  }

  verifyWebhook(req: Request, res: Response) {
    const mode = req.query['hub.mode'];
    const verifyToken = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      mode !== 'subscribe' ||
      typeof verifyToken !== 'string' ||
      !safeEqual(verifyToken, env.WHATSAPP_META_VERIFY_TOKEN) ||
      typeof challenge !== 'string'
    ) {
      return res.sendStatus(403);
    }

    return res.status(200).type('text/plain').send(challenge);
  }

  async inboundWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      if (!isValidSignature(req)) {
        logger.warn('meta whatsapp webhook rejected because the signature is invalid');
        return res.sendStatus(401);
      }

      const payload = metaWhatsAppWebhookBodySchema.parse(req.body);

      // Meta expects a fast acknowledgement; process the turn after returning 200.
      void service.processWebhook(payload).catch((error) => {
        logger.error({ error }, 'meta whatsapp inbound processing failed');
      });

      return res.sendStatus(200);
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid Meta WhatsApp webhook body') : error);
    }
  }
}

export const metaWhatsAppController = new MetaWhatsAppController();
