import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../../domain/errors/app-error.js';
import { logger } from '../../../config/logger.js';

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    return res.status(413).json({
      ok: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The uploaded payload is too large for this endpoint',
        details: null,
      },
    });
  }

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
