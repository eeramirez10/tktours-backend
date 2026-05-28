import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { CreateInquiryUseCase } from '../../../application/use-cases/create-inquiry.use-case.js';
import { GetInquiriesHealthUseCase } from '../../../application/use-cases/get-inquiries-health.use-case.js';
import { GetInquiryByIdUseCase } from '../../../application/use-cases/get-inquiry-by-id.use-case.js';
import { ListInquiriesUseCase } from '../../../application/use-cases/list-inquiries.use-case.js';
import { RefreshInquiryRecommendationsUseCase } from '../../../application/use-cases/refresh-inquiry-recommendations.use-case.js';
import { UpdateInquiryStatusUseCase } from '../../../application/use-cases/update-inquiry-status.use-case.js';
import { UpdateInquiryUseCase } from '../../../application/use-cases/update-inquiry.use-case.js';
import { PrismaInquiryRepository } from '../../../infrastructure/repositories/prisma-inquiry.repository.js';
import { createInquiryBodySchema } from '../schemas/create-inquiry.schemas.js';
import { inquiryIdParamsSchema } from '../schemas/inquiry-params.schemas.js';
import { listInquiriesQuerySchema } from '../schemas/inquiry-query.schemas.js';
import { updateInquiryBodySchema, updateInquiryStatusBodySchema } from '../schemas/update-inquiry.schemas.js';

const inquiryRepository = new PrismaInquiryRepository();
const getInquiriesHealthUseCase = new GetInquiriesHealthUseCase();
const listInquiriesUseCase = new ListInquiriesUseCase(inquiryRepository);
const getInquiryByIdUseCase = new GetInquiryByIdUseCase(inquiryRepository);
const createInquiryUseCase = new CreateInquiryUseCase(inquiryRepository);
const updateInquiryUseCase = new UpdateInquiryUseCase(inquiryRepository);
const updateInquiryStatusUseCase = new UpdateInquiryStatusUseCase(inquiryRepository);
const refreshInquiryRecommendationsUseCase = new RefreshInquiryRecommendationsUseCase(inquiryRepository);

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

export class InquiriesController {
  getHealth(_req: Request, res: Response) {
    return res.json({ ok: true, data: getInquiriesHealthUseCase.execute() });
  }

  async listInquiries(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listInquiriesQuerySchema.parse(req.query);
      const data = await listInquiriesUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid inquiries query') : error);
    }
  }

  async getInquiryById(req: Request, res: Response, next: NextFunction) {
    try {
      const { inquiryId } = inquiryIdParamsSchema.parse(req.params);
      const data = await getInquiryByIdUseCase.execute(inquiryId);
      if (!data) {
        return next(new NotFoundAppError('Inquiry not found'));
      }
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid inquiry id') : error);
    }
  }

  async createInquiry(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createInquiryBodySchema.parse(req.body);
      const data = await createInquiryUseCase.execute(body);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create inquiry body') : error);
    }
  }

  async updateInquiry(req: Request, res: Response, next: NextFunction) {
    try {
      const { inquiryId } = inquiryIdParamsSchema.parse(req.params);
      const body = updateInquiryBodySchema.parse(req.body);
      const data = await updateInquiryUseCase.execute({ inquiryId, ...body });
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid update inquiry body') : error);
    }
  }

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { inquiryId } = inquiryIdParamsSchema.parse(req.params);
      const body = updateInquiryStatusBodySchema.parse(req.body);
      const data = await updateInquiryStatusUseCase.execute({ inquiryId, status: body.status });
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid inquiry status body') : error);
    }
  }

  async refreshRecommendations(req: Request, res: Response, next: NextFunction) {
    try {
      const { inquiryId } = inquiryIdParamsSchema.parse(req.params);
      const data = await refreshInquiryRecommendationsUseCase.execute(inquiryId);
      if (!data) {
        return next(new NotFoundAppError('Inquiry not found'));
      }
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid inquiry id') : error);
    }
  }
}

export const inquiriesController = new InquiriesController();
