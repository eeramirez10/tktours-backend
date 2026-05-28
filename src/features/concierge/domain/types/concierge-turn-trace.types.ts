export type ConciergeTurnTraceStatus = 'STARTED' | 'COMPLETED' | 'FAILED';

export type ConciergeToolCallTraceStatus = 'STARTED' | 'COMPLETED' | 'FAILED';

export type ConciergeTurnTraceQuery = {
  conversationId?: string;
  inquiryId?: string;
  status?: ConciergeTurnTraceStatus;
  limit: number;
};

export type CreateConciergeTurnTraceInput = {
  conversationId: string;
  inquiryId?: string | null;
  incomingMessageId?: string | null;
  model: string;
  promptVersion: string;
  inputJson: Record<string, unknown>;
};

export type CompleteConciergeTurnTraceInput = {
  turnId: string;
  responseId: string | null;
  rawResponseText: string | null;
  structuredResponseJson: Record<string, unknown>;
};

export type FailConciergeTurnTraceInput = {
  turnId: string;
  errorMessage: string;
  rawResponseText?: string | null;
};

export type CreateConciergeToolCallTraceInput = {
  turnId: string;
  callId: string;
  toolName: string;
  argumentsJson: unknown;
};

export type CompleteConciergeToolCallTraceInput = {
  turnId: string;
  callId: string;
  outputJson: unknown;
};

export type FailConciergeToolCallTraceInput = {
  turnId: string;
  callId: string;
  errorMessage: string;
  outputJson?: unknown;
};

export type ConciergeToolCallTraceItem = {
  id: string;
  callId: string;
  toolName: string;
  status: ConciergeToolCallTraceStatus;
  argumentsJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type ConciergeTurnTraceListItem = {
  id: string;
  conversationId: string;
  inquiryId: string | null;
  incomingMessageId: string | null;
  responseId: string | null;
  model: string;
  promptVersion: string;
  status: ConciergeTurnTraceStatus;
  inputJson: unknown;
  rawResponseText: string | null;
  structuredResponseJson: unknown;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  toolCallsCount: number;
};

export type ConciergeTurnTraceDetail = ConciergeTurnTraceListItem & {
  toolCalls: ConciergeToolCallTraceItem[];
};
