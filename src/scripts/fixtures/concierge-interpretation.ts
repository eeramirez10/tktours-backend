import type { ConciergeMessageInterpretation } from '../../features/concierge/application/schemas/concierge-message-interpretation.schema.js';

export function interpretation(fields: Partial<ConciergeMessageInterpretation> = {}): ConciergeMessageInterpretation {
  return {
    intent: 'UNKNOWN', countryCode: null, locationSlug: null, programSlug: null, familyKey: null,
    studentAge: null, residenceCountry: null, cityOfResidence: null, tripDays: null,
    accommodationKey: null, preferredStartMonth: null, preferredStartYear: null,
    preferredStartUndecided: false, weeks: null, weeksUndecided: false,
    firstName: null, lastName: null, email: null, menuWasShown: true,
    asksAccommodationOptions: false, asksForCities: false, isQuestion: false,
    changesTopic: false, isNegativeProgramAnswer: false, handoffStep: 'none',
    brochureAction: 'UNKNOWN', selectedSeasonKeys: [], sendAllResources: false,
    requestsResource: false, maintainTravelMonth: false, priceQuestion: 'NONE', requestedTariffWeeks: null,
    needsClarification: false, clarificationQuestion: null, confidence: 0.99, ...fields,
  };
}
