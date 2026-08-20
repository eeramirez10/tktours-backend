import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { NotFoundAppError, ValidationAppError } from '../../../../../shared/domain/errors/app-error.js';
import { GetCatalogHealthUseCase } from '../../../application/use-cases/get-catalog-health.use-case.js';
import { GetCatalogProgramBySlugUseCase } from '../../../application/use-cases/get-catalog-program-by-slug.use-case.js';
import { ListCatalogCountriesUseCase } from '../../../application/use-cases/list-catalog-countries.use-case.js';
import { ListCatalogFamiliesUseCase } from '../../../application/use-cases/list-catalog-families.use-case.js';
import { ListCatalogLocationsUseCase } from '../../../application/use-cases/list-catalog-locations.use-case.js';
import { ListCatalogProgramsUseCase } from '../../../application/use-cases/list-catalog-programs.use-case.js';
import { ListCatalogRecommendedProgramsUseCase } from '../../../application/use-cases/list-catalog-recommended-programs.use-case.js';
import { CatalogRepository } from '../../../infrastructure/repositories/catalog.repository.js';
import {
  catalogCountryIdParamsSchema,
  catalogLocationIdParamsSchema,
  catalogProgramSlugParamsSchema,
} from '../schemas/catalog-params.schemas.js';
import {
  createCatalogCountryBodySchema,
  createCatalogLocationBodySchema,
  updateCatalogCountryBodySchema,
  updateCatalogLocationBodySchema,
} from '../schemas/catalog-admin.schemas.js';
import {
  listCatalogCollectionQuerySchema,
  listCatalogLocationsQuerySchema,
  listCatalogProgramsQuerySchema,
} from '../schemas/catalog-query.schemas.js';
import { listCatalogRecommendationsQuerySchema } from '../schemas/catalog-recommendations-query.schemas.js';

const catalogRepository = new CatalogRepository();
const getCatalogHealthUseCase = new GetCatalogHealthUseCase();
const listCatalogCountriesUseCase = new ListCatalogCountriesUseCase(catalogRepository);
const listCatalogFamiliesUseCase = new ListCatalogFamiliesUseCase(catalogRepository);
const listCatalogLocationsUseCase = new ListCatalogLocationsUseCase(catalogRepository);
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

  async createCountry(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createCatalogCountryBodySchema.parse(req.body);
      const data = await catalogRepository.createCountry(body);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create country body') : error);
    }
  }

  async updateCountry(req: Request, res: Response, next: NextFunction) {
    try {
      const { countryId } = catalogCountryIdParamsSchema.parse(req.params);
      const body = updateCatalogCountryBodySchema.parse(req.body);
      const data = await catalogRepository.updateCountry({ countryId, ...body });
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid update country body') : error);
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

  async listLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listCatalogLocationsQuerySchema.parse(req.query);
      const data = await listCatalogLocationsUseCase.execute(query);
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid locations query') : error);
    }
  }

  async createLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const body = createCatalogLocationBodySchema.parse(req.body);
      const data = await catalogRepository.createLocation(body);
      return res.status(201).json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid create location body') : error);
    }
  }

  async updateLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const { locationId } = catalogLocationIdParamsSchema.parse(req.params);
      const body = updateCatalogLocationBodySchema.parse(req.body);
      const data = await catalogRepository.updateLocation({ locationId, ...body });
      return res.json({ ok: true, data });
    } catch (error) {
      return next(error instanceof ZodError ? toValidationError(error, 'Invalid update location body') : error);
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
