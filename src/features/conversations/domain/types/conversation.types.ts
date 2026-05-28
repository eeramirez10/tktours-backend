export type ConversationChannel = 'WHATSAPP' | 'WEB' | 'EMAIL';

export type ConversationStatusKey = 'OPEN' | 'PAUSED' | 'CLOSED' | 'ARCHIVED';

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
};

export type ConversationInquirySummary = {
  id: string;
  status: string;
  studentAge: number | null;
  countryName: string | null;
  familyName: string | null;
  programName: string | null;
  createdAt: Date;
};

export type ConversationMessageItem = {
  id: string;
  direction: MessageDirectionKey;
  text: string;
  mediaUrl: string | null;
  providerMessageId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

export type ConversationListItem = {
  id: string;
  channel: ConversationChannel;
  status: ConversationStatusKey;
  currentStage: ConversationStageKey;
  lastMessageAt: Date | null;
  contextJson: Record<string, unknown> | null;
  contact: ConversationContactSummary | null;
  inquiriesCount: number;
  messagesCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationDetail = ConversationListItem & {
  inquiries: ConversationInquirySummary[];
  messages: ConversationMessageItem[];
};
