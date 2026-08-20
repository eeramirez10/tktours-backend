import assert from 'node:assert/strict';

import { prisma } from '../shared/infrastructure/database/prisma.js';
import { ConciergeOrchestratorService } from '../features/concierge/application/services/concierge-orchestrator.service.js';

type FakeResponseCall = {
  instructions: string;
  input: string | Array<Record<string, unknown>>;
  previousResponseId?: string;
};

class FakeResponsesClient {
  calls: FakeResponseCall[] = [];
  private sequence = 0;

  getModel() {
    return 'fake-camp-season-model';
  }

  async createTextResponse(params: FakeResponseCall) {
    this.calls.push(params);
    this.sequence += 1;
    const responseId = `resp_fake_camp_${this.sequence}`;
    const inputText = typeof params.input === 'string' ? params.input : JSON.stringify(params.input);

    if (params.instructions.includes('Clasifica la respuesta del usuario sobre un ofrecimiento de folleto PDF.')) {
      const parsedInput = JSON.parse(inputText) as { latestMessage?: string };
      const latestMessage = parsedInput.latestMessage ?? '';
      const outputText =
        latestMessage.toLowerCase().includes('invierno')
          ? JSON.stringify({ action: 'SEND', confidence: 0.98, selectedSeasonKeys: ['WINTER'], sendAll: false })
          : JSON.stringify({ action: 'CLARIFY', confidence: 0.92, selectedSeasonKeys: [], sendAll: false });
      return { id: responseId, outputText, raw: { output: [] } };
    }

    if (params.instructions.includes('ofrecer folletos PDF de campamentos')) {
      return {
        id: responseId,
        outputText:
          'Tengo disponibles folletos de verano e invierno para Canadá. ¿Cuál te gustaría que te comparta?',
        raw: { output: [] },
      };
    }

    if (params.instructions.includes('Pide al usuario que elija una o varias temporadas')) {
      return {
        id: responseId,
        outputText: 'Con gusto. Tengo verano e invierno disponibles. ¿Cuál prefieres que te comparta?',
        raw: { output: [] },
      };
    }

    if (params.instructions.includes('confirmar el envío de uno o varios folletos PDF de campamentos')) {
      return {
        id: responseId,
        outputText: 'Claro, te comparto el folleto de invierno como archivo adjunto.',
        raw: { output: [] },
      };
    }

    return {
      id: responseId,
      outputText: JSON.stringify({
        replyText: 'Respuesta base del concierge',
        shouldAskFollowUp: false,
        detectedNeed: 'CAMP',
        missingFields: [],
        nextStage: 'RECOMMEND',
        shouldRefreshRecommendations: false,
      }),
      raw: { output: [] },
    };
  }
}

class FakeToolExecutor {
  async execute(toolName: string, args: unknown) {
    if (toolName === 'extract_inquiry_fields') {
      const payload = args as { latestMessage?: string };
      const latestMessage = payload.latestMessage ?? '';
      if (latestMessage.toLowerCase().includes('canad')) {
        return {
          countryCode: 'CA',
          studentAge: null,
          residenceCountry: null,
          cityOfResidence: null,
          tripDays: null,
          familyKey: null,
          accommodationKey: null,
          preferredStartMonth: null,
          preferredStartYear: null,
          preferredStartUndecided: false,
          weeks: null,
          weeksUndecided: false,
          firstName: null,
          lastName: null,
          email: null,
          confidence: 1,
        };
      }
      return {
        countryCode: null,
        studentAge: null,
        residenceCountry: null,
        cityOfResidence: null,
        tripDays: null,
        familyKey: null,
        accommodationKey: null,
        preferredStartMonth: null,
        preferredStartYear: null,
        preferredStartUndecided: false,
        weeks: null,
        weeksUndecided: false,
        firstName: null,
        lastName: null,
        email: null,
        confidence: 0.5,
      };
    }

    if (toolName === 'detect_user_intent') {
      return { intent: 'UNKNOWN', confidence: 0.7, menuWasShown: true };
    }

    if (toolName === 'evaluate_policy_signals') {
      return {
        menuWasShown: true,
        asksAccommodationOptions: false,
        isNegativeProgramAnswer: false,
        handoffStep: 'none',
        resolvedCountryCode: 'CA',
        confidence: 0.8,
        needsClarification: false,
      };
    }

    if (toolName === 'list_available_resources') {
      return {
        resources: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Canada Summer Camp 2026',
            countryCode: 'CA',
            countryName: 'Canadá',
            familyKey: 'CAMP',
            familyName: 'Campamentos / viajes',
            locationSlug: 'ca-vancouver',
            locationName: 'Vancouver',
            programSlug: 'canada-summer-camp',
            programName: 'Canada Summer Camp',
            programSeasonKeys: ['SUMMER'],
            currentVersion: {
              id: '22222222-2222-4222-8222-222222222222',
              fileName: 'canada-summer.pdf',
              fileUrl: 'https://example.com/canada-summer.pdf',
              mimeType: 'application/pdf',
            },
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            title: 'Canada Winter Camp 2026',
            countryCode: 'CA',
            countryName: 'Canadá',
            familyKey: 'CAMP',
            familyName: 'Campamentos / viajes',
            locationSlug: 'ca-montreal',
            locationName: 'Montreal',
            programSlug: 'canada-winter-camp',
            programName: 'Canada Winter Camp',
            programSeasonKeys: ['WINTER'],
            currentVersion: {
              id: '44444444-4444-4444-8444-444444444444',
              fileName: 'canada-winter.pdf',
              fileUrl: 'https://example.com/canada-winter.pdf',
              mimeType: 'application/pdf',
            },
          },
        ],
      };
    }

    if (toolName === 'list_available_countries') {
      return { countries: ['Canadá'] };
    }

    return {};
  }
}

async function main() {
  const source = `camp-season-test-${Date.now()}`;
  const contact = await prisma.contact.create({
    data: {
      waId: `521555${Date.now().toString().slice(-6)}`,
      firstName: 'Camp Test',
    },
    select: { id: true },
  });

  const family = await prisma.productFamily.findUniqueOrThrow({
    where: { key: 'CAMP' },
    select: { id: true },
  });

  const conversation = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      status: 'OPEN',
      currentStage: 'START',
      contextJson: { source },
    },
    select: { id: true },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      conversationId: conversation.id,
      contactId: contact.id,
      familyId: family.id,
      studentAge: 16,
      status: 'OPEN',
      qualificationJson: { source },
    },
    select: { id: true },
  });

  const service = new ConciergeOrchestratorService();
  (service as unknown as { responsesClient: FakeResponsesClient }).responsesClient = new FakeResponsesClient();
  (service as unknown as { toolExecutor: FakeToolExecutor }).toolExecutor = new FakeToolExecutor();
  (service as unknown as { recordCampBrochureSend: () => Promise<void> }).recordCampBrochureSend = async () => {};

  try {
    const firstInbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        text: 'Canadá',
        providerMessageId: `camp-season-msg-1-${Date.now()}`,
        metadata: { source },
      },
      select: { id: true, createdAt: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: firstInbound.createdAt },
    });

    await service.runTurn({ conversationId: conversation.id, incomingMessageId: firstInbound.id });

    const secondInbound = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        text: 'invierno',
        providerMessageId: `camp-season-msg-2-${Date.now()}`,
        metadata: { source },
      },
      select: { id: true, createdAt: true },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: secondInbound.createdAt },
    });

    await service.runTurn({ conversationId: conversation.id, incomingMessageId: secondInbound.id });

    const stored = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      select: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { direction: true, text: true, mediaUrl: true, metadata: true },
        },
      },
    });

    const outboundMessages = stored.messages.filter((message) => message.direction === 'OUTBOUND');
    assert.equal(outboundMessages.length, 2);
    assert.match(outboundMessages[0]?.text ?? '', /verano e invierno/i);
    assert.match(outboundMessages[1]?.text ?? '', /invierno/i);
    assert.equal(outboundMessages[1]?.mediaUrl, 'https://example.com/canada-winter.pdf');
    const metadata = (outboundMessages[1]?.metadata as Record<string, unknown> | null) ?? {};
    assert.deepEqual(metadata.mediaUrls, ['https://example.com/canada-winter.pdf']);

    console.log('OK: camp brochure season flow test passed');
    console.log(`conversationId=${conversation.id}`);
    console.log(`inquiryId=${inquiry.id}`);
  } finally {
    await prisma.conversation.delete({ where: { id: conversation.id } }).catch(() => null);
    await prisma.contact.delete({ where: { id: contact.id } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('FAIL: camp brochure season flow test failed');
  console.error(error);
  process.exitCode = 1;
});
