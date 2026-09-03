import { Router } from 'express';

import { metaWhatsAppController } from '../controllers/meta-whatsapp.controller.js';

export const metaWhatsAppRoutes = Router();

metaWhatsAppRoutes.get('/webhooks/meta/whatsapp/health', (req, res) => metaWhatsAppController.getHealth(req, res));
metaWhatsAppRoutes.get('/webhooks/meta/whatsapp', (req, res) => metaWhatsAppController.verifyWebhook(req, res));
metaWhatsAppRoutes.post('/webhooks/meta/whatsapp', (req, res, next) => metaWhatsAppController.inboundWebhook(req, res, next));
