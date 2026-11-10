import { readFile, stat } from 'node:fs/promises';
import { NotFoundAppError, ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { ResourceRepository } from '../../infrastructure/repositories/resource.repository.js';
import { LocalResourceStorageService } from '../../infrastructure/storage/local-resource-storage.service.js';
import { ResourceDocumentAnalysisService } from './resource-document-analysis.service.js';

export class ResourceStoredDocumentAnalysisService {
  constructor(
    private readonly resources: Pick<ResourceRepository, 'findResourceById'> = new ResourceRepository(),
    private readonly storage = new LocalResourceStorageService(),
    private readonly analysis: Pick<ResourceDocumentAnalysisService, 'analyze'> = new ResourceDocumentAnalysisService(),
  ) {}

  async analyze(resourceId: string, context: { familyKey?: string; type: 'BROCHURE' | 'MANUAL' }) {
    const resource = await this.resources.findResourceById(resourceId);
    if (!resource) throw new NotFoundAppError('Resource not found');
    const version = resource.versions.find((item) => item.id === resource.currentVersion?.id);
    if (!version || version.sourceType !== 'UPLOAD' || !version.storageKey) {
      throw new ValidationAppError('Este recurso no tiene un PDF cargado para analizar.');
    }
    const path = this.storage.getAbsolutePath(version.storageKey);
    const file = await stat(path);
    if (file.size <= 0 || file.size > 25 * 1024 * 1024) throw new ValidationAppError('El PDF debe tener un tamaño de hasta 25 MB.');
    const content = await readFile(path);
    if (content.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ValidationAppError('El archivo guardado no es un PDF válido.');
    // Suggestions only: no new version, extraction write or metadata update occurs here.
    return this.analysis.analyze({ fileName: version.fileName, content, requestedFamilyKey: context.familyKey, resourceType: context.type });
  }
}
