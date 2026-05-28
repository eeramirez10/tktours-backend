import type {
  CompleteConciergeToolCallTraceInput,
  CompleteConciergeTurnTraceInput,
  ConciergeTurnTraceDetail,
  ConciergeTurnTraceListItem,
  ConciergeTurnTraceQuery,
  CreateConciergeToolCallTraceInput,
  CreateConciergeTurnTraceInput,
  FailConciergeToolCallTraceInput,
  FailConciergeTurnTraceInput,
} from '../types/concierge-turn-trace.types.js';

export interface ConciergeTurnTraceRepository {
  createTurn(input: CreateConciergeTurnTraceInput): Promise<{ id: string }>;
  completeTurn(input: CompleteConciergeTurnTraceInput): Promise<void>;
  failTurn(input: FailConciergeTurnTraceInput): Promise<void>;
  createToolCall(input: CreateConciergeToolCallTraceInput): Promise<void>;
  completeToolCall(input: CompleteConciergeToolCallTraceInput): Promise<void>;
  failToolCall(input: FailConciergeToolCallTraceInput): Promise<void>;
  findTurns(query: ConciergeTurnTraceQuery): Promise<ConciergeTurnTraceListItem[]>;
  findTurnById(turnId: string): Promise<ConciergeTurnTraceDetail | null>;
}
