import type { ConciergeTurnTraceRepository } from '../../domain/repositories/concierge-turn-trace.repository.js';

export class GetConciergeTurnTraceByIdUseCase {
  constructor(private readonly traceRepository: ConciergeTurnTraceRepository) {}

  execute(turnId: string) {
    return this.traceRepository.findTurnById(turnId);
  }
}
