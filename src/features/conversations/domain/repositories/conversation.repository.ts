import type {
  ConversationDetail,
  ConversationListItem,
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  UpdateConversationInput,
} from '../types/conversation.types.js';

export interface ConversationRepository {
  findMany(query: ListConversationsQuery): Promise<ConversationListItem[]>;
  findById(conversationId: string): Promise<ConversationDetail | null>;
  create(input: CreateConversationInput): Promise<ConversationDetail>;
  update(input: UpdateConversationInput): Promise<ConversationDetail>;
  createMessage(input: CreateMessageInput): Promise<ConversationDetail>;
}
