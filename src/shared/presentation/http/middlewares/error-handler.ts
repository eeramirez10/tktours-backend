import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../domain/errors/app-error.js';
import { logger } from '../../../config/logger.js';

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
    });
  }

  logger.error(
    {
      err: error,
      path: req.path,
      method: req.method,
    },
    'unhandled request error',
  );

  return res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: null,
    },
  });
}
