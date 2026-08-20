import type { NextFunction, Request, Response } from 'express';

import { UnauthorizedAppError } from '../../../../../shared/domain/errors/app-error.js';
import { AdminAuthService } from '../../../application/services/admin-auth.service.js';

const adminAuthService = new AdminAuthService();

export async function requireAdminAuth(req: Request, _res: Response, next: NextFunction) {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return next(new UnauthorizedAppError('Bearer access token is required'));
  }

  const accessToken = authorization.slice('Bearer '.length).trim();
  if (!accessToken) {
    return next(new UnauthorizedAppError('Bearer access token is required'));
  }

  try {
    req.admin = await adminAuthService.getAuthenticatedAdmin(accessToken);
    return next();
  } catch (error) {
    return next(error);
  }
}
