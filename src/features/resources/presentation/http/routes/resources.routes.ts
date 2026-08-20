import { Router } from 'express';

import { resourcesController, uploadResourcePdf } from '../controllers/resources.controller.js';

export const resourcesRoutes = Router();
export const publicResourceDownloadRoutes = Router();

publicResourceDownloadRoutes.get('/resources/:resourceId/versions/:versionId/download', (req, res, next) =>
  resourcesController.downloadVersion(req, res, next),
);

resourcesRoutes.get('/resources/health', (req, res) => resourcesController.getHealth(req, res));
resourcesRoutes.get('/resources/audit', (req, res, next) => resourcesController.auditResources(req, res, next));
resourcesRoutes.get('/resources', (req, res, next) => resourcesController.listResources(req, res, next));
resourcesRoutes.post('/resources/upload', uploadResourcePdf, (req, res, next) => resourcesController.uploadResource(req, res, next));
resourcesRoutes.get('/resources/:resourceId', (req, res, next) => resourcesController.getResourceById(req, res, next));
resourcesRoutes.post('/resources', (req, res, next) => resourcesController.createResource(req, res, next));
resourcesRoutes.patch('/resources/:resourceId', (req, res, next) => resourcesController.updateResource(req, res, next));
resourcesRoutes.patch('/resources/:resourceId/active', (req, res, next) => resourcesController.setActive(req, res, next));
resourcesRoutes.post('/resources/:resourceId/versions/upload', uploadResourcePdf, (req, res, next) =>
  resourcesController.uploadVersion(req, res, next),
);
resourcesRoutes.post('/resources/:resourceId/versions', (req, res, next) => resourcesController.createVersion(req, res, next));
resourcesRoutes.post('/resources/:resourceId/versions/:versionId/extract', (req, res, next) =>
  resourcesController.extractVersion(req, res, next),
);
resourcesRoutes.delete('/resources/:resourceId', (req, res, next) => resourcesController.deleteResource(req, res, next));
