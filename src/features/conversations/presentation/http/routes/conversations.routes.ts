import { Router } from 'express';

import { conversationsController } from '../controllers/conversations.controller.js';

export const conversationsRoutes = Router();

conversationsRoutes.get('/conversations/health', (req, res) => conversationsController.getHealth(req, res));
conversationsRoutes.patch('/conversations/notifications/seen', (req, res, next) => conversationsController.markNotificationsAsSeen(req, res, next));
conversationsRoutes.get('/conversations', (req, res, next) => conversationsController.listConversations(req, res, next));
conversationsRoutes.get('/conversations/:conversationId', (req, res, next) => conversationsController.getConversationById(req, res, next));
conversationsRoutes.post('/conversations', (req, res, next) => conversationsController.createConversation(req, res, next));
conversationsRoutes.patch('/conversations/:conversationId', (req, res, next) => conversationsController.updateConversation(req, res, next));
conversationsRoutes.post('/conversations/:conversationId/messages', (req, res, next) => conversationsController.createMessage(req, res, next));
conversationsRoutes.post('/conversations/:conversationId/assistant-replies', (req, res, next) => conversationsController.runAdminConciergeTurn(req, res, next));
conversationsRoutes.patch('/conversations/:conversationId/control-mode', (req, res, next) => conversationsController.setControlMode(req, res, next));
conversationsRoutes.post('/conversations/:conversationId/human-messages', (req, res, next) => conversationsController.sendHumanMessage(req, res, next));
conversationsRoutes.patch('/conversations/:conversationId/read', (req, res, next) => conversationsController.markAsRead(req, res, next));
