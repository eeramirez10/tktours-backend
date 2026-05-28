import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { GetCatalogHealthUseCase } from '../../../application/use-cases/get-catalog-health.use-case.js';
import { GetCatalogProgramBySlugUseCase } from '../../../application/use-cases/get-catalog-program-by-slug.use-case.js';
import { ListCatalogCountriesUseCase } from '../../../application/use-cases/list-catalog-countries.use-case.js';
import { ListCatalogFamiliesUseCase } from '../../../application/use-cases/list-catalog-families.use-case.js';
import { ListCatalogProgramsUseCase } from '../../../application/use-cases/list-catalog-programs.use-case.js';
import { ListCatalogRecommendedProgramsUseCase } from '../../../application/use-cases/list-catalog-recommended-programs.use-case.js';
import { CatalogRepository } from '../../../infrastructure/repositories/catalog.repository.js';
import { catalogProgramSlugParamsSchema } from '../schemas/catalog-params.schemas.js';
import {
  listCatalogCollectionQuerySchema,
  listCatalogProgramsQuerySchema,
} from '../schemas/catalog-query.schemas.js';
import { listCatalogRecommendationsQuerySchema } from '../schemas/catalog-recommendations-query.schemas.js';

const catalogRepository = new CatalogRepository();
const getCatalogHealthUseCase = new GetCatalogHealthUseCase();
const listCatalogCountriesUseCase = new ListCatalogCountriesUseCase(catalogRepository);
const listCatalogFamiliesUseCase = new ListCatalogFamiliesUseCase(catalogRepository);
const listCatalogProgramsUseCase = new ListCatalogProgramsUseCase(catalogRepository);
const getCatalogProgramBySlugUseCase = new GetCatalogProgramBySlugUseCase(catalogRepository);
const listCatalogRecommendedProgramsUseCase = new ListCatalogRecommendedProgramsUseCase(catalogRepository);

function toValidationError(error: ZodError, message: string) {
  return new ValidationAppError(message, error.flatten());
}

export class CatalogController {
  getHealth(_req: Request, res: Response) {
    return res.json({ ok: true, data: getCatalogHealthUseCase.execute() });
  }

  async listCountries(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listCatalogCollectionQuerySchema.parse(req.query);
      const data = await listCatalogCountriesUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid countries query') : error);
    }
  }

  async listFamilies(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listCatalogCollectionQuerySchema.parse(req.query);
      const data = await listCatalogFamiliesUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid families query') : error);
    }
  }

  async listPrograms(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listCatalogProgramsQuerySchema.parse(req.query);
      const data = await listCatalogProgramsUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid programs query') : error);
    }
  }

  async getProgramBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = catalogProgramSlugParamsSchema.parse(req.params);
      const data = await getCatalogProgramBySlugUseCase.execute(slug);

      if (!data) {
        return next(new NotFoundAppError('Program not found'));
      }

      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid program slug') : error);
    }
  }

  async listRecommendedPrograms(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listCatalogRecommendationsQuerySchema.parse(req.query);
      const data = await listCatalogRecommendedProgramsUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid recommendations query') : error);
    }
  }
}

export const catalogController = new CatalogController();
