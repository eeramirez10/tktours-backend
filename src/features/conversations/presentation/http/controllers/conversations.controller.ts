import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { CreateConversationUseCase } from '../../../application/use-cases/create-conversation.use-case.js';
import { CreateMessageUseCase } from '../../../application/use-cases/create-message.use-case.js';
import { RunAdminConciergeTurnUseCase } from '../../../application/use-cases/run-admin-concierge-turn.use-case.js';
import { SendHumanConversationMessageUseCase } from '../../../application/use-cases/send-human-conversation-message.use-case.js';
import { SetConversationControlModeUseCase } from '../../../application/use-cases/set-conversation-control-mode.use-case.js';
import { GetConversationByIdUseCase } from '../../../application/use-cases/get-conversation-by-id.use-case.js';
import { GetConversationsHealthUseCase } from '../../../application/use-cases/get-conversations-health.use-case.js';
import { ListConversationsUseCase } from '../../../application/use-cases/list-conversations.use-case.js';
import { UpdateConversationUseCase } from '../../../application/use-cases/update-conversation.use-case.js';
import { PrismaConversationRepository } from '../../../infrastructure/repositories/prisma-conversation.repository.js';
import { conversationIdParamsSchema } from '../schemas/conversation-params.schemas.js';
import { listConversationsQuerySchema } from '../schemas/conversation-query.schemas.js';
import { createConversationBodySchema } from '../schemas/create-conversation.schemas.js';
import { createMessageBodySchema, updateConversationBodySchema } from '../schemas/update-conversation.schemas.js';
import { runAdminConciergeTurnBodySchema } from '../schemas/run-admin-concierge-turn.schemas.js';
import { sendHumanConversationMessageBodySchema, setConversationControlModeBodySchema } from '../schemas/conversation-control.schemas.js';

const conversationRepository = new PrismaConversationRepository();
const getConversationsHealthUseCase = new GetConversationsHealthUseCase();
const listConversationsUseCase = new ListConversationsUseCase(conversationRepository);
const getConversationByIdUseCase = new GetConversationByIdUseCase(conversationRepository);
const createConversationUseCase = new CreateConversationUseCase(conversationRepository);
const updateConversationUseCase = new UpdateConversationUseCase(conversationRepository);
const createMessageUseCase = new CreateMessageUseCase(conversationRepository);
const runAdminConciergeTurnUseCase = new RunAdminConciergeTurnUseCase(conversationRepository);
const setConversationControlModeUseCase = new SetConversationControlModeUseCase(conversationRepository);
const sendHumanConversationMessageUseCase = new SendHumanConversationMessageUseCase(conversationRepository);

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

  async runAdminConciergeTurn(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = conversationIdParamsSchema.parse(req.params);
      const body = runAdminConciergeTurnBodySchema.parse(req.body);
      if (!req.admin) {
        return next(new ValidationAppError('Authenticated admin is required'));
      }
      const data = await runAdminConciergeTurnUseCase.execute({
        conversationId,
        text: body.text,
        admin: req.admin,
      });
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid admin concierge message') : error);
    }
  }

  async setControlMode(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = conversationIdParamsSchema.parse(req.params);
      const body = setConversationControlModeBodySchema.parse(req.body);
      if (!req.admin) {
        return next(new ValidationAppError('Authenticated admin is required'));
      }
      const data = await setConversationControlModeUseCase.execute({ conversationId, ...body });
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid conversation control mode') : error);
    }
  }

  async sendHumanMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = conversationIdParamsSchema.parse(req.params);
      const body = sendHumanConversationMessageBodySchema.parse(req.body);
      if (!req.admin) {
        return next(new ValidationAppError('Authenticated admin is required'));
      }
      const data = await sendHumanConversationMessageUseCase.execute({
        conversationId,
        text: body.text,
        admin: req.admin,
      });
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid human conversation message') : error);
    }
  }
}

export const conversationsController = new ConversationsController();
