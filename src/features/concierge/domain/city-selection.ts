export type ConciergeCity = { slug: string; name: string };

export function normalizeCity(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function selectedCity(message: string, cities: ConciergeCity[], previousReply = ''): ConciergeCity | null {
  const value = normalizeCity(message).replace(/[.!]$/, '').replace(/,? por favor$/, '').trim();
  const numericChoice = value.match(/^(?:(?:la )?opcion |la )?(\d{1,2})[.)]?$/)?.[1];
  if (/actualmente tenemos programas en las siguientes ciudades/i.test(previousReply) && numericChoice) {
    return cities[Number(numericChoice) - 1] ?? null;
  }
  const name = value.replace(/^(?:quiero(?: ir a| ver| visitar)?|me gustaria(?: ir a| ver)?|elijo|prefiero|me interesa|la de|en)\s+/, '');
  return cities.find((city) => normalizeCity(city.name) === name || normalizeCity(city.slug) === name) ?? null;
}
