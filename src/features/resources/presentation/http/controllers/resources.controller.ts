import { ResourceStoredDocumentAnalysisService } from '../../../application/services/resource-stored-document-analysis.service.js';
import { access } from 'node:fs/promises';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';

import { NotFoundAppError, UnauthorizedAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { ResourceExtractionService } from '../../../application/services/resource-extraction.service.js';
import { ResourceDocumentAnalysisService } from '../../../application/services/resource-document-analysis.service.js';
import { CreateResourceUseCase } from '../../../application/use-cases/create-resource.use-case.js';
import { CreateResourceVersionUseCase } from '../../../application/use-cases/create-resource-version.use-case.js';
import { AuditResourcesUseCase } from '../../../application/use-cases/audit-resources.use-case.js';
import { DeleteResourceUseCase } from '../../../application/use-cases/delete-resource.use-case.js';
import { GetResourceByIdUseCase } from '../../../application/use-cases/get-resource-by-id.use-case.js';
import { GetResourceDownloadUseCase } from '../../../application/use-cases/get-resource-download.use-case.js';
import { GetResourcesHealthUseCase } from '../../../application/use-cases/get-resources-health.use-case.js';
import { ListResourcesUseCase } from '../../../application/use-cases/list-resources.use-case.js';
import { SetResourceActiveUseCase } from '../../../application/use-cases/set-resource-active.use-case.js';
import { UpdateResourceUseCase } from '../../../application/use-cases/update-resource.use-case.js';
import { ResourceRepository } from '../../../infrastructure/repositories/resource.repository.js';
import { LocalResourceStorageService } from '../../../infrastructure/storage/local-resource-storage.service.js';
import { createResourceBodySchema } from '../schemas/create-resource.schemas.js';
import { createResourceVersionBodySchema } from '../schemas/create-resource-version.schemas.js';
import { resourceDownloadParamsSchema, resourceIdParamsSchema } from '../schemas/resource-params.schemas.js';
import { listResourcesQuerySchema } from '../schemas/resources-query.schemas.js';
import { setResourceActiveBodySchema, updateResourceBodySchema } from '../schemas/update-resource.schemas.js';
import { uploadResourceBodySchema, uploadResourceVersionBodySchema } from '../schemas/upload-resource.schemas.js';
import { analyzeResourceDocumentBodySchema } from '../schemas/analyze-resource-document.schemas.js';

const resourceRepository = new ResourceRepository();
const storageService = new LocalResourceStorageService();
const extractionService = new ResourceExtractionService(storageService);
const documentAnalysisService = new ResourceDocumentAnalysisService();
const getResourcesHealthUseCase = new GetResourcesHealthUseCase();
const listResourcesUseCase = new ListResourcesUseCase(resourceRepository);
const getResourceByIdUseCase = new GetResourceByIdUseCase(resourceRepository);
const createResourceUseCase = new CreateResourceUseCase(resourceRepository);
const updateResourceUseCase = new UpdateResourceUseCase(resourceRepository);
const setResourceActiveUseCase = new SetResourceActiveUseCase(resourceRepository);
const createResourceVersionUseCase = new CreateResourceVersionUseCase(resourceRepository);
const getResourceDownloadUseCase = new GetResourceDownloadUseCase(resourceRepository);
const deleteResourceUseCase = new DeleteResourceUseCase(resourceRepository);
const auditResourcesUseCase = new AuditResourcesUseCase(resourceRepository);

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

function assertPdfContent(file: Express.Multer.File): void {
  if (file.size <= 0 || file.buffer.length <= 0) {
    throw new ValidationAppError('Uploaded PDF file is empty');
  }

  const header = file.buffer.subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw new ValidationAppError('Uploaded file content is not a valid PDF');
  }
}

function getAuthenticatedAdminId(req: Request): string {
  if (!req.admin) {
    throw new UnauthorizedAppError();
  }

  return req.admin.id;
}

export const uploadResourcePdf = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      callback(new ValidationAppError('Only PDF files are allowed'));
      return;
    }
    callback(null, true);
  },
}).single('file');

export class ResourcesController {
  async getHealth(_req: Request, res: Response) {
    try {
      await storageService.ensureReady();
      return res.json({
        ok: true,
        data: getResourcesHealthUseCase.execute(),
      });
    } catch {
      return res.status(503).json({
        ok: false,
        error: {
          code: 'RESOURCE_STORAGE_UNAVAILABLE',
          message: 'Resource storage is not available',
          details: null,
        },
      });
    }
  }

  async listResources(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listResourcesQuerySchema.parse(req.query);
      const data = await listResourcesUseCase.execute(query);

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resources query') : error);
    }
  }

  async auditResources(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await auditResourcesUseCase.execute();
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error);
    }
  }

  async getResourceById(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const data = await getResourceByIdUseCase.execute(resourceId);

      if (!data) {
        return next(new NotFoundAppError('Resource not found'));
      }

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resource id') : error);
    }
  }

  async createResource(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createResourceBodySchema.parse(req.body);
      const data = await createResourceUseCase.execute({ ...body, createdById: getAuthenticatedAdminId(req) });
      const extraction = body.initialVersion?.sourceType === 'UPLOAD'
        ? await extractionService.extractCurrentVersion(data.id)
        : null;
      const refreshed = extraction ? await getResourceByIdUseCase.execute(data.id) : null;

      return res.status(201).json({ ok: true, data: refreshed ?? data, extraction });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create resource body') : error);
    }
  }

  async uploadResource(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return next(new ValidationAppError('PDF file is required in field "file"'));
      }

      assertPdfContent(req.file);

      const body = uploadResourceBodySchema.parse(req.body);
      const data = await createResourceUseCase.execute({
        countryCode: body.countryCode,
        countryName: body.countryName,
        familyKey: body.familyKey,
        seasonKeys: body.seasonKeys,
        programSlug: body.programSlug,
        locationSlug: body.locationSlug,
        locationSlugs: body.locationSlugs,
        locationNames: body.locationNames,
        locationName: body.locationName,
        locationVenueName: body.locationVenueName,
        locationDescription: body.locationDescription,
        type: body.type,
        title: body.title,
        description: body.description,
        month: body.month,
        year: body.year,
        active: body.active,
        minWeeks: body.minWeeks,
        maxWeeks: body.maxWeeks,
        shareFrom: body.shareFrom,
        shareUntil: body.shareUntil,
        validFrom: body.validFrom,
        validUntil: body.validUntil,
        minAge: body.minAge,
        maxAge: body.maxAge,
        priceFrom: body.priceFrom,
        priceCurrency: body.priceCurrency,
        priceUnit: body.priceUnit,
        priceNotes: body.priceNotes,
        createdById: getAuthenticatedAdminId(req),
        initialVersion: {
          sourceType: 'UPLOAD',
          fileName: req.file.originalname,
          mimeType: req.file.mimetype || 'application/pdf',
          storageProvider: body.storageProvider,
          fileContentBase64: req.file.buffer.toString('base64'),
        },
      });

      const extraction = await extractionService.extractCurrentVersion(data.id);
      const refreshed = await getResourceByIdUseCase.execute(data.id);

      return res.status(201).json({
        ok: true,
        data: refreshed ?? data,
        extraction,
      });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid upload resource body') : error);
    }
  }

  async analyzeDocument(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return next(new ValidationAppError('PDF file is required in field "file"'));
      }

      assertPdfContent(req.file);
      const body = analyzeResourceDocumentBodySchema.parse(req.body);
      const data = await documentAnalysisService.analyze({
        fileName: req.file.originalname,
        content: req.file.buffer,
        requestedFamilyKey: body.familyKey,
        resourceType: body.type,
      });

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid document analysis body') : error);
    }
  }

  async analyzeStoredDocument(req: Request, res: Response, next: NextFunction) {
    try {
      getAuthenticatedAdminId(req);
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = analyzeResourceDocumentBodySchema.parse(req.body);
      const data = await new ResourceStoredDocumentAnalysisService(resourceRepository, storageService, documentAnalysisService).analyze(resourceId, body);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid document analysis request') : error);
    }
  }

  async updateResource(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = updateResourceBodySchema.parse(req.body);
      const data = await updateResourceUseCase.execute({
        resourceId,
        ...body,
        updatedById: getAuthenticatedAdminId(req),
      });

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid update resource body') : error);
    }
  }

  async setActive(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = setResourceActiveBodySchema.parse(req.body);
      const data = await setResourceActiveUseCase.execute({
        resourceId,
        ...body,
        updatedById: getAuthenticatedAdminId(req),
      });

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resource active body') : error);
    }
  }

  async createVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = createResourceVersionBodySchema.parse(req.body);
      const data = await createResourceVersionUseCase.execute({
        resourceId,
        uploadedById: getAuthenticatedAdminId(req),
        version: body,
      });
      const extraction = body.sourceType === 'UPLOAD' && data.currentVersion?.id
        ? await extractionService.extractVersion(data.currentVersion.id)
        : null;
      const refreshed = extraction ? await getResourceByIdUseCase.execute(resourceId) : null;

      return res.status(201).json({ ok: true, data: refreshed ?? data, extraction });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create version body') : error);
    }
  }

  async uploadVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      if (!req.file) {
        return next(new ValidationAppError('PDF file is required in field "file"'));
      }

      assertPdfContent(req.file);

      const body = uploadResourceVersionBodySchema.parse(req.body);
      const data = await createResourceVersionUseCase.execute({
        resourceId,
        uploadedById: getAuthenticatedAdminId(req),
        version: {
          sourceType: 'UPLOAD',
          fileName: req.file.originalname,
          mimeType: req.file.mimetype || 'application/pdf',
          storageProvider: body.storageProvider,
          fileContentBase64: req.file.buffer.toString('base64'),
        },
      });

      const extraction = data.currentVersion?.id
        ? await extractionService.extractVersion(data.currentVersion.id)
        : null;
      const refreshed = await getResourceByIdUseCase.execute(resourceId);

      return res.status(201).json({
        ok: true,
        data: refreshed ?? data,
        extraction,
      });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid upload resource version body') : error);
    }
  }

  async downloadVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId, versionId } = resourceDownloadParamsSchema.parse(req.params);
      const download = await getResourceDownloadUseCase.execute(resourceId, versionId);

      if (!download) {
        return next(new NotFoundAppError('Resource version not found'));
      }

      if (download.sourceType === 'EXTERNAL_LINK') {
        return res.redirect(download.externalUrl!);
      }

      if (!download.storageKey) {
        return next(new NotFoundAppError('Resource file not available'));
      }

      const absolutePath = storageService.getAbsolutePath(download.storageKey);
      await access(absolutePath);

      if (download.mimeType) {
        res.setHeader('Content-Type', download.mimeType);
      }
      res.setHeader('Content-Disposition', `inline; filename="${download.fileName}"`);

      return res.sendFile(absolutePath);
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resource version id') : error);
    }
  }

  async extractVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId, versionId } = resourceDownloadParamsSchema.parse(req.params);
      const download = await getResourceDownloadUseCase.execute(resourceId, versionId);

      if (!download) {
        return next(new NotFoundAppError('Resource version not found'));
      }

      const extraction = await extractionService.extractVersion(versionId);
      const data = await getResourceByIdUseCase.execute(resourceId);

      return res.json({
        ok: true,
        data,
        extraction,
      });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resource version id') : error);
    }
  }

  async deleteResource(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      await deleteResourceUseCase.execute(resourceId);

      return res.status(204).send();
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resource id') : error);
    }
  }
}

export const resourcesController = new ResourcesController();
