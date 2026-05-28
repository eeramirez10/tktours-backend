import { access } from 'node:fs/promises';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { CreateResourceUseCase } from '../../../application/use-cases/create-resource.use-case.js';
import { CreateResourceVersionUseCase } from '../../../application/use-cases/create-resource-version.use-case.js';
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

const resourceRepository = new ResourceRepository();
const storageService = new LocalResourceStorageService();
const getResourcesHealthUseCase = new GetResourcesHealthUseCase();
const listResourcesUseCase = new ListResourcesUseCase(resourceRepository);
const getResourceByIdUseCase = new GetResourceByIdUseCase(resourceRepository);
const createResourceUseCase = new CreateResourceUseCase(resourceRepository);
const updateResourceUseCase = new UpdateResourceUseCase(resourceRepository);
const setResourceActiveUseCase = new SetResourceActiveUseCase(resourceRepository);
const createResourceVersionUseCase = new CreateResourceVersionUseCase(resourceRepository);
const getResourceDownloadUseCase = new GetResourceDownloadUseCase(resourceRepository);
const deleteResourceUseCase = new DeleteResourceUseCase(resourceRepository);

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

export class ResourcesController {
  getHealth(_req: Request, res: Response) {
    return res.json({
      ok: true,
      data: getResourcesHealthUseCase.execute(),
    });
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
      const data = await createResourceUseCase.execute(body);

      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create resource body') : error);
    }
  }

  async updateResource(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = updateResourceBodySchema.parse(req.body);
      const data = await updateResourceUseCase.execute({ resourceId, ...body });

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid update resource body') : error);
    }
  }

  async setActive(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = setResourceActiveBodySchema.parse(req.body);
      const data = await setResourceActiveUseCase.execute({ resourceId, ...body });

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid resource active body') : error);
    }
  }

  async createVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { resourceId } = resourceIdParamsSchema.parse(req.params);
      const body = createResourceVersionBodySchema.parse(req.body);
      const { uploadedById = null, ...version } = body;
      const data = await createResourceVersionUseCase.execute({
        resourceId,
        uploadedById,
        version,
      });

      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create version body') : error);
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
