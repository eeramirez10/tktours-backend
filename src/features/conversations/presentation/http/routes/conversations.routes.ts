import { Router } from 'express';

import { conversationsController } from '../controllers/conversations.controller.js';

export const conversationsRoutes = Router();

conversationsRoutes.get('/conversations/health', (req, res) => conversationsController.getHealth(req, res));
conversationsRoutes.get('/conversations', (req, res, next) => conversationsController.listConversations(req, res, next));
conversationsRoutes.get('/conversations/:conversationId', (req, res, next) => conversationsController.getConversationById(req, res, next));
conversationsRoutes.post('/conversations', (req, res, next) => conversationsController.createConversation(req, res, next));
conversationsRoutes.patch('/conversations/:conversationId', (req, res, next) => conversationsController.updateConversation(req, res, next));
conversationsRoutes.post('/conversations/:conversationId/messages', (req, res, next) => conversationsController.createMessage(req, res, next));
