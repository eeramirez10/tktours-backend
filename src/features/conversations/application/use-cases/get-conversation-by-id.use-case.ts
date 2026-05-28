import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';

export class GetConversationByIdUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  execute(conversationId: string) {
    return this.conversationRepository.findById(conversationId);
  }
}
