import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { CreateConversationUseCase } from '../../../application/use-cases/create-conversation.use-case.js';
import { CreateMessageUseCase } from '../../../application/use-cases/create-message.use-case.js';
import { GetConversationByIdUseCase } from '../../../application/use-cases/get-conversation-by-id.use-case.js';
import { GetConversationsHealthUseCase } from '../../../application/use-cases/get-conversations-health.use-case.js';
import { ListConversationsUseCase } from '../../../application/use-cases/list-conversations.use-case.js';
import { UpdateConversationUseCase } from '../../../application/use-cases/update-conversation.use-case.js';
import { PrismaConversationRepository } from '../../../infrastructure/repositories/prisma-conversation.repository.js';
import { conversationIdParamsSchema } from '../schemas/conversation-params.schemas.js';
import { listConversationsQuerySchema } from '../schemas/conversation-query.schemas.js';
import { createConversationBodySchema } from '../schemas/create-conversation.schemas.js';
import { createMessageBodySchema, updateConversationBodySchema } from '../schemas/update-conversation.schemas.js';

const conversationRepository = new PrismaConversationRepository();
const getConversationsHealthUseCase = new GetConversationsHealthUseCase();
const listConversationsUseCase = new ListConversationsUseCase(conversationRepository);
const getConversationByIdUseCase = new GetConversationByIdUseCase(conversationRepository);
const createConversationUseCase = new CreateConversationUseCase(conversationRepository);
const updateConversationUseCase = new UpdateConversationUseCase(conversationRepository);
const createMessageUseCase = new CreateMessageUseCase(conversationRepository);

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

export class ConversationsController {
  getHealth(_req: Request, res: Response) {
    return res.json({ ok: true, data: getConversationsHealthUseCase.execute() });
  }

  async listConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listConversationsQuerySchema.parse(req.query);
      const data = await listConversationsUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid conversations query') : error);
    }
  }

  async getConversationById(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = conversationIdParamsSchema.parse(req.params);
      const data = await getConversationByIdUseCase.execute(conversationId);
      if (!data) {
        return next(new NotFoundAppError('Conversation not found'));
      }
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid conversation id') : error);
    }
  }

  async createConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createConversationBodySchema.parse(req.body);
      const data = await createConversationUseCase.execute(body);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create conversation body') : error);
    }
  }

  async updateConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = conversationIdParamsSchema.parse(req.params);
      const body = updateConversationBodySchema.parse(req.body);
      const data = await updateConversationUseCase.execute({ conversationId, ...body });
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid update conversation body') : error);
    }
  }

  async createMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = conversationIdParamsSchema.parse(req.params);
      const body = createMessageBodySchema.parse(req.body);
      const data = await createMessageUseCase.execute({ conversationId, ...body });
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create message body') : error);
    }
  }
}

export const conversationsController = new ConversationsController();
