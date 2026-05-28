import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import type { ListConversationsQuery } from '../../domain/types/conversation.types.js';

export class ListConversationsUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  execute(query: ListConversationsQuery) {
    return this.conversationRepository.findMany(query);
  }
}
