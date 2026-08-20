
export type ConciergeDetectedNeed =
  | 'CAMP'
  | 'LANGUAGE_COURSE'
  | 'SCHOOL_PROGRAM'
  | 'UNKNOWN';

export type ConciergeMissingField =
  | 'country'
  | 'studentAge'
  | 'residenceCountry'
  | 'cityOfResidence'
  | 'tripDays'
  | 'family'
  | 'program'
  | 'accommodation'
  | 'preferredStartMonth'
  | 'preferredStartYear'
  | 'weeks';

export type ConciergeStructuredResponse = {
  replyText: string;
  shouldAskFollowUp: boolean;
  detectedNeed: ConciergeDetectedNeed;
  missingFields: ConciergeMissingField[];
};
