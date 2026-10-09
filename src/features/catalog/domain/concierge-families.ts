export const conciergeFamilies = [
  { key: 'LANGUAGE_COURSE', name: 'Cursos de idiomas', aliases: ['LANGUAGE_COURSE', 'LANGUAGE_COURSES', 'CURSO_DE_IDIOMAS', 'CURSOS_DE_IDIOMAS', 'CURSO_IDIOMAS', 'CURSOS_IDIOMAS', 'IDIOMAS'] },
  { key: 'CAMP', name: 'Campamentos / viajes', aliases: ['CAMP', 'CAMPS', 'CAMPAMENTO', 'CAMPAMENTOS', 'CAMPAMENTOS_VIAJES', 'CAMPAMENTOS_Y_VIAJES'] },
  { key: 'SCHOOL_PROGRAM', name: 'Circuitos por el mundo', aliases: ['SCHOOL_PROGRAM', 'CIRCUITOS_POR_EL_MUNDO', 'CIRCUITOS', 'TOURS', 'TOUR'] },
] as const;

export function normalizedFamilyKey(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
}

export function canonicalConciergeFamily(value: string) {
  const normalized = normalizedFamilyKey(value);
  return conciergeFamilies.find((family) => (family.aliases as readonly string[]).includes(normalized)) ?? null;
}
