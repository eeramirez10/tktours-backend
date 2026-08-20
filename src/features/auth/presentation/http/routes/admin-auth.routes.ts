import { Router } from 'express';

import { adminAuthController } from '../controllers/admin-auth.controller.js';
import { requireAdminAuth } from '../middlewares/require-admin-auth.middleware.js';

export const adminAuthRoutes = Router();

adminAuthRoutes.post('/login', (req, res, next) => adminAuthController.login(req, res, next));
adminAuthRoutes.get('/me', requireAdminAuth, (req, res) => adminAuthController.me(req, res));
