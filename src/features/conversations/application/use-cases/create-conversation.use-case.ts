import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import type { CreateConversationInput } from '../../domain/types/conversation.types.js';

export class CreateConversationUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  execute(input: CreateConversationInput) {
    return this.conversationRepository.create(input);
  }
}
