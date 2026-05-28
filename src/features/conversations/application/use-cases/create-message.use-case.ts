import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import type { CreateMessageInput } from '../../domain/types/conversation.types.js';

export class CreateMessageUseCase {
  constructor(private readonly conversationRepository: ConversationRepository) {}

  execute(input: CreateMessageInput) {
    return this.conversationRepository.createMessage(input);
  }
}
