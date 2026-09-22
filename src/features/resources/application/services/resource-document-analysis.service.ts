import { z } from 'zod';

import { ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { OpenAiResponsesClient } from '../../../concierge/infrastructure/clients/openai-response.js';

const analysisSchema = z.object({
  suggestedTitle: z.string().trim().max(255).nullable(),
  summary: z.string().trim().max(1500).nullable(),
  familyKey: z.enum(['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM', 'UNKNOWN']),
  countryCode: z.string().trim().length(2).nullable(),
  countryName: z.string().trim().max(120).nullable(),
  cities: z.array(z.string().trim().min(1).max(150)).max(50),
  validFrom: z.iso.date().nullable(),
  validUntil: z.iso.date().nullable(),
  minAge: z.number().int().min(0).max(120).nullable(),
  maxAge: z.number().int().min(0).max(120).nullable(),
  weekOptions: z.array(z.number().int().min(1).max(104)).max(52),
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
    familyKey: { type: 'string', enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM', 'UNKNOWN'] },
    countryCode: { type: ['string', 'null'] },
    countryName: { type: ['string', 'null'] },
    cities: { type: 'array', items: { type: 'string' } },
    validFrom: { type: ['string', 'null'] },
    validUntil: { type: ['string', 'null'] },
    minAge: { type: ['integer', 'null'] },
    maxAge: { type: ['integer', 'null'] },
    weekOptions: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 104 }, maxItems: 52 },
    priceFrom: { type: ['number', 'null'] },
    priceCurrency: { type: ['string', 'null'] },
    priceUnit: { type: ['string', 'null'] },
    priceNotes: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
  required: [
    'suggestedTitle', 'summary', 'familyKey', 'countryCode', 'countryName', 'cities',
    'validFrom', 'validUntil', 'minAge', 'maxAge', 'weekOptions', 'priceFrom', 'priceCurrency',
    'priceUnit', 'priceNotes', 'confidence',
  ],
} as const;

export class ResourceDocumentAnalysisService {
  constructor(private readonly responsesClient = new OpenAiResponsesClient({ timeoutMs: 120_000 })) {}

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
        'cities contiene ciudades o sedes del país del programa, sin duplicados.',
        'validFrom y validUntil usan YYYY-MM-DD y representan la vigencia real del folleto o sus fechas operativas globales.',
        'minAge y maxAge representan el rango global aceptado por el recurso.',
        'weekOptions contiene todas las duraciones explícitas disponibles expresadas en semanas. Convierte rangos como 2 a 8 semanas en [2,3,4,5,6,7,8]. No conviertas días o meses si la equivalencia no es explícita.',
        'priceFrom es el menor precio base explícito aplicable al programa; no sumes cargos ni conviertas monedas.',
        'priceCurrency debe ser un código ISO 4217 de tres letras. priceUnit debe ser una etiqueta breve como programa, semana o paquete.',
        'Solo conserva precio cuando el documento corresponda claramente a CAMP y sea un folleto. Para cualquier otro documento devuelve campos de precio en null.',
        'familyKey clasifica el documento como CAMP, LANGUAGE_COURSE, SCHOOL_PROGRAM o UNKNOWN.',
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

    const normalized = this.normalize(result.data);
    const isCampBrochure = normalized.familyKey === 'CAMP' && input.resourceType === 'BROCHURE';

    const hasCompletePrice = normalized.priceFrom != null && normalized.priceCurrency != null;

    return isCampBrochure && hasCompletePrice
      ? normalized
      : {
          ...normalized,
          priceFrom: null,
          priceCurrency: null,
          priceUnit: null,
          priceNotes: null,
        };
  }

  private normalize(value: ResourceDocumentAnalysis): ResourceDocumentAnalysis {
    const minAge = value.minAge;
    const maxAge = value.maxAge;
    const validFrom = value.validFrom;
    const validUntil = value.validUntil;

    return {
      ...value,
      countryCode: value.countryCode?.toUpperCase() ?? null,
      priceCurrency: value.priceCurrency?.toUpperCase() ?? null,
      cities: Array.from(new Set(value.cities.map((city) => city.trim()).filter(Boolean))),
      weekOptions: Array.from(new Set(value.weekOptions)).sort((left, right) => left - right),
      minAge: minAge != null && maxAge != null ? Math.min(minAge, maxAge) : minAge,
      maxAge: minAge != null && maxAge != null ? Math.max(minAge, maxAge) : maxAge,
      validFrom: validFrom && validUntil && validFrom > validUntil ? validUntil : validFrom,
      validUntil: validFrom && validUntil && validFrom > validUntil ? validFrom : validUntil,
    };
  }
}
