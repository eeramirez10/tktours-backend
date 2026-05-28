import type { ConversationsHealth } from '../../domain/types/conversation.types.js';

export class GetConversationsHealthUseCase {
  execute(): ConversationsHealth {
    return { feature: 'conversations', ready: true };
  }
}
