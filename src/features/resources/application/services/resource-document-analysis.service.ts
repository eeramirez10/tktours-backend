import { z } from 'zod';

import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { logger } from '../../../../shared/config/logger.js';
import { GeoReferenceService } from '../../../catalog/application/services/geo-reference.service.js';
import { OpenAiResponsesClient } from '../../../concierge/infrastructure/clients/openai-response.js';

const analysisSchema = z.object({
  suggestedTitle: z.string().trim().max(255).nullable(),
  summary: z.string().trim().max(1500).nullable(),
  countryCode: z.string().trim().length(2).nullable(),
  countryName: z.string().trim().max(120).nullable(),
  cities: z.array(z.string().trim().min(1).max(150)).max(50),
  year: z.number().int().min(2000).max(2100).nullable().default(null),
  shareFrom: z.iso.date().nullable().default(null),
  shareUntil: z.iso.date().nullable().default(null),
  validFrom: z.iso.date().nullable(),
  validUntil: z.iso.date().nullable(),
  minAge: z.number().int().min(0).max(120).nullable(),
  maxAge: z.number().int().min(0).max(120).nullable(),
  minWeeks: z.number().int().min(1).max(104).nullable(),
  maxWeeks: z.number().int().min(1).max(104).nullable(),
  priceFrom: z.number().finite().nonnegative().nullable(),
  priceCurrency: z.string().trim().length(3).nullable(),
  priceUnit: z.string().trim().max(40).nullable(),
  priceNotes: z.string().trim().max(500).nullable(),
  confidence: z.number().min(0).max(1),
});

export type ResourceDocumentAnalysis = z.infer<typeof analysisSchema>;

const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suggestedTitle: { type: ['string', 'null'] },
    summary: { type: ['string', 'null'] },
    countryCode: { type: ['string', 'null'] },
    countryName: { type: ['string', 'null'] },
    cities: { type: 'array', items: { type: 'string' } },
    year: { type: ['integer', 'null'] },
    shareFrom: { type: ['string', 'null'] },
    shareUntil: { type: ['string', 'null'] },
    validFrom: { type: ['string', 'null'] },
    validUntil: { type: ['string', 'null'] },
    minAge: { type: ['integer', 'null'] },
    maxAge: { type: ['integer', 'null'] },
    minWeeks: { type: ['integer', 'null'], minimum: 1, maximum: 104 },
    maxWeeks: { type: ['integer', 'null'], minimum: 1, maximum: 104 },
    priceFrom: { type: ['number', 'null'] },
    priceCurrency: { type: ['string', 'null'] },
    priceUnit: { type: ['string', 'null'] },
    priceNotes: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: [
    'suggestedTitle', 'summary', 'countryCode', 'countryName', 'cities',
    'year', 'shareFrom', 'shareUntil', 'validFrom', 'validUntil', 'minAge', 'maxAge', 'minWeeks', 'maxWeeks', 'priceFrom', 'priceCurrency',
    'priceUnit', 'priceNotes', 'confidence',
  ],
} as const;

export class ResourceDocumentAnalysisService {
  constructor(
    private readonly responsesClient: Pick<OpenAiResponsesClient, 'createTextResponse'> = new OpenAiResponsesClient({ timeoutMs: 120_000 }),
    private readonly geoReference: Pick<GeoReferenceService, 'listCountries'> = new GeoReferenceService(),
  ) {}

  async analyze(input: {
    fileName: string;
    content: Buffer;
    requestedFamilyKey?: string;
    resourceType: 'BROCHURE' | 'MANUAL';
  }): Promise<ResourceDocumentAnalysis> {
    const response = await this.responsesClient.createTextResponse({
      instructions: [
        'Analiza el PDF de TKTours y devuelve exclusivamente los datos que estén explícitamente respaldados por el documento.',
        'No inventes fechas, edades, destinos ni precios. Usa null o una lista vacía cuando un dato no sea claro.',
        'countryCode debe ser ISO 3166-1 alpha-2 en mayúsculas.',
        'cities contiene únicamente los nombres de las ciudades del destino, sin duplicados, escuelas, instalaciones ni prefijos descriptivos. Por ejemplo, devuelve "Quebec", no "Ciudad de Quebec". Conserva nombres oficiales como "Ciudad de México" o "Ciudad del Carmen".',
        'year es la edición del viaje explícita en el documento, no el año actual. Si hay varios años o no es claro, devuelve null.',
        'validFrom y validUntil usan YYYY-MM-DD y representan exclusivamente las fechas operativas del viaje o campamento.',
        'shareFrom y shareUntil son las fechas explícitas de autorización para compartir/ofertar el folleto o vigencia comercial de sus precios. Nunca uses las fechas del viaje como vigencia comercial. Si no figuran, devuelve null; el administrador las capturará.',
        'minAge y maxAge representan el rango global aceptado por el recurso.',
        'minWeeks y maxWeeks representan el rango global de duración explícito en semanas. Para "2 a 8 semanas" devuelve 2 y 8; para una duración única devuelve el mismo valor en ambos campos. No conviertas días o meses si la equivalencia no es explícita.',
        'priceFrom es el menor precio base explícito aplicable al programa; no sumes cargos ni conviertas monedas.',
        'Si el precio no figura en el PDF, devuelve priceFrom, priceCurrency, priceUnit y priceNotes como null. Si figura solo parte de esta información, conserva lo explícito y devuelve null para lo ausente.',
        'priceCurrency debe ser un código ISO 4217 de tres letras cuando la moneda sea identificable. priceUnit debe ser una etiqueta breve como programa, semana o paquete cuando el PDF la indique.',
        'Extrae los datos de precio explícitos cuando resourceType sea BROCHURE, aunque requestedFamilyKey todavía no esté seleccionada. Para MANUAL devuelve todos los campos de precio en null.',
        'No clasifiques ni devuelvas la familia o el programa; esos datos serán seleccionados manualmente por el usuario.',
        'suggestedTitle debe ser breve y útil para identificar el recurso. summary debe resumir el contenido en español.',
      ].join('\n'),
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_file',
            filename: input.fileName,
            file_data: `data:application/pdf;base64,${input.content.toString('base64')}`,
          },
          {
            type: 'input_text',
            text: JSON.stringify({
              requestedFamilyKey: input.requestedFamilyKey ?? null,
              resourceType: input.resourceType,
            }),
          },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'resource_document_analysis',
          strict: true,
          schema: analysisJsonSchema,
        },
      },
      timeoutMs: 120_000,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.outputText);
    } catch {
      throw new ValidationAppError('OpenAI did not return valid resource analysis JSON');
    }

    const result = analysisSchema.safeParse(parsed);
    if (!result.success) {
      throw new ValidationAppError('OpenAI resource analysis has an invalid shape', result.error.flatten());
    }

    const normalized = await this.resolveCountry(this.normalize(result.data));
    return input.resourceType === 'BROCHURE'
      ? normalized
      : {
          ...normalized,
          priceFrom: null,
          priceCurrency: null,
          priceUnit: null,
          priceNotes: null,
        };
  }

  private async resolveCountry(value: ResourceDocumentAnalysis): Promise<ResourceDocumentAnalysis> {
    if (!value.countryCode && !value.countryName) return value;
    try {
      const countries = await this.geoReference.listCountries();
      const name = normalizeDestinationName(value.countryName ?? '');
      const match = (name ? countries.find((country) =>
        [country.name, country.providerName, country.code, country.iso3]
          .some((label) => normalizeDestinationName(label) === name),
      ) : undefined) ?? countries.find((country) => country.code === value.countryCode);
      if (match) return { ...value, countryCode: match.code, countryName: match.name };
    } catch (error) {
      logger.warn({ err: error }, 'No se pudo contrastar el país del PDF con el catálogo geográfico');
    }
    // Preserve the detected name for manual entry, without presenting an unverified ISO code.
    return value.countryName ? { ...value, countryCode: null } : { ...value, countryCode: null, countryName: null };
  }

  private normalize(value: ResourceDocumentAnalysis): ResourceDocumentAnalysis {
    const minAge = value.minAge;
    const maxAge = value.maxAge;
    const minWeeks = value.minWeeks;
    const maxWeeks = value.maxWeeks;
    const validFrom = value.validFrom;
    const validUntil = value.validUntil;

    return {
      ...value,
      countryCode: value.countryCode?.toUpperCase() ?? null,
      priceCurrency: value.priceCurrency?.toUpperCase() ?? null,
      cities: [...new Map(value.cities.map(cleanDetectedCityName).filter(Boolean)
        .map((city) => [normalizeDestinationName(city), city] as const)).values()],
      minWeeks: minWeeks != null && maxWeeks != null ? Math.min(minWeeks, maxWeeks) : minWeeks,
      maxWeeks: minWeeks != null && maxWeeks != null ? Math.max(minWeeks, maxWeeks) : maxWeeks,
      minAge: minAge != null && maxAge != null ? Math.min(minAge, maxAge) : minAge,
      maxAge: minAge != null && maxAge != null ? Math.max(minAge, maxAge) : maxAge,
      validFrom: validFrom && validUntil && validFrom > validUntil ? validUntil : validFrom,
      validUntil: validFrom && validUntil && validFrom > validUntil ? validFrom : validUntil,
    };
  }
}

function normalizeDestinationName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanDetectedCityName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (normalizeDestinationName(name) === 'ciudad de mexico') return name;
  if (/^qu[eé]bec\s+city$/iu.test(name)) return name.replace(/\s+city$/iu, '');
  return name.replace(/^(?:la\s+)?ciudad\s+de\s+|^(?:the\s+)?city\s+of\s+/iu, '').trim();
}
