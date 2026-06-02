export type InquiryStatusKey =
  | 'OPEN'
  | 'QUALIFYING'
  | 'READY_TO_RECOMMEND'
  | 'RECOMMENDED'
  | 'WAITING_HUMAN'
  | 'CLOSED';

export type InquiryFamilyKey = 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM';

export type InquiryAccommodationKey = 'HOST_FAMILY' | 'UNIVERSITY_RESIDENCE' | 'SHARED_APARTMENT';

export type InquiryChannel = 'WHATSAPP' | 'WEB' | 'EMAIL';

export type InquiriesHealth = {
  feature: 'inquiries';
  ready: boolean;
};

export type ListInquiriesQuery = {
  status?: InquiryStatusKey;
  countryCode?: string;
  familyKey?: InquiryFamilyKey;
  search?: string;
};

export type CreateInquiryContactInput = {
  waId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  notes?: string | null;
};

export type CreateInquiryInput = {
  conversationId?: string;
  contactId?: string;
  contact?: CreateInquiryContactInput;
  channel?: InquiryChannel;
  countryCode?: string;
  familyKey?: InquiryFamilyKey;
  locationSlug?: string;
  programSlug?: string;
  studentAge?: number | null;
  cityOfResidence?: string | null;
  preferredStartMonth?: number | null;
  preferredStartYear?: number | null;
  accommodationKey?: InquiryAccommodationKey;
  weeks?: number | null;
  notes?: string | null;
  qualificationJson?: Record<string, unknown> | null;
  status?: InquiryStatusKey;
};

export type UpdateInquiryInput = {
  inquiryId: string;
  countryCode?: string | null;
  familyKey?: InquiryFamilyKey | null;
  locationSlug?: string | null;
  programSlug?: string | null;
  studentAge?: number | null;
  cityOfResidence?: string | null;
  preferredStartMonth?: number | null;
  preferredStartYear?: number | null;
  accommodationKey?: InquiryAccommodationKey | null;
  weeks?: number | null;
  notes?: string | null;
  qualificationJson?: Record<string, unknown> | null;
};

export type UpdateInquiryStatusInput = {
  inquiryId: string;
  status: InquiryStatusKey;
};

export type InquiryContactSummary = {
  id: string;
  waId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
};

export type InquiryConversationSummary = {
  id: string;
  channel: InquiryChannel;
  status: string;
  currentStage: string;
  lastMessageAt: Date | null;
};

export type InquiryLookupSummary = {
  id: string;
  code?: string;
  key?: string;
  slug?: string;
  name: string;
};

export type InquiryRecommendationItem = {
  id: string;
  reason: string | null;
  confidence: number | null;
  program: InquiryLookupSummary;
  resource: InquiryLookupSummary | null;
  createdAt: Date;
};

export type InquiryResourceSendItem = {
  id: string;
  sentReason: string | null;
  sentAt: Date;
  resource: InquiryLookupSummary;
  resourceVersionId: string | null;
};

export type InquiryListItem = {
  id: string;
  status: InquiryStatusKey;
  studentAge: number | null;
  cityOfResidence: string | null;
  preferredStartMonth: number | null;
  preferredStartYear: number | null;
  weeks: number | null;
  notes: string | null;
  country: InquiryLookupSummary | null;
  family: InquiryLookupSummary | null;
  location: (InquiryLookupSummary & { venueName?: string | null }) | null;
  program: InquiryLookupSummary | null;
  accommodationType: InquiryLookupSummary | null;
  contact: InquiryContactSummary | null;
  conversation: InquiryConversationSummary;
  recommendationsCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type InquiryDetail = InquiryListItem & {
  qualificationJson: Record<string, unknown> | null;
  recommendations: InquiryRecommendationItem[];
  resourceSends: InquiryResourceSendItem[];
};
