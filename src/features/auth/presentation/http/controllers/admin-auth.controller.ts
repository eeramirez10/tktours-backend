import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { AdminAuthService } from '../../../application/services/admin-auth.service.js';
import { adminLoginBodySchema } from '../schemas/admin-auth.schemas.js';

const adminAuthService = new AdminAuthService();

export class AdminAuthController {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const body = adminLoginBodySchema.parse(req.body);
      const data = await adminAuthService.login(body.email, body.password);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(
        error instanceof ZodError ? new ValidationAppError('Invalid login body', error.flatten()) : error,
      );
    }
  }

  me(req: Request, res: Response) {
    return res.json({ ok: true, data: { admin: req.admin } });
  }
}

export const adminAuthController = new AdminAuthController();
