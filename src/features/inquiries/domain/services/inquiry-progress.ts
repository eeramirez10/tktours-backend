import type { InquiryStatusKey } from '../types/inquiry.types.js';

export type ProgressInquiry = {
  id: string; status?: string; studentAge: number | null; preferredStartMonth: number | null;
  preferredStartYear?: number | null; weeks: number | null; cityOfResidence?: string | null;
  qualificationJson: Record<string, unknown> | null;
  country: { code?: string } | null; family: { key?: string } | null;
  location?: { slug?: string } | null; program?: { slug?: string } | null;
  accommodationType?: { key?: string } | null;
  contact?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
};
export type InquiryProgress = {
  answered: number; total: number; percent: number; missingFields: string[];
  readyToSearch: boolean; captureComplete: boolean; recommendationConfirmed: boolean;
  preferenceConflict: boolean;
};
export const progressFieldLabels: Record<string, string> = {
  family: 'Familia', country: 'Destino', studentAge: 'Edad', residenceCountry: 'País de residencia',
  preferredStartMonth: 'Mes de inicio', weeks: 'Semanas', contactName: 'Nombre completo',
  contactEmail: 'Correo', tripDays: 'Días de viaje',
};
export function recommendationCriteria(inquiry: ProgressInquiry) {
  return { inquiryId: inquiry.id, country: inquiry.country?.code ?? null, family: inquiry.family?.key ?? null,
    city: inquiry.location?.slug ?? null, program: inquiry.program?.slug ?? null, age: inquiry.studentAge,
    month: inquiry.preferredStartMonth, year: inquiry.preferredStartYear ?? null, weeks: inquiry.weeks,
    accommodation: inquiry.accommodationType?.key ?? null,
    tripDays: inquiry.qualificationJson?.requestMode === 'CIRCUITS' ? inquiry.qualificationJson.tripDays ?? null : null };
}
export function inquiryProgress(inquiry: ProgressInquiry, recommendation?: unknown): InquiryProgress {
  const q = inquiry.qualificationJson ?? {};
  const circuits = inquiry.family?.key === 'SCHOOL_PROGRAM' && q.requestMode === 'CIRCUITS';
  const contact = inquiry.contact;
  const name = Boolean(contact?.firstName?.trim() && (contact.lastName?.trim() || contact.firstName.trim().includes(' ')));
  const fields: Record<string, boolean> = circuits
    ? { family: !!inquiry.family?.key, country: !!inquiry.country?.code, tripDays: typeof q.tripDays === 'number' && q.tripDays > 0 }
    : { family: !!inquiry.family?.key, country: !!inquiry.country?.code, studentAge: inquiry.studentAge != null,
      residenceCountry: typeof q.residenceCountry === 'string' && !!q.residenceCountry.trim(),
      preferredStartMonth: inquiry.preferredStartMonth != null || q.preferredStartStatus === 'UNDECIDED',
      weeks: inquiry.weeks != null || q.weeksStatus === 'UNDECIDED', contactName: name, contactEmail: !!contact?.email?.trim() };
  const orderedKeys = inquiry.family?.key === 'CAMP' ? ['family', 'studentAge', 'country', 'residenceCountry', 'preferredStartMonth', 'weeks', 'contactName', 'contactEmail'] : Object.keys(fields);
  const missingFields = orderedKeys.filter((key) => !fields[key]);
  const r = recommendation as { criteria?: Record<string, unknown>; status?: string; resourceIds?: unknown[]; presentedAt?: string } | null;
  const criteria = recommendationCriteria(inquiry);
  const same = !!r?.criteria && Object.entries(criteria).every(([key, value]) => (r.criteria![key] ?? null) === value);
  const recommendationConfirmed = same && r?.status === 'CONFIRMED' && !!r.presentedAt && !!r.resourceIds?.length
    && (circuits || (inquiry.preferredStartMonth != null && inquiry.weeks != null));
  const total = Object.keys(fields).length;
  return { answered: total - missingFields.length, total, percent: Math.round((total - missingFields.length) * 100 / total),
    missingFields, readyToSearch: !missingFields.some((key) => !['contactName', 'contactEmail'].includes(key)),
    captureComplete: missingFields.length === 0, recommendationConfirmed,
    preferenceConflict: same && (r?.status === 'NONE' || r?.status === 'UNCONFIRMED') };
}
export function nextInquiryStatus(inquiry: ProgressInquiry, recommendation?: unknown,
  events: { handoffConfirmed?: boolean; explicitlyClosed?: boolean } = {}): InquiryStatusKey {
  if (events.explicitlyClosed || inquiry.status === 'CLOSED') return 'CLOSED';
  if (inquiry.status === 'WAITING_HUMAN') return 'WAITING_HUMAN';
  const progress = inquiryProgress(inquiry, recommendation);
  if (events.handoffConfirmed && progress.captureComplete) return 'WAITING_HUMAN';
  if (progress.recommendationConfirmed) return 'RECOMMENDED';
  if (progress.preferenceConflict) return 'QUALIFYING';
  if (progress.readyToSearch) return 'READY_TO_RECOMMEND';
  return progress.answered > 0 ? 'QUALIFYING' : 'OPEN';
}
