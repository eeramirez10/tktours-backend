import { Router } from 'express';
import { MetaWhatsAppAccountService } from '../../../application/services/meta-whatsapp-account.service.js';

export const whatsappAccountRoutes = Router();
const service = new MetaWhatsAppAccountService();

whatsappAccountRoutes.get('/whatsapp/account', async (_req, res, next) => {
  try { res.json({ ok: true, data: await service.getAccount() }); } catch (error) { next(error); }
});
