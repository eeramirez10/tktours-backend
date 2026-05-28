import { Router } from 'express';

import { twilioWhatsAppController } from '../controllers/twilio-whatsapp.controller.js';

export const twilioWhatsAppRoutes = Router();

twilioWhatsAppRoutes.get('/webhooks/twilio/whatsapp/health', (req, res) => twilioWhatsAppController.getHealth(req, res));
twilioWhatsAppRoutes.post('/webhooks/twilio/whatsapp', (req, res, next) => twilioWhatsAppController.inboundWebhook(req, res, next));
