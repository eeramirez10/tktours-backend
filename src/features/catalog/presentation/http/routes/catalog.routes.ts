import { Router } from 'express';

import { catalogController } from '../controllers/catalog.controller.js';

export const catalogRoutes = Router();

catalogRoutes.get('/catalog/health', (req, res) => catalogController.getHealth(req, res));
catalogRoutes.get('/catalog/countries', (req, res, next) => catalogController.listCountries(req, res, next));
catalogRoutes.post('/catalog/countries', (req, res, next) => catalogController.createCountry(req, res, next));
catalogRoutes.patch('/catalog/countries/:countryId', (req, res, next) => catalogController.updateCountry(req, res, next));
catalogRoutes.get('/catalog/families', (req, res, next) => catalogController.listFamilies(req, res, next));
catalogRoutes.get('/catalog/locations', (req, res, next) => catalogController.listLocations(req, res, next));
catalogRoutes.post('/catalog/locations', (req, res, next) => catalogController.createLocation(req, res, next));
catalogRoutes.patch('/catalog/locations/:locationId', (req, res, next) => catalogController.updateLocation(req, res, next));
catalogRoutes.get('/catalog/programs/recommendations', (req, res, next) => catalogController.listRecommendedPrograms(req, res, next));
catalogRoutes.get('/catalog/programs/:slug', (req, res, next) => catalogController.getProgramBySlug(req, res, next));
catalogRoutes.get('/catalog/programs', (req, res, next) => catalogController.listPrograms(req, res, next));
