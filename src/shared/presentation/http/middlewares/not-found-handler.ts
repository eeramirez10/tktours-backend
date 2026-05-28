import type { Request, Response } from 'express';

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    ok: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      details: null,
    },
  });
}
