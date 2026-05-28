import type { ConciergeTurnTraceRepository } from '../../domain/repositories/concierge-turn-trace.repository.js';
import type { ConciergeTurnTraceQuery } from '../../domain/types/concierge-turn-trace.types.js';

export class ListConciergeTurnTracesUseCase {
  constructor(private readonly traceRepository: ConciergeTurnTraceRepository) {}

  execute(query: ConciergeTurnTraceQuery) {
    return this.traceRepository.findTurns(query);
  }
}
