import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { logger } from '../../../../../shared/config/logger.js';
import { ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { TwilioWhatsAppInboundService } from '../../../application/services/twilio-whatsapp-inbound.service.js';
import { TwilioWhatsAppStatusService } from '../../../application/services/twilio-whatsapp-status.service.js';
import { twilioWhatsAppStatusBodySchema, twilioWhatsAppWebhookBodySchema } from '../schemas/twilio-whatsapp-webhook.schemas.js';

const service = new TwilioWhatsAppInboundService();
const statusService = new TwilioWhatsAppStatusService();

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

export class TwilioWhatsAppController {
  getHealth(_req: Request, res: Response) {
    return res.json({
      ok: true,
      data: {
        feature: 'twilio-whatsapp-webhook',
        ready: true,
      },
    });
  }

  async inboundWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = twilioWhatsAppWebhookBodySchema.parse(req.body);

      // Twilio requires fast 2xx responses. Process async and keep webhook fast.
      void service.processInbound(payload).catch((error) => {
        logger.error({ error, messageSid: payload.MessageSid }, 'twilio inbound processing failed');
      });

      res.type('text/xml');
      return res.status(200).send('<Response></Response>');
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid Twilio webhook body') : error);
    }
  }

  async statusWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = twilioWhatsAppStatusBodySchema.parse(req.body);

      void statusService.processStatusCallback(payload).catch((error) => {
        logger.error({ error, messageSid: payload.MessageSid }, 'twilio status processing failed');
      });

      res.type('text/xml');
      return res.status(200).send('<Response></Response>');
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid Twilio status webhook body') : error);
    }
  }
}

export const twilioWhatsAppController = new TwilioWhatsAppController();
