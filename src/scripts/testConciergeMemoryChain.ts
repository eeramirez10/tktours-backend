import assert from 'node:assert/strict';

import { prisma } from '../shared/infrastructure/database/prisma.js';
import { ConciergeOrchestratorService } from '../features/concierge/application/services/concierge-orchestrator.service.js';

type CreateTextResponseParams = {
  instructions: string;
  input: string | Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  previousResponseId?: string;
};

class FakeResponsesClient {
  public readonly calls: CreateTextResponseParams[] = [];
  private sequence = 0;

  getModel(): string {
    return 'fake-memory-model';
  }

  async createTextResponse(params: CreateTextResponseParams) {
    this.calls.push(params);
    this.sequence += 1;

    const responseId = `resp_fake_${this.sequence}`;
    const outputText = JSON.stringify({
      replyText: this.sequence === 1 ? 'Primera respuesta del concierge' : 'Segunda respuesta con memoria',
      shouldAskFollowUp: this.sequence === 1,
      detectedNeed: 'LANGUAGE_COURSE',
      missingFields: [],
      nextStage: 'RECOMMEND',
      shouldRefreshRecommendations: false,
    });

    return {
      id: responseId,
      outputText,
      raw: {
        output: [],
      },
    };
  }
}

async function main() {
  const source = `memory-chain-test-${Date.now()}`;

  const conversation = await prisma.conversation.create({
    data: {
      channel: 'WHATSAPP',
      status: 'OPEN',
      currentStage: 'START',
      contextJson: {
        source,
      },
    },
    select: { id: true },
  });

  const service = new ConciergeOrchestratorService();
  const fakeClient = new FakeResponsesClient();

  // Replace real OpenAI client to keep this test deterministic and offline.
  (service as unknown as { responsesClient: FakeResponsesClient }).responsesClient = fakeClient;

  try {
    const firstInbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        text: 'Hola, tengo 19 y quiero curso en Canadá',
        providerMessageId: `memory-test-msg-1-${Date.now()}`,
        metadata: { source },
      },
      select: { id: true, createdAt: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: firstInbound.createdAt },
    });

    const firstTurn = await service.runTurn({
      conversationId: conversation.id,
      incomingMessageId: firstInbound.id,
    });

    assert.equal(firstTurn.modelResponse.id, 'resp_fake_1');
    assert.equal(fakeClient.calls.length, 1);
    assert.equal(fakeClient.calls[0]?.previousResponseId, undefined);

    const afterFirst = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: {
        contextJson: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { direction: true, text: true },
        },
      },
    });

    const firstStoredResponseId =
      afterFirst.contextJson && typeof afterFirst.contextJson === 'object'
        ? (afterFirst.contextJson as Record<string, unknown>).openaiResponses &&
          typeof (afterFirst.contextJson as Record<string, unknown>).openaiResponses === 'object'
          ? ((afterFirst.contextJson as Record<string, unknown>).openaiResponses as Record<string, unknown>).lastResponseId
          : null
        : null;

    assert.equal(firstStoredResponseId, 'resp_fake_1');
    assert.equal(afterFirst.messages.length, 2);
    assert.equal(afterFirst.messages[1]?.direction, 'OUTBOUND');

    const secondInbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        text: '¿Qué me recomendaste?',
        providerMessageId: `memory-test-msg-2-${Date.now()}`,
        metadata: { source },
      },
      select: { id: true, createdAt: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: secondInbound.createdAt },
    });

    const secondTurn = await service.runTurn({
      conversationId: conversation.id,
      incomingMessageId: secondInbound.id,
    });

    assert.equal(secondTurn.modelResponse.id, 'resp_fake_2');
    assert.equal(fakeClient.calls.length, 2);
    assert.equal(fakeClient.calls[1]?.previousResponseId, 'resp_fake_1');

    const afterSecond = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: {
        contextJson: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { direction: true, text: true },
        },
      },
    });

    const secondStoredResponseId =
      afterSecond.contextJson && typeof afterSecond.contextJson === 'object'
        ? (afterSecond.contextJson as Record<string, unknown>).openaiResponses &&
          typeof (afterSecond.contextJson as Record<string, unknown>).openaiResponses === 'object'
          ? ((afterSecond.contextJson as Record<string, unknown>).openaiResponses as Record<string, unknown>).lastResponseId
          : null
        : null;

    assert.equal(secondStoredResponseId, 'resp_fake_2');
    assert.equal(afterSecond.messages.length, 4);
    assert.equal(afterSecond.messages[3]?.direction, 'OUTBOUND');

    console.log('OK: concierge memory chain test passed');
    console.log(`conversationId=${conversation.id}`);
  } finally {
    await prisma.conversation.delete({
      where: { id: conversation.id },
    });

    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL: concierge memory chain test failed');
  console.error(error);
  process.exitCode = 1;
});
