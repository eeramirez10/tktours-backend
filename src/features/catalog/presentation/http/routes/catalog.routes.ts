import { Router } from 'express';

import { catalogController } from '../controllers/catalog.controller.js';

export const catalogRoutes = Router();

catalogRoutes.get('/catalog/health', (req, res) => catalogController.getHealth(req, res));
catalogRoutes.get('/catalog/countries', (req, res, next) => catalogController.listCountries(req, res, next));
catalogRoutes.get('/catalog/families', (req, res, next) => catalogController.listFamilies(req, res, next));
catalogRoutes.get('/catalog/programs/recommendations', (req, res, next) => catalogController.listRecommendedPrograms(req, res, next));
catalogRoutes.get('/catalog/programs/:slug', (req, res, next) => catalogController.getProgramBySlug(req, res, next));
catalogRoutes.get('/catalog/programs', (req, res, next) => catalogController.listPrograms(req, res, next));
