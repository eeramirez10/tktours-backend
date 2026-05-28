import { Prisma } from '@prisma/client';

import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { ConciergeTurnTraceRepository } from '../../domain/repositories/concierge-turn-trace.repository.js';
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
} from '../../domain/types/concierge-turn-trace.types.js';

function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

const turnSelect = {
  id: true,
  conversationId: true,
  inquiryId: true,
  incomingMessageId: true,
  responseId: true,
  model: true,
  promptVersion: true,
  status: true,
  inputJson: true,
  rawResponseText: true,
  structuredResponseJson: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  toolCalls: {
    orderBy: { startedAt: 'asc' },
    select: {
      id: true,
      callId: true,
      toolName: true,
      status: true,
      argumentsJson: true,
      outputJson: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  },
  _count: {
    select: {
      toolCalls: true,
    },
  },
} satisfies Prisma.ConciergeTurnSelect;

type TurnRecord = Prisma.ConciergeTurnGetPayload<{ select: typeof turnSelect }>;

function mapTurn(record: TurnRecord): ConciergeTurnTraceDetail {
  return {
    id: record.id,
    conversationId: record.conversationId,
    inquiryId: record.inquiryId,
    incomingMessageId: record.incomingMessageId,
    responseId: record.responseId,
    model: record.model,
    promptVersion: record.promptVersion,
    status: record.status,
    inputJson: record.inputJson,
    rawResponseText: record.rawResponseText,
    structuredResponseJson: record.structuredResponseJson,
    errorMessage: record.errorMessage,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    toolCallsCount: record._count.toolCalls,
    toolCalls: record.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      callId: toolCall.callId,
      toolName: toolCall.toolName,
      status: toolCall.status,
      argumentsJson: toolCall.argumentsJson,
      outputJson: toolCall.outputJson,
      errorMessage: toolCall.errorMessage,
      startedAt: toolCall.startedAt,
      finishedAt: toolCall.finishedAt,
    })),
  };
}

function mapListTurn(record: TurnRecord): ConciergeTurnTraceListItem {
  const detail = mapTurn(record);
  return {
    id: detail.id,
    conversationId: detail.conversationId,
    inquiryId: detail.inquiryId,
    incomingMessageId: detail.incomingMessageId,
    responseId: detail.responseId,
    model: detail.model,
    promptVersion: detail.promptVersion,
    status: detail.status,
    inputJson: detail.inputJson,
    rawResponseText: detail.rawResponseText,
    structuredResponseJson: detail.structuredResponseJson,
    errorMessage: detail.errorMessage,
    startedAt: detail.startedAt,
    finishedAt: detail.finishedAt,
    toolCallsCount: detail.toolCallsCount,
  };
}

export class PrismaConciergeTurnTraceRepository implements ConciergeTurnTraceRepository {
  async createTurn(input: CreateConciergeTurnTraceInput): Promise<{ id: string }> {
    const turn = await prisma.conciergeTurn.create({
      data: {
        conversationId: input.conversationId,
        inquiryId: input.inquiryId ?? null,
        incomingMessageId: input.incomingMessageId ?? null,
        model: input.model,
        promptVersion: input.promptVersion,
        status: 'STARTED',
        inputJson: toJsonInput(input.inputJson),
      },
      select: { id: true },
    });

    return turn;
  }

  async completeTurn(input: CompleteConciergeTurnTraceInput): Promise<void> {
    await prisma.conciergeTurn.update({
      where: { id: input.turnId },
      data: {
        status: 'COMPLETED',
        responseId: input.responseId,
        rawResponseText: input.rawResponseText,
        structuredResponseJson: toJsonInput(input.structuredResponseJson),
        finishedAt: new Date(),
      },
    });
  }

  async failTurn(input: FailConciergeTurnTraceInput): Promise<void> {
    await prisma.conciergeTurn.update({
      where: { id: input.turnId },
      data: {
        status: 'FAILED',
        errorMessage: input.errorMessage,
        rawResponseText: input.rawResponseText ?? null,
        finishedAt: new Date(),
      },
    });
  }

  async createToolCall(input: CreateConciergeToolCallTraceInput): Promise<void> {
    await prisma.conciergeToolCall.create({
      data: {
        turnId: input.turnId,
        callId: input.callId,
        toolName: input.toolName,
        status: 'STARTED',
        argumentsJson: toJsonInput(input.argumentsJson),
      },
    });
  }

  async completeToolCall(input: CompleteConciergeToolCallTraceInput): Promise<void> {
    await prisma.conciergeToolCall.update({
      where: {
        turnId_callId: {
          turnId: input.turnId,
          callId: input.callId,
        },
      },
      data: {
        status: 'COMPLETED',
        outputJson: toJsonInput(input.outputJson),
        finishedAt: new Date(),
      },
    });
  }

  async failToolCall(input: FailConciergeToolCallTraceInput): Promise<void> {
    await prisma.conciergeToolCall.update({
      where: {
        turnId_callId: {
          turnId: input.turnId,
          callId: input.callId,
        },
      },
      data: {
        status: 'FAILED',
        errorMessage: input.errorMessage,
        outputJson: toJsonInput(input.outputJson),
        finishedAt: new Date(),
      },
    });
  }

  async findTurns(query: ConciergeTurnTraceQuery): Promise<ConciergeTurnTraceListItem[]> {
    const turns = await prisma.conciergeTurn.findMany({
      where: {
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
        ...(query.inquiryId ? { inquiryId: query.inquiryId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: query.limit,
      select: turnSelect,
    });

    return turns.map(mapListTurn);
  }

  async findTurnById(turnId: string): Promise<ConciergeTurnTraceDetail | null> {
    const turn = await prisma.conciergeTurn.findUnique({
      where: { id: turnId },
      select: turnSelect,
    });

    return turn ? mapTurn(turn) : null;
  }
}
