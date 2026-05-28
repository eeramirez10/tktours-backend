export type ConciergeToolName =
  | 'find_matching_programs'
  | 'get_program_detail'
  | 'update_inquiry'
  | 'detect_user_intent'
  | 'evaluate_policy_signals'
  | 'list_available_countries'
  | 'list_available_programs'
  | 'list_available_accommodations'
  | 'list_weeks_options'
  | 'extract_inquiry_fields';

export type FindMatchingProgramsArgs = {
  countryCode: string;
  familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';
  studentAge?: number;
  accommodationKey?: 'HOST_FAMILY' | 'UNIVERSITY_RESIDENCE' | 'SHARED_APARTMENT';
  preferredStartMonth?: number;
  weeks?: number;
  search?: string;
};

export type GetProgramDetailArgs = {
  slug: string;
};

export type ListAvailableCountriesArgs = {
  activeOnly?: boolean;
};

export type ListAvailableProgramsArgs = {
  countryCode?: string;
  familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';
  activeOnly?: boolean;
};

export type ListAvailableAccommodationsArgs = {
  countryCode?: string;
  familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';
  studentAge?: number;
  activeOnly?: boolean;
};

export type ListWeeksOptionsArgs = {
  countryCode?: string;
  familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';
  programSlug?: string;
};

export type DetectUserIntentArgs = {
  latestMessage: string;
  recentMessages?: Array<{
    direction?: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
    text?: string;
  }>;
};

export type EvaluatePolicySignalsArgs = {
  latestMessage: string;
  previousAssistantMessage?: string | null;
  recentMessages?: Array<{
    direction?: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
    text?: string;
  }>;
  inquirySnapshot?: {
    countryCode?: string | null;
    familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM' | null;
    studentAge?: number | null;
    contactLastName?: string | null;
    contactEmail?: string | null;
  } | null;
};

export type ExtractInquiryFieldsArgs = {
  latestMessage: string;
  previousAssistantMessage?: string | null;
  expectedField?:
    | 'country'
    | 'studentAge'
    | 'residenceCountry'
    | 'cityOfResidence'
    | 'family'
    | 'program'
    | 'accommodation'
    | 'preferredStartMonth'
    | 'preferredStartYear'
    | 'weeks'
    | null;
  recentMessages?: Array<{
    direction?: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
    text?: string;
  }>;
  inquirySnapshot?: {
    countryCode?: string | null;
    studentAge?: number | null;
    residenceCountry?: string | null;
    cityOfResidence?: string | null;
    familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM' | null;
    accommodationKey?: 'HOST_FAMILY' | 'UNIVERSITY_RESIDENCE' | 'SHARED_APARTMENT' | null;
    preferredStartMonth?: number | null;
    preferredStartYear?: number | null;
    preferredStartStatus?: 'DEFINED' | 'UNDECIDED' | null;
    weeks?: number | null;
    weeksStatus?: 'DEFINED' | 'UNDECIDED' | null;
  } | null;
  nowIso?: string;
};

export type UpdateInquiryArgs = {
  inquiryId: string;
  countryCode?: string | null;
  familyKey?: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM' | null;
  programSlug?: string | null;
  studentAge?: number | null;
  cityOfResidence?: string | null;
  preferredStartMonth?: number | null;
  preferredStartYear?: number | null;
  accommodationKey?: 'HOST_FAMILY' | 'UNIVERSITY_RESIDENCE' | 'SHARED_APARTMENT' | null;
  weeks?: number | null;
  notes?: string | null;
};
