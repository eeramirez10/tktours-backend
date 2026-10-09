import { Prisma } from '@prisma/client';
import { ConflictAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { canonicalConciergeFamily } from '../../domain/concierge-families.js';

// Canonical menu keys must reference the same rows used by catalog programs and PDFs.
export async function resolveConciergeFamily(key: string, database = prisma): Promise<{ id: string } | null> {
  const definition = canonicalConciergeFamily(key);
  const lookupKey = definition?.key ?? key;
  const existing = await database.productFamily.findUnique({ where: { key: lookupKey }, select: { id: true } });
  if (existing || !definition) return existing;

  const families = await database.productFamily.findMany({ select: { id: true, key: true, name: true } });
  const matches = families.filter((family) => (canonicalConciergeFamily(family.key)
    ?? canonicalConciergeFamily(family.name))?.key === definition.key);
  if (matches.length > 1) {
    throw new ConflictAppError('Hay familias equivalentes pendientes de unificar. Aplica las migraciones del catálogo.');
  }
  if (matches[0]) {
    try {
      return await database.productFamily.update({ where: { id: matches[0].id }, data: { key: definition.key }, select: { id: true } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const resolved = await database.productFamily.findUnique({ where: { key: definition.key }, select: { id: true } });
      if (resolved) return resolved;
      throw error;
    }
  }

  // Only the three built-in menu families may be created; arbitrary keys never are.
  return database.productFamily.upsert({
    where: { key: definition.key }, update: {},
    create: { key: definition.key, name: definition.name, active: true }, select: { id: true },
  });
}
