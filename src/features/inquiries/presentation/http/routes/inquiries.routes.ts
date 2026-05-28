import { Router } from 'express';

import { inquiriesController } from '../controllers/inquiries.controller.js';

export const inquiriesRoutes = Router();

inquiriesRoutes.get('/inquiries/health', (req, res) => inquiriesController.getHealth(req, res));
inquiriesRoutes.get('/inquiries', (req, res, next) => inquiriesController.listInquiries(req, res, next));
inquiriesRoutes.get('/inquiries/:inquiryId', (req, res, next) => inquiriesController.getInquiryById(req, res, next));
inquiriesRoutes.post('/inquiries', (req, res, next) => inquiriesController.createInquiry(req, res, next));
inquiriesRoutes.patch('/inquiries/:inquiryId', (req, res, next) => inquiriesController.updateInquiry(req, res, next));
inquiriesRoutes.patch('/inquiries/:inquiryId/status', (req, res, next) => inquiriesController.updateStatus(req, res, next));
inquiriesRoutes.post('/inquiries/:inquiryId/recommendations/refresh', (req, res, next) => inquiriesController.refreshRecommendations(req, res, next));
