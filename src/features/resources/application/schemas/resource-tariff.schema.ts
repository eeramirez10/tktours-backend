import { z } from 'zod';

// The same schema is used for reviewed JSON and multipart form submissions.
export const resourceTariffSchema = z.object({
  kind: z.enum(['PACKAGE', 'EXTRA_WEEK']),
  weeks: z.number().int().min(1).max(104).nullable(),
  modality: z.string().trim().min(1).max(150),
  amount: z.number().finite().nonnegative().max(999_999_999.99),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  notes: z.string().trim().max(500).nullable(),
}).superRefine((value, ctx) => {
  if (value.kind === 'PACKAGE' && value.weeks == null) {
    ctx.addIssue({ code: 'custom', path: ['weeks'], message: 'Confirma las semanas del paquete.' });
  }
  if (value.kind === 'EXTRA_WEEK' && value.weeks != null) {
    ctx.addIssue({ code: 'custom', path: ['weeks'], message: 'Un cargo por semana adicional no es un paquete.' });
  }
});
