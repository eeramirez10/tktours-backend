import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { accommodationPreferences } from '../../domain/accommodation-preferences.js';

export async function resolveAccommodationPreference(key: string, database = prisma): Promise<{ id: string } | null> {
  if (!Object.hasOwn(accommodationPreferences, key)) return null;
  const preferenceKey = key as keyof typeof accommodationPreferences;
  // This reference records the customer's preference; it does not create program availability.
  return database.accommodationType.upsert({
    where: { key: preferenceKey },
    update: {},
    create: { key: preferenceKey, name: accommodationPreferences[preferenceKey], active: true },
    select: { id: true },
  });
}
