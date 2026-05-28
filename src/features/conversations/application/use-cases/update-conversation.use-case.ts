import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import type { UpdateConversationInput } from '../../domain/types/conversation.types.js';

export class UpdateConversationUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  execute(input: UpdateConversationInput) {
    return this.conversationRepository.update(input);
  }
}
