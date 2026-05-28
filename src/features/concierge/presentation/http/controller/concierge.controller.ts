import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { GetConciergeTurnTraceByIdUseCase } from '../../../application/use-cases/get-concierge-turn-trace-by-id.use-case.js';
import { ListConciergeTurnTracesUseCase } from '../../../application/use-cases/list-concierge-turn-traces.use-case.js';
import { ConciergeOrchestratorService } from '../../../application/services/concierge-orchestrator.service.js';
import { PrismaConciergeTurnTraceRepository } from '../../../infrastructure/repositories/prisma-concierge-turn-trace.repository.js';
import { conciergeTurnTraceParamsSchema, listConciergeTurnTraceQuerySchema } from '../schemas/concierge-turn-trace-query.schemas.js';
import { runConciergeTurnBodySchema } from '../schemas/run-concierge-turn.schemas.js';

const traceRepository = new PrismaConciergeTurnTraceRepository();
const listConciergeTurnTracesUseCase = new ListConciergeTurnTracesUseCase(traceRepository);
const getConciergeTurnTraceByIdUseCase = new GetConciergeTurnTraceByIdUseCase(traceRepository);

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

export class ConciergeController {
  constructor(private readonly conciergeOrchestratorService = new ConciergeOrchestratorService()) {}

  async runTurn(req: Request, res: Response, next: NextFunction) {
    try {
      const body = runConciergeTurnBodySchema.parse(req.body);
      const data = await this.conciergeOrchestratorService.runTurn({ ...body });

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid concierge run body') : error);
    }
  }

  async listTurns(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listConciergeTurnTraceQuerySchema.parse(req.query);
      const data = await listConciergeTurnTracesUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid concierge turns query') : error);
    }
  }

  async getTurnById(req: Request, res: Response, next: NextFunction) {
    try {
      const { turnId } = conciergeTurnTraceParamsSchema.parse(req.params);
      const data = await getConciergeTurnTraceByIdUseCase.execute(turnId);

      if (!data) {
        return next(new NotFoundAppError('Concierge turn not found'));
      }

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid concierge turn id') : error);
    }
  }
}
