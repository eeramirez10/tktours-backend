import type { InquiryProgress } from '../../../inquiries/domain/services/inquiry-progress.js';
import type { InquiryStatusKey } from '../../../inquiries/domain/types/inquiry.types.js';
export type ConversationChannel = 'WHATSAPP' | 'WEB' | 'EMAIL';

export type ConversationStatusKey = 'OPEN' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';

export type ConversationControlModeKey = 'AI' | 'HUMAN';

export type ConversationStageKey =
  | 'START'
  | 'QUALIFY_AGE'
  | 'QUALIFY_COUNTRY'
  | 'QUALIFY_PROGRAM'
  | 'QUALIFY_ACCOMMODATION'
  | 'QUALIFY_DATES'
  | 'RECOMMEND'
  | 'SEND_RESOURCE'
  | 'ESCALATED'
  | 'CLOSED';

export type MessageDirectionKey = 'INBOUND' | 'OUTBOUND' | 'SYSTEM';

export type ConversationsHealth = {
  feature: 'conversations';
  ready: boolean;
};

export type ListConversationsQuery = {
  status?: ConversationStatusKey;
  inquiryStatus?: InquiryStatusKey;
  channel?: ConversationChannel;
  contactId?: string;
  search?: string;
};

export type CreateConversationInput = {
  contactId?: string;
  channel?: ConversationChannel;
  status?: ConversationStatusKey;
  currentStage?: ConversationStageKey;
  contextJson?: Record<string, unknown> | null;
};

export type UpdateConversationInput = {
  conversationId: string;
  status?: ConversationStatusKey;
  currentStage?: ConversationStageKey;
  contextJson?: Record<string, unknown> | null;
  lastMessageAt?: string | null;
};

export type SetConversationControlModeInput = {
  conversationId: string;
  controlMode: ConversationControlModeKey;
};

export type CreateMessageInput = {
  conversationId: string;
  direction: MessageDirectionKey;
  text: string;
  mediaUrl?: string | null;
  providerMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ConversationContactSummary = {
  id: string;
  waId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  notes?: string | null;
};

export type ConversationInquirySummary = {
  id: string;
  status: InquiryStatusKey;
  progress: InquiryProgress;
  preferredStartStatus: 'DEFINED' | 'UNDECIDED' | null;
  weeksStatus: 'DEFINED' | 'UNDECIDED' | null;
  tripDays: number | null;
  updatedAt: Date;
  studentAge: number | null;
  residenceCountry: string | null;
  cityOfResidence: string | null;
  countryName: string | null;
  familyName: string | null;
  locationName: string | null;
  programName: string | null;
  accommodationName: string | null;
  preferredStartMonth: number | null;
  preferredStartYear: number | null;
  weeks: number | null;
  notes: string | null;
  createdAt: Date;
};

export type ConversationMessageItem = {
  id: string;
  direction: MessageDirectionKey;
  text: string;
  mediaUrl: string | null;
  providerMessageId: string | null;
  metadata: Record<string, unknown> | null;
  readByAdminAt: Date | null;
  notificationSeenAt: Date | null;
  createdAt: Date;
};

export type ConversationListItem = {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatusKey;
  controlMode: ConversationControlModeKey;
  isConciergeProcessing: boolean;
  currentStage: ConversationStageKey;
  lastMessageAt: Date | null;
  contextJson: Record<string, unknown> | null;
  contact: ConversationContactSummary | null;
  currentInquiry?: ConversationInquirySummary | null;
  inquiriesCount: number;
  messagesCount: number;
  unreadMessagesCount: number;
  unseenNotificationsCount: number;
  latestMessage: ConversationMessageItem | null;
  latestUnreadMessage: ConversationMessageItem | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationRecommendation = {
  id: string; title: string; reason: string | null; criteria: Record<string, unknown> | null;
  createdAt: Date; status: string;
};
export type ConversationFile = {
  id: string; title: string; fileName: string | null; versionId: string | null; versionNumber: number | null;
  url: string | null; createdAt: Date; deliveryStatus: string; delivered: boolean;
};
export type PersistConciergeOutcomeInput = {
  conversationId: string; inquiryId: string | null; inquiryStatus: InquiryStatusKey | null;
  nextStage: ConversationStageKey | null; explicitlyClosed: boolean; contextJson: Record<string, unknown>;
  replyText: string; mediaUrl: string | null; metadata: Record<string, unknown>;
};
export type ConversationDetail = ConversationListItem & {
  inquiries: ConversationInquirySummary[];
  recommendations: ConversationRecommendation[];
  files: ConversationFile[];
  messages: ConversationMessageItem[];
};
