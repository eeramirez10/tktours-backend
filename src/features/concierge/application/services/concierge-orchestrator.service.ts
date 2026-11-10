import { resourceTripCompatibility } from '../../../resources/domain/resource-trip-compatibility.js';
import { ResourceSendHistoryService, explicitlyRequestsResource } from '../../../resources/application/services/resource-send-history.service.js';
import type { ResourceTariff } from '../../../resources/domain/types/resource.types.js';
import { ResourceDeliveryGuardService } from '../../../resources/application/services/resource-delivery-guard.service.js';
import { ConflictAppError, NotFoundAppError, ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { env } from '../../../../shared/config/env.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { PrismaConversationRepository } from '../../../conversations/infrastructure/repositories/prisma-conversation.repository.js';
import { RefreshInquiryRecommendationsUseCase } from '../../../inquiries/application/use-cases/refresh-inquiry-recommendations.use-case.js';
import { PrismaInquiryRepository } from '../../../inquiries/infrastructure/repositories/prisma-inquiry.repository.js';
import { OpenAiResponsesClient, type ResponsesTextResult } from '../../infrastructure/clients/openai-response.js';
import { PrismaConciergeTurnTraceRepository } from '../../infrastructure/repositories/prisma-concierge-turn-trace.repository.js';
import { conciergePromptVersion, conciergeSystemPrompt } from '../prompts/concierge-system.prompt.js';
import { conciergeStructuredResponseSchema } from '../schemas/concierge-structured-response.schema.js';
import { conciergeTools } from '../tools/concierge-tools.registry.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';
import { ConciergeCityResourcesService } from './concierge-city-resources.service.js';
import { selectedCity } from '../../domain/city-selection.js';
import { conciergeFamilies } from '../../../catalog/domain/concierge-families.js';
import { courseMenuText, displayedCourseChoice, type CourseOffering } from '../../domain/course-offerings.js';

export type ConciergeTurnContext = {
  conversation: Awaited<ReturnType<PrismaConversationRepository['findById']>>;
  activeInquiry: Awaited<ReturnType<PrismaInquiryRepository['findById']>> | null;
  latestMessage: {
    id: string;
    direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
    text: string;
    createdAt: Date;
  } | null;
  availableCourseTypes?: CourseOffering[];
  cityWasSelected?: boolean;
  countryWasSelected?: boolean;
  travelDateWasSelected?: boolean;
};

type CampBrochureCandidate = {
  resourceId: string;
  resourceTitle: string;
  countryCode: string;
  countryName: string | null;
  programSlug: string | null;
  programName: string | null;
  locationSlug: string | null;
  locationName: string | null;
  seasonKeys: string[];
  versionId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  year: number | null;
  validFrom: string | null;
  validUntil: string | null;
  minAge: number | null;
  maxAge: number | null;
  minWeeks: number | null;
  maxWeeks: number | null;
  tariffs: ResourceTariff[];
  priceFrom: number | null;
  priceCurrency: string | null;
  priceUnit: string | null;
  priceNotes: string | null;
};

type CircuitResourceCandidate = CampBrochureCandidate & {
  description: string | null;
  summary: string | null;
};

type CampBrochureStateStatus = 'READY' | 'OFFERED' | 'SENT' | 'DECLINED' | 'UNAVAILABLE';

type CampBrochureState = {
  status: CampBrochureStateStatus;
  candidates: CampBrochureCandidate[];
  checkedAt: string;
  offeredAt: string | null;
  sentAt: string | null;
};

export class ConciergeOrchestratorService {
  private readonly refreshInquiryRecommendationsUseCase: RefreshInquiryRecommendationsUseCase;
  private readonly conversationContextResponseKey = 'openaiResponses';
  private readonly campBrochureContextKey = 'campBrochure';

  constructor(
    private readonly conversationRepository = new PrismaConversationRepository(),
    private readonly inquiryRepository = new PrismaInquiryRepository(),
    private readonly responsesClient = new OpenAiResponsesClient({}),
    private readonly toolExecutor = new ConciergeToolExecutorService(),
    private readonly turnTraceRepository = new PrismaConciergeTurnTraceRepository(),
  ) {
    this.refreshInquiryRecommendationsUseCase = new RefreshInquiryRecommendationsUseCase(this.inquiryRepository);
  }

  async runTurn(params: { conversationId: string; incomingMessageId: string }) {
    let context = await this.buildTurnContext(params);

    if (!context.latestMessage) {
      throw new NotFoundAppError('Latest message not found');
    }

    if (context.conversation?.controlMode !== 'AI') {
      throw new ConflictAppError('The concierge is disabled while the conversation is under human control');
    }

    if (context.latestMessage.id !== params.incomingMessageId) {
      throw new NotFoundAppError('Incoming message does not belong to the conversation');
    }

    context = { ...context, availableCourseTypes: await this.loadAvailableCourseTypes() };
    context = await this.hydrateInquiryFromLatestMessage(context);

    const currentControlState = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { controlMode: true },
    });
    if (currentControlState?.controlMode !== 'AI') {
      throw new ConflictAppError('The concierge is disabled while the conversation is under human control');
    }

    const inputPayload = this.buildModelInputPayload(context);
    const input = this.renderModelInput(inputPayload);

    const turn = await this.turnTraceRepository.createTurn({
      conversationId: params.conversationId,
      inquiryId: context.activeInquiry?.id ?? null,
      incomingMessageId: params.incomingMessageId,
      model: this.responsesClient.getModel(),
      promptVersion: conciergePromptVersion,
      inputJson: {
        params,
        inputPayload,
        renderedInput: input,
      },
    });

    let rawResponseText: string | null = null;
    let resourceDeliveries: Array<{ sendId: string; versionId: string; url: string }> = [];

    try {
      const previousResponseId = this.getPreviousResponseId(context.conversation?.contextJson ?? null);

      let firstResponse;

      try {
        firstResponse = await this.responsesClient.createTextResponse({
          instructions: conciergeSystemPrompt,
          input,
          tools: [...conciergeTools] as unknown as Array<Record<string, unknown>>,
          previousResponseId,
        });
      } catch (error) {
        if (!previousResponseId) {
          throw error;
        }

        firstResponse = await this.responsesClient.createTextResponse({
          instructions: conciergeSystemPrompt,
          input,
          tools: [...conciergeTools] as unknown as Array<Record<string, unknown>>,
        });
      }

      const { response, usedToolNames } = await this.completeToolCalls(firstResponse, turn.id);
      // Model tools may save a city/program; policy and delivery must use that same updated inquiry.
      if (usedToolNames.has('update_inquiry') && context.activeInquiry) {
        const updated = await this.inquiryRepository.findById(context.activeInquiry.id);
        if (updated) context = {
          ...context,
          cityWasSelected: context.cityWasSelected || (Boolean(updated.location?.slug) && updated.location?.slug !== context.activeInquiry.location?.slug),
          countryWasSelected: context.countryWasSelected || updated.country?.code !== context.activeInquiry.country?.code,
          travelDateWasSelected: context.travelDateWasSelected || updated.preferredStartMonth !== context.activeInquiry.preferredStartMonth || updated.preferredStartYear !== context.activeInquiry.preferredStartYear,
          activeInquiry: updated,
        };
      }
      const finalText = response.outputText;
      const finalResponseId = response.id;
      rawResponseText = finalText;
      const parsed = this.parseStructuredResponse(finalText);
      const policyResult = await this.applyReplyPolicy(parsed, context, {
        resourceContentSearchUsed: usedToolNames.has('search_resource_content'),
        dataToolUsed: [...usedToolNames].some((name) => [
          'list_destination_overview',
          'list_available_resources',
          'search_resource_content',
          'list_available_programs',
          'list_available_locations',
          'list_available_accommodations',
          'list_weeks_options',
          'get_program_detail',
          'find_matching_programs',
        ].includes(name)),
      });
      const normalized = policyResult.structured;
      const mediaUrls = policyResult.outboundMediaUrls ?? (policyResult.outboundMediaUrl ? [policyResult.outboundMediaUrl] : []);
      if (mediaUrls.length) {
        const delivery = await new ResourceDeliveryGuardService().prepareDelivery(mediaUrls, context.activeInquiry?.id ?? null);
        const allowed = delivery.urls;
        // Never claim to have sent an attachment that has become ineligible during the turn.
        if (allowed.length !== mediaUrls.length) {
          normalized.replyText = allowed.length
            ? 'Con gusto, te comparto los folletos que siguen vigentes. Un asesor de TKTours puede ayudarte con las otras opciones.'
            : 'Por el momento no tengo un folleto vigente para esas fechas. Con gusto, un asesor de TKTours te ayudará con las opciones actualizadas.';
          normalized.nextStage = 'ESCALATED';
          normalized.shouldAskFollowUp = false;
          normalized.missingFields = [];
          policyResult.contextPatch = this.mergeContextPatch(policyResult.contextPatch ?? null, {
            [this.campBrochureContextKey]: { status: 'UNAVAILABLE', candidates: [], checkedAt: new Date().toISOString(), offeredAt: null, sentAt: null },
            cityResourceDelivery: null,
          });
        }
        policyResult.outboundMediaUrls = allowed;
        policyResult.outboundMediaUrl = allowed[0] ?? null;
        if (context.activeInquiry?.id && delivery.versions.length) {
          const reserved = await new ResourceSendHistoryService().reserve(
            context.activeInquiry.id, delivery.versions, params.incomingMessageId,
            explicitlyRequestsResource(context.latestMessage?.text ?? ''),
          );
          resourceDeliveries = reserved.flatMap((version) => {
            const url = version.url ?? allowed.find((url) => url.includes(`/versions/${version.versionId}/`))
              ?? allowed[delivery.versions.findIndex((item) => item.versionId === version.versionId)];
            return url ? [{ sendId: version.sendId, versionId: version.versionId, url }] : [];
          });
          const reservedUrls = new Set(resourceDeliveries.map((item) => item.url));
          policyResult.outboundMediaUrls = allowed.filter((url) => reservedUrls.has(url));
          policyResult.outboundMediaUrl = policyResult.outboundMediaUrls[0] ?? null;
          if (policyResult.outboundMediaUrls.length !== allowed.length) {
            normalized.replyText = 'Ya te compartí los folletos disponibles. Podemos continuar con tu solicitud.';
          }
        }
      }

      const persistedConversation = await this.persistAssistantTurn({
        conversationId: params.conversationId,
        activeInquiryId: context.activeInquiry?.id ?? null,
        replyText: normalized.replyText,
        mediaUrl: policyResult.outboundMediaUrl ?? null,
        mediaUrls: policyResult.outboundMediaUrls ?? null,
        resourceDeliveries,
        nextStage: normalized.nextStage ?? null,
        shouldRefreshRecommendations: normalized.shouldRefreshRecommendations ?? false,
        responseId: finalResponseId,
        existingContextJson: context.conversation?.contextJson ?? null,
        contextPatch: policyResult.contextPatch ?? null,
      });

      await this.turnTraceRepository.completeTurn({
        turnId: turn.id,
        responseId: finalResponseId,
        rawResponseText: finalText,
        structuredResponseJson: {
          ...(normalized as unknown as Record<string, unknown>),
          policyTrace: policyResult.trace,
        },
      });

      return {
        ok: true,
        context,
        modelResponse: {
          id: finalResponseId,
          rawText: finalText,
          structured: normalized,
          policyTrace: policyResult.trace,
        },
        persistedConversation,
      };
    } catch (error) {
      // This turn never reached the transport; release only its unsent reservations.
      if (resourceDeliveries.length) await prisma.inquiryResourceSend.updateMany({
        where: { id: { in: resourceDeliveries.map((item) => item.sendId) }, deliveryStatus: 'RESERVED' },
        data: { deliveryStatus: 'FAILED' },
      });
      await this.turnTraceRepository.failTurn({
        turnId: turn.id,
        errorMessage: this.getErrorMessage(error),
        rawResponseText,
      });
      throw error;
    }
  }

  private async completeToolCalls(firstResponse: ResponsesTextResult, turnId: string): Promise<{
    response: ResponsesTextResult;
    usedToolNames: Set<string>;
  }> {
    let response = firstResponse;
    const usedToolNames = new Set<string>();

    for (let round = 0; round < 5; round += 1) {
      const functionCalls = response.raw.output.filter((item) => item.type === 'function_call');
      if (functionCalls.length === 0) break;
      const toolOutputs: Array<Record<string, unknown>> = [];

      for (const call of functionCalls) {
        if (call.type !== 'function_call') continue;
        usedToolNames.add(call.name);
        const args = this.safeParseArguments(call.arguments);

        await this.turnTraceRepository.createToolCall({
          turnId,
          callId: call.call_id,
          toolName: call.name,
          argumentsJson: args,
        });

        try {
          const result = await this.toolExecutor.execute(call.name, args);
          await this.turnTraceRepository.completeToolCall({
            turnId,
            callId: call.call_id,
            outputJson: result,
          });
          toolOutputs.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          await this.turnTraceRepository.failToolCall({
            turnId,
            callId: call.call_id,
            errorMessage: this.getErrorMessage(error),
          });
          throw error;
        }
      }

      response = await this.responsesClient.createTextResponse({
        instructions: conciergeSystemPrompt,
        input: toolOutputs,
        tools: [...conciergeTools] as unknown as Array<Record<string, unknown>>,
        previousResponseId: response.id,
      });
    }

    if (response.raw.output.some((item) => item.type === 'function_call')) {
      throw new ValidationAppError('Model exceeded the maximum number of tool rounds');
    }

    return { response, usedToolNames };
  }

  private async buildTurnContext(params: {
    conversationId: string;
    incomingMessageId: string;
  }): Promise<ConciergeTurnContext> {
    const conversation = await this.conversationRepository.findById(params.conversationId);

    if (!conversation) {
      throw new NotFoundAppError('Conversation not found');
    }

    const latestMessage = conversation.messages.find((message) => message.id === params.incomingMessageId) ?? null;

    const newestInquiry = conversation.inquiries[0] ?? null;

    const activeInquiry =
      newestInquiry && newestInquiry.status !== 'CLOSED'
        ? await this.inquiryRepository.findById(newestInquiry.id)
        : null;

    return {
      conversation,
      activeInquiry,
      latestMessage: latestMessage
        ? {
            id: latestMessage.id,
            direction: latestMessage.direction,
            text: latestMessage.text,
            createdAt: latestMessage.createdAt,
          }
        : null,
    };
  }

  private async hydrateInquiryFromLatestMessage(context: ConciergeTurnContext): Promise<ConciergeTurnContext> {
    if (!context.conversation || !context.latestMessage || context.latestMessage.direction !== 'INBOUND') {
      return context;
    }

    const activeInquiry = context.activeInquiry;
    const previousOutbound = this.findPreviousOutboundMessage(context);
    const cityData = activeInquiry?.country?.code && activeInquiry.family?.key
      && ['CAMP', 'LANGUAGE_COURSE'].includes(activeInquiry.family.key)
      ? await new ConciergeCityResourcesService(this.toolExecutor).load({ countryCode: activeInquiry.country.code,
        familyKey: activeInquiry.family.key, studentAge: activeInquiry.studentAge ?? undefined,
        targetDate: this.getInquiryTargetDate(activeInquiry) ?? undefined }) : null;
    const savedMenu = context.conversation.contextJson?.cityResourceMenu as {
      countryCode?: string; familyKey?: string; options?: Array<{ slug: string; name: string }>; replyText?: string;
    } | undefined;
    const menuMatches = savedMenu?.countryCode === activeInquiry?.country?.code
      && savedMenu?.familyKey === activeInquiry?.family?.key && savedMenu?.replyText === previousOutbound?.text;
    const menuCities = menuMatches && Array.isArray(savedMenu?.options) ? savedMenu.options : cityData?.cities ?? [];
    const choice = selectedCity(context.latestMessage.text, menuCities, savedMenu && !menuMatches ? '' : previousOutbound?.text);
    const cityChoice = cityData?.cities.find((city) => city.slug === choice?.slug) ?? null;
    const choosingCity = /actualmente tenemos programas en las siguientes ciudades/i.test(previousOutbound?.text ?? '');
    const expectedField = choosingCity ? 'program' : activeInquiry ? this.getEnforcedNextField(activeInquiry) : null;
    const extracted = cityChoice ? {} : await this.toolExecutor.execute('extract_inquiry_fields', {
      latestMessage: context.latestMessage.text,
      previousAssistantMessage: previousOutbound?.text ?? null,
      expectedField,
      recentMessages: (context.conversation?.messages ?? []).slice(-10).map((message) => ({
        direction: message.direction,
        text: message.text,
      })),
      inquirySnapshot: activeInquiry ? {
        countryCode: activeInquiry.country?.code ?? null,
        studentAge: activeInquiry.studentAge,
        residenceCountry: this.getResidenceCountryFromInquiry(activeInquiry),
        cityOfResidence: activeInquiry.cityOfResidence,
        tripDays: this.getTripDaysFromInquiry(activeInquiry),
        familyKey: activeInquiry.family?.key ?? null,
        accommodationKey: activeInquiry.accommodationType?.key ?? null,
        preferredStartMonth: activeInquiry.preferredStartMonth,
        preferredStartYear: activeInquiry.preferredStartYear,
        preferredStartStatus: this.getPreferredStartStatusFromInquiry(activeInquiry),
        weeks: activeInquiry.weeks,
        weeksStatus: this.getWeeksStatusFromInquiry(activeInquiry),
      } : null,
      nowIso: new Date().toISOString(),
    });

    if (!extracted || typeof extracted !== 'object') {
      return context;
    }

    const inquiryUpdate: Record<string, unknown> = {};

    const maybeSet = (key: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') {
        inquiryUpdate[key] = value;
      }
    };

    if (!cityChoice) maybeSet('countryCode', (extracted as { countryCode?: unknown }).countryCode);
    if (cityChoice) {
      inquiryUpdate.locationSlug = cityChoice.slug;
      if (cityChoice.slug !== activeInquiry?.location?.slug) inquiryUpdate.programSlug = null;
    }
    if (inquiryUpdate.countryCode && inquiryUpdate.countryCode !== activeInquiry?.country?.code) {
      inquiryUpdate.locationSlug = null;
      inquiryUpdate.programSlug = null;
    }
    maybeSet('studentAge', (extracted as { studentAge?: unknown }).studentAge);
    if (!cityChoice) maybeSet('cityOfResidence', (extracted as { cityOfResidence?: unknown }).cityOfResidence);
    maybeSet('familyKey', (extracted as { familyKey?: unknown }).familyKey);
    const menuChoice = displayedCourseChoice(context.latestMessage.text, previousOutbound?.text ?? null);
    if (menuChoice) inquiryUpdate.familyKey = menuChoice;
    if (inquiryUpdate.familyKey && context.availableCourseTypes
      && !context.availableCourseTypes.some((offering) => offering.familyKey === inquiryUpdate.familyKey)) {
      delete inquiryUpdate.familyKey;
    }
    if (inquiryUpdate.familyKey && activeInquiry?.family?.key
      && inquiryUpdate.familyKey !== activeInquiry.family.key) {
      // A program or accommodation from the previous course type cannot be reused.
      if (!Object.hasOwn(inquiryUpdate, 'programSlug')) inquiryUpdate.programSlug = null;
      if (!Object.hasOwn(inquiryUpdate, 'locationSlug')) inquiryUpdate.locationSlug = null;
      if (!Object.hasOwn(inquiryUpdate, 'accommodationKey')) inquiryUpdate.accommodationKey = null;
    }
    maybeSet('accommodationKey', (extracted as { accommodationKey?: unknown }).accommodationKey);
    maybeSet('preferredStartMonth', (extracted as { preferredStartMonth?: unknown }).preferredStartMonth);
    maybeSet('preferredStartYear', (extracted as { preferredStartYear?: unknown }).preferredStartYear);
    maybeSet('weeks', (extracted as { weeks?: unknown }).weeks);

    const qualificationJson =
      activeInquiry?.qualificationJson && typeof activeInquiry.qualificationJson === 'object'
        ? { ...activeInquiry.qualificationJson }
        : {};
    let qualificationJsonChanged = false;

    const residenceCountry = (extracted as { residenceCountry?: unknown }).residenceCountry;
    if (!cityChoice && typeof residenceCountry === 'string' && residenceCountry.trim().length > 0) {
      qualificationJson.residenceCountry = residenceCountry.trim();
      qualificationJsonChanged = true;
    }

    const preferredStartMonth = (extracted as { preferredStartMonth?: unknown }).preferredStartMonth;
    const preferredStartYear = (extracted as { preferredStartYear?: unknown }).preferredStartYear;
    const preferredStartUndecided = (extracted as { preferredStartUndecided?: unknown }).preferredStartUndecided === true;
    const hasPreferredStartValue = typeof preferredStartMonth === 'number' || typeof preferredStartYear === 'number';

    if (hasPreferredStartValue) {
      qualificationJson.preferredStartStatus = 'DEFINED';
      qualificationJsonChanged = true;
    } else if (preferredStartUndecided) {
      qualificationJson.preferredStartStatus = 'UNDECIDED';
      qualificationJsonChanged = true;
      inquiryUpdate.preferredStartMonth = null;
      inquiryUpdate.preferredStartYear = null;
    }

    const weeks = (extracted as { weeks?: unknown }).weeks;
    const weeksUndecided = (extracted as { weeksUndecided?: unknown }).weeksUndecided === true;
    const hasWeeksValue = typeof weeks === 'number';

    if (hasWeeksValue) {
      qualificationJson.weeksStatus = 'DEFINED';
      qualificationJsonChanged = true;
    } else if (weeksUndecided) {
      qualificationJson.weeksStatus = 'UNDECIDED';
      qualificationJsonChanged = true;
      inquiryUpdate.weeks = null;
    }

    if (qualificationJsonChanged) {
      inquiryUpdate.qualificationJson = qualificationJson;
    }

    const tripDays = (extracted as { tripDays?: unknown }).tripDays;
    if (typeof tripDays === 'number' && Number.isFinite(tripDays) && tripDays > 0) {
      qualificationJson.tripDays = Math.floor(tripDays);
      inquiryUpdate.qualificationJson = qualificationJson;
    }

    if (activeInquiry && Object.keys(inquiryUpdate).length > 0) {
      await this.inquiryRepository.update({
        inquiryId: activeInquiry.id,
        ...inquiryUpdate,
      });
    }

    const contactUpdate: Record<string, unknown> = {};
    maybeSetContact(contactUpdate, 'firstName', (extracted as { firstName?: unknown }).firstName);
    maybeSetContact(contactUpdate, 'lastName', (extracted as { lastName?: unknown }).lastName);
    maybeSetContact(contactUpdate, 'email', (extracted as { email?: unknown }).email);

    if (Object.keys(contactUpdate).length > 0) {
      await this.upsertInquiryContact({
        inquiryId: activeInquiry?.id ?? null,
        conversationId: context.conversation.id,
        contactId: activeInquiry?.contact?.id ?? context.conversation?.contact?.id ?? null,
        contactUpdate,
      });
    }

    const updatedInquiry = activeInquiry ? await this.inquiryRepository.findById(activeInquiry.id) : null;

    return {
      ...context,
      activeInquiry: updatedInquiry ?? activeInquiry,
      cityWasSelected: Boolean(cityChoice),
      travelDateWasSelected: hasPreferredStartValue,
      countryWasSelected: Boolean(inquiryUpdate.countryCode && inquiryUpdate.countryCode !== activeInquiry?.country?.code),
    };

    function maybeSetContact(target: Record<string, unknown>, key: string, value: unknown) {
      if (typeof value === 'string' && value.trim().length > 0) {
        target[key] = value.trim();
      }
    }
  }

  private async upsertInquiryContact(input: {
    inquiryId: string | null;
    conversationId: string;
    contactId: string | null;
    contactUpdate: Record<string, unknown>;
  }): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const contactId =
        input.contactId ??
        (
          await tx.contact.create({
            data: input.contactUpdate,
            select: { id: true },
          })
        ).id;

      if (input.contactId) {
        await tx.contact.update({
          where: { id: contactId },
          data: input.contactUpdate,
        });
      }

      if (input.inquiryId) {
        await tx.inquiry.update({
          where: { id: input.inquiryId },
          data: { contactId },
        });
      }

      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { contactId },
      });
    });
  }

  private findPreviousOutboundMessage(context: ConciergeTurnContext): { text: string } | null {
    const messages = context.conversation?.messages ?? [];
    const inboundIndex = messages.findIndex((message) => message.id === context.latestMessage?.id);
    const candidates = inboundIndex > 0 ? messages.slice(0, inboundIndex) : messages;
    const previousOutbound = [...candidates].reverse().find((message) => message.direction === 'OUTBOUND');
    return previousOutbound ? { text: previousOutbound.text } : null;
  }

  private buildModelInputPayload(context: ConciergeTurnContext): Record<string, unknown> {
    const recentMessages = context.conversation?.messages.slice(-20) ?? [];
    const campBrochureState = this.getCampBrochureStateFromContext(context);

    return {
      conversation: {
        id: context.conversation?.id,
        channel: context.conversation?.channel,
        status: context.conversation?.status,
        currentStage: context.conversation?.currentStage,
      },
      activeInquiry: context.activeInquiry,
      availableCourseTypes: context.availableCourseTypes,
      campBrochureState,
      latestMessage: context.latestMessage,
      recentMessages: recentMessages.map((message) => ({
        id: message.id,
        direction: message.direction,
        text: message.text,
        createdAt: message.createdAt,
      })),
    };
  }

  private renderModelInput(payload: Record<string, unknown>): string {
    return ['Conversation context:', JSON.stringify(payload, null, 2)].join('\n\n');
  }

  private parseStructuredResponse(outputText: string) {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(outputText);
    } catch {
      parsedJson = this.extractStructuredJsonCandidate(outputText);
      if (!parsedJson) {
        throw new ValidationAppError('Model did not return valid JSON', {
          rawOutput: outputText,
        });
      }
    }

    const result = conciergeStructuredResponseSchema.safeParse(parsedJson);

    if (!result.success) {
      throw new ValidationAppError('Model JSON response does not match expected shape', {
        issues: result.error.flatten(),
        rawOutput: outputText,
      });
    }

    return result.data;
  }

  private extractStructuredJsonCandidate(outputText: string): unknown | null {
    const objects = this.extractJsonObjects(outputText);

    for (let index = objects.length - 1; index >= 0; index -= 1) {
      const candidate = objects[index];
      if (!candidate) continue;

      try {
        const parsed = JSON.parse(candidate);
        const validation = conciergeStructuredResponseSchema.safeParse(parsed);
        if (validation.success) {
          return parsed;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private extractJsonObjects(input: string): string[] {
    const fragments: string[] = [];
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let start = -1;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        if (depth === 0) {
          start = i;
        }
        depth += 1;
        continue;
      }

      if (char === '}') {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          fragments.push(input.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return fragments;
  }

  private async applyReplyPolicy(
    parsed: ReturnType<ConciergeOrchestratorService['parseStructuredResponse']>,
    context: ConciergeTurnContext,
    options: { resourceContentSearchUsed: boolean; dataToolUsed: boolean },
  ): Promise<{
    structured: ReturnType<ConciergeOrchestratorService['parseStructuredResponse']>;
    trace: {
      strategy:
        | 'single_follow_up'
        | 'none';
      details?: Record<string, unknown>;
    };
    contextPatch?: Record<string, unknown> | null;
    outboundMediaUrl?: string | null;
    outboundMediaUrls?: string[] | null;
  }> {
    const detectedIntent = await this.detectIntentWithTool(context);
    const policySignals = await this.evaluatePolicySignalsWithTool(context);
    const requestedFamily = this.courseFamilyFromIntent(detectedIntent);
    if (detectedIntent === 'GREETING' || requestedFamily || context.availableCourseTypes
      || (!context.activeInquiry?.family?.key && detectedIntent === 'UNKNOWN' && !policySignals.menuWasShown)) {
      const offerings = context.availableCourseTypes ?? await this.loadAvailableCourseTypes();
      context = { ...context, availableCourseTypes: offerings };
      const family = requestedFamily ?? context.activeInquiry?.family?.key;
      const initialUnknown = !family && detectedIntent === 'UNKNOWN' && !policySignals.menuWasShown;
      const asksForTypes = !family && (detectedIntent === 'ASK_AVAILABLE_PROGRAMS' || detectedIntent === 'REQUEST_QUOTE');
      if (detectedIntent === 'GREETING' || initialUnknown || asksForTypes || !offerings.length
        || (family && !offerings.some((offering) => offering.familyKey === family))) {
        const unavailable = detectedIntent !== 'GREETING' && Boolean(family);
        const contact = context.activeInquiry?.contact ?? context.conversation?.contact;
        const name = contact?.firstName?.trim();
        const greeting = `¡Hola${name ? `, ${name}` : ''}! 👋😊 ¡Qué gusto recibirte en TKTours! 🌎✈️ Será un placer acompañarte a encontrar una experiencia para aprender, viajar y crear recuerdos increíbles. 💙`;
        const label = conciergeFamilies.find((item) => item.key === family)?.name ?? 'esa opción';
        const introduction = unavailable
          ? `Por el momento no tenemos opciones disponibles de ${label.toLowerCase()}. Con gusto, en TKTours puedo ayudarte con estas alternativas.`
          : detectedIntent === 'GREETING' ? greeting : `Con gusto${name ? `, ${name}` : ''}. En TKTours puedo ayudarte con estas opciones.`;
        const replyText = offerings.length
          ? `${introduction}\n\n¿Qué te gustaría explorar?\n${courseMenuText(offerings)}`
          : `${detectedIntent === 'GREETING' ? `${greeting}\n\n` : ''}Por el momento no tengo programas ni folletos vigentes disponibles para ofrecerte. Un asesor de TKTours puede orientarte con información actualizada.`;
        return {
          structured: { ...parsed, replyText, missingFields: [], shouldAskFollowUp: false,
            nextStage: offerings.length ? 'START' : 'ESCALATED', shouldRefreshRecommendations: false },
          trace: { strategy: 'none', details: { reason: unavailable ? 'course_type_unavailable' : 'live_course_menu', availableFamilies: offerings.map((offering) => offering.familyKey) } },
          outboundMediaUrl: null, outboundMediaUrls: null,
        };
      }
    }
    context = await this.hydrateInquiryFamilyFromIntent(context, detectedIntent);
    const cityFlow = !this.getLanguageCourseAgeBlock(context, detectedIntent)
      ? await this.applyCityResourceFlow(parsed, context) : null;
    if (cityFlow) return cityFlow;
    const enforcedField = this.getEnforcedNextField(context.activeInquiry);
    const languageCourseAgeBlock = this.getLanguageCourseAgeBlock(context, detectedIntent);
    const campBrochureStateResult = await this.resolveCampBrochureState(context);
    const campBrochureState = campBrochureStateResult.state;
    let contextPatch: Record<string, unknown> | null = campBrochureStateResult.contextPatch;

    if (languageCourseAgeBlock) {
      return {
        structured: {
          ...parsed,
          shouldAskFollowUp: false,
          missingFields: [],
          nextStage: 'ESCALATED',
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'none',
          details: {
            reason: 'language_course_min_age_block',
            studentAge: languageCourseAgeBlock.studentAge,
            minAge: 15,
          },
        },
        contextPatch,
        outboundMediaUrl: null,
        outboundMediaUrls: null,
      };
    }

    if (this.isCampTariffQuestion(context)) {
      return { structured: { ...parsed, replyText: await this.buildConfirmedTariffAnswer(context), missingFields: [], shouldAskFollowUp: false, shouldRefreshRecommendations: false },
        trace: { strategy: 'none', details: { reason: 'confirmed_resource_tariff_answer' } }, contextPatch };
    }

    if (this.isCampPriceQuestion(context)) {
      const replyText = await this.buildConfirmedCampPriceAnswer(context);
      return {
        structured: {
          ...parsed,
          replyText,
          missingFields: [],
          shouldAskFollowUp: false,
          shouldRefreshRecommendations: false,
        },
        trace: { strategy: 'none', details: { reason: 'verified_camp_price_answer' } },
        contextPatch,
      };
    }

    const asksAboutOptions = detectedIntent === 'ASK_AVAILABLE_COUNTRIES' || detectedIntent === 'ASK_AVAILABLE_PROGRAMS';
    const question = context.latestMessage?.text ?? '';
    const previousQuestion = this.findPreviousOutboundMessage(context)?.text ?? '';
    const asksForTypes = /\b(?:qu[eé]\s+(?:tipos|opciones)|cu[aá]les\s+(?:tienes|tienen|hay|son))\b/i.test(question);
    const namesAnotherTopic = /\b(?:programas?|cursos?|campamentos?|pa[ií]ses|temporadas?)\b/i.test(question);
    const asksForAccommodation = policySignals.asksAccommodationOptions
      || (asksForTypes && !namesAnotherTopic
        && (enforcedField === 'accommodation' || /alojamiento|hospedaje/i.test(previousQuestion)));
    if (asksForAccommodation) {
      const accommodationOptions = await this.buildAccommodationOptionsList(context);
      return {
        structured: {
          ...parsed,
          replyText: accommodationOptions
            ? `Con gusto 😊. ${accommodationOptions}`
            : this.unconfirmedAccommodationReply,
          missingFields: [], shouldAskFollowUp: false,
          nextStage: accommodationOptions ? 'RECOMMEND' : 'ESCALATED',
          shouldRefreshRecommendations: false,
        },
        trace: { strategy: accommodationOptions ? 'single_follow_up' : 'none', details: { reason: 'contextual_accommodation_options' } },
        contextPatch, outboundMediaUrl: null, outboundMediaUrls: null,
      };
    }
    const isAnsweringQuestion = parsed.replyIntent === 'ANSWER_QUESTION'
      || options.resourceContentSearchUsed
      || asksAboutOptions
      || (options.dataToolUsed && /[¿?]/.test(context.latestMessage?.text ?? ''));

    if (isAnsweringQuestion || parsed.replyIntent === 'CHANGE_TOPIC') {
      const shouldGroundAnswer = isAnsweringQuestion
        && !options.dataToolUsed
        && (parsed.detectedNeed !== 'UNKNOWN' || asksAboutOptions);
      const replyText = shouldGroundAnswer
        ? await this.buildGroundedAnswer(context)
        : parsed.replyText;
      return {
        structured: {
          ...parsed,
          replyText,
          missingFields: [],
          shouldAskFollowUp: shouldGroundAnswer ? false : parsed.shouldAskFollowUp,
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'none',
          details: { reason: isAnsweringQuestion ? 'answer_customer_question' : 'customer_changed_topic' },
        },
        contextPatch,
      };
    }

    const handoffStep = this.normalizeHandoffStep(context, policySignals.handoffStep);
    if (handoffStep) {
      return {
        structured: {
          ...parsed,
          shouldAskFollowUp: handoffStep !== 'confirm_handoff',
          missingFields: [],
          nextStage: 'ESCALATED',
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: handoffStep === 'confirm_handoff' ? 'none' : 'single_follow_up',
          details: {
            reason: `advisor_handoff_${handoffStep}`,
          },
        },
        contextPatch,
      };
    }

    const modelMissingFields = this.sanitizeMissingFieldsForInquiry(parsed.missingFields, context.activeInquiry);
    const nextField = enforcedField ?? this.getFirstStillMissingField(modelMissingFields, context.activeInquiry);
    const brochureReplyAction = await this.resolveCampBrochureReplyAction(context, campBrochureState);

    if (campBrochureState?.status === 'UNAVAILABLE'
      && this.getCampBrochureStateFromContext(context)?.status === 'OFFERED') {
      return {
        structured: {
          ...parsed,
          replyText: 'Por el momento no tengo un folleto vigente para esas fechas. Con gusto, un asesor de TKTours te ayudará con información actualizada.',
          shouldAskFollowUp: false,
          missingFields: [],
          nextStage: 'ESCALATED',
          shouldRefreshRecommendations: false,
        },
        trace: { strategy: 'none', details: { reason: 'previous_brochure_offer_no_longer_eligible' } },
        contextPatch,
        outboundMediaUrl: null,
        outboundMediaUrls: [],
      };
    }

    if (brochureReplyAction.action === 'SEND' && campBrochureState?.candidates.length) {
      const selectedCandidates = this.selectCampBrochureCandidatesForReply(campBrochureState.candidates, brochureReplyAction);
      if (selectedCandidates.length === 0) {
        const replyText = await this.buildPromptDrivenCampBrochureSeasonChoice({
          context,
          candidates: campBrochureState.candidates,
        });
        return {
          structured: {
            ...parsed,
            replyText,
            shouldAskFollowUp: true,
            nextStage: 'SEND_RESOURCE',
            missingFields: [],
            shouldRefreshRecommendations: false,
          },
          trace: {
            strategy: 'single_follow_up',
            details: {
              reason: 'camp_brochure_season_clarify_after_send',
            },
          },
          contextPatch,
        };
      }
      const sendReply = await this.buildPromptDrivenCampBrochureSend({
        context,
        candidates: selectedCandidates,
      });
      const accommodationNeedsConfirmation = nextField === 'accommodation' && !await this.buildAccommodationOptionsList(context);
      const followUp = accommodationNeedsConfirmation ? this.unconfirmedAccommodationReply : nextField
        ? await this.buildPromptDrivenFollowUp({
            nextField,
            context,
            fallbackReplyText: parsed.replyText,
          })
        : null;
      const nowIso = new Date().toISOString();
      contextPatch = this.mergeContextPatch(contextPatch, {
        [this.campBrochureContextKey]: {
          ...campBrochureState,
          status: 'SENT',
          sentAt: nowIso,
          checkedAt: nowIso,
        },
      });

      return {
        structured: {
          ...parsed,
          replyText: followUp ? `${sendReply}\n${followUp}` : sendReply,
          shouldAskFollowUp: Boolean(followUp) && !accommodationNeedsConfirmation,
          nextStage: accommodationNeedsConfirmation ? 'ESCALATED' : followUp ? this.mapNextStageFromField(nextField!) : 'SEND_RESOURCE',
          missingFields: followUp && !accommodationNeedsConfirmation ? [nextField!] : [],
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: followUp && !accommodationNeedsConfirmation ? 'single_follow_up' : 'none',
          details: {
            reason: 'camp_brochure_sent',
            resourceIds: selectedCandidates.map((candidate) => candidate.resourceId),
            nextField: nextField ?? null,
            accommodationNeedsConfirmation,
          },
        },
        contextPatch,
        outboundMediaUrl: this.toAbsoluteMediaUrl(selectedCandidates[0]?.fileUrl ?? null),
        outboundMediaUrls: this.toAbsoluteMediaUrls(selectedCandidates.map((candidate) => candidate.fileUrl)),
      };
    }

    if (brochureReplyAction.action === 'CLARIFY' && campBrochureState?.candidates.length) {
      const replyText = await this.buildPromptDrivenCampBrochureSeasonChoice({
        context,
        candidates: campBrochureState.candidates,
      });
      return {
        structured: {
          ...parsed,
          replyText,
          shouldAskFollowUp: true,
          nextStage: 'SEND_RESOURCE',
          missingFields: [],
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'single_follow_up',
          details: {
            reason: 'camp_brochure_season_choice',
          },
        },
        contextPatch,
      };
    }

    if (brochureReplyAction.action === 'DECLINE' && campBrochureState) {
      const nowIso = new Date().toISOString();
      contextPatch = this.mergeContextPatch(contextPatch, {
        [this.campBrochureContextKey]: {
          ...campBrochureState,
          status: 'DECLINED',
          checkedAt: nowIso,
        },
      });
    }

    if (options.resourceContentSearchUsed) {
      return {
        structured: {
          ...parsed,
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'none',
          details: { reason: 'resource_content_answer' },
        },
        contextPatch,
      };
    }

    if (this.shouldOfferCampBrochure(context, nextField, campBrochureState)) {
      const offerReply = await this.buildPromptDrivenCampBrochureOffer({
        context,
        candidates: campBrochureState!.candidates,
      });
      const nowIso = new Date().toISOString();
      contextPatch = this.mergeContextPatch(contextPatch, {
        [this.campBrochureContextKey]: {
          ...campBrochureState,
          status: 'OFFERED',
          offeredAt: campBrochureState?.offeredAt ?? nowIso,
          checkedAt: nowIso,
        },
      });

      return {
        structured: {
          ...parsed,
          replyText: offerReply,
          shouldAskFollowUp: true,
          nextStage: 'SEND_RESOURCE',
          missingFields: nextField ? [nextField] : [],
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'single_follow_up',
          details: {
            reason: 'camp_brochure_offer',
            resourceIds: campBrochureState?.candidates.map((candidate) => candidate.resourceId) ?? [],
            nextField: nextField ?? null,
          },
        },
        contextPatch,
      };
    }

    if (!nextField && this.isCircuitsInquiry(context.activeInquiry)) {
      const circuitCandidate = await this.findMatchingCircuitResourceCandidate(context);
      if (circuitCandidate) {
        const replyText = await this.buildPromptDrivenCircuitResourceSend({
          context,
          candidate: circuitCandidate,
        });
        return {
          structured: {
            ...parsed,
            replyText,
            nextStage: 'SEND_RESOURCE',
            shouldAskFollowUp: false,
            missingFields: [],
            shouldRefreshRecommendations: false,
          },
          trace: {
            strategy: 'none',
            details: {
              reason: 'circuits_resource_sent',
              resourceId: circuitCandidate.resourceId,
              tripDays: this.getTripDaysFromInquiry(context.activeInquiry),
            },
          },
          contextPatch,
          outboundMediaUrl: this.toAbsoluteMediaUrl(circuitCandidate.fileUrl),
          outboundMediaUrls: this.toAbsoluteMediaUrls([circuitCandidate.fileUrl]),
        };
      }

      const replyText = await this.buildPromptDrivenCircuitNoMatch({
        context,
        fallbackReplyText: parsed.replyText,
      });
      return {
        structured: {
          ...parsed,
          replyText,
          nextStage: 'ESCALATED',
          shouldAskFollowUp: false,
          missingFields: [],
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'none',
          details: {
            reason: 'circuits_no_matching_resource',
            tripDays: this.getTripDaysFromInquiry(context.activeInquiry),
          },
        },
        contextPatch,
      };
    }

    if (!nextField) {
      const shouldCloseConversation = this.isReadyForAdvisorHandoff(context) && this.hasContactName(context) && this.hasContactEmail(context);
      const replyText = shouldCloseConversation
        ? await this.buildPromptDrivenHandoffConfirmation({
            context,
            fallbackReplyText: parsed.replyText,
          })
        : parsed.replyText;
      return {
        structured: {
          ...parsed,
          replyText,
          nextStage: shouldCloseConversation ? 'CLOSED' : parsed.nextStage,
          shouldAskFollowUp: false,
          missingFields: [],
        },
        trace: {
          strategy: 'none',
          details: {
            reason: 'no_missing_field_after_policy',
            intent: detectedIntent,
            confidence: policySignals.confidence,
          },
        },
        contextPatch,
      };
    }

    if (nextField === 'accommodation' && !await this.buildAccommodationOptionsList(context)) {
      return {
        structured: { ...parsed, replyText: this.unconfirmedAccommodationReply, shouldAskFollowUp: false,
          nextStage: 'ESCALATED', missingFields: [], shouldRefreshRecommendations: false },
        trace: { strategy: 'none', details: { reason: 'unconfirmed_accommodation_options' } },
        contextPatch,
      };
    }

    const replyText = await this.buildPromptDrivenFollowUp({
      nextField,
      context,
      fallbackReplyText: parsed.replyText,
    });

    return {
      structured: {
        ...parsed,
        replyText,
        shouldAskFollowUp: true,
        nextStage: this.mapNextStageFromField(nextField),
        missingFields: [nextField],
      },
      trace: {
        strategy: 'single_follow_up',
        details: {
          field: nextField,
          reason: enforcedField ? 'enforced_flow_field' : 'model_missing_field',
          intent: detectedIntent,
          confidence: policySignals.confidence,
          needsClarification: policySignals.needsClarification,
        },
      },
      contextPatch,
    };
  }

  private async buildGroundedAnswer(context: ConciergeTurnContext): Promise<string> {
    const inquiry = context.activeInquiry;
    const question = context.latestMessage?.text ?? '';
    const overview = await this.toolExecutor.execute('list_destination_overview', {
      familyKey: inquiry?.family?.key ?? undefined,
      countryCode: inquiry?.country?.code ?? undefined,
      studentAge: inquiry?.studentAge ?? undefined,
      targetDate: this.getInquiryTargetDate(inquiry) ?? undefined,
      targetMonth: inquiry?.preferredStartMonth ?? undefined,
      targetYear: inquiry?.preferredStartYear ?? undefined,
    });
    const content = inquiry?.id && inquiry.country?.code
      ? await this.toolExecutor.execute('search_resource_content', { inquiryId: inquiry.id, query: question })
      : null;
    const response = await this.responsesClient.createTextResponse({
      instructions: [
        'Eres una asesora de TKTours. Responde en español la pregunta actual del cliente con naturalidad y brevedad.',
        'Usa únicamente los datos de destinations y matches. Si no confirman el detalle preguntado, dilo claramente y ofrece seguimiento con un asesor.',
        'No inventes precios, fechas, actividades, folletos ni disponibilidad. Solo menciona un precio si destinations contiene priceFrom y priceCurrency para el mismo folleto; exprésalo como "desde". Las tarifas de matches son campos confirmados del formulario; conserva su tipo, modalidad y duración. Nunca calcules precios ni reinterpretes el PDF.',
        'Distingue un programa sin folleto de un folleto disponible. No vuelvas a pedir datos pendientes en esta respuesta.',
        'Responde solo texto plano.',
      ].join('\n'),
      input: JSON.stringify({ question, previousAssistantMessage: this.findPreviousOutboundMessage(context)?.text ?? null,
        expectedField: this.getEnforcedNextField(inquiry), overview, content }),
    });
    return response.outputText.trim() || 'Con gusto te ayudo. Ese detalle no aparece confirmado en la información disponible; un asesor de TKTours puede revisarlo contigo.';
  }

  private isCampTariffQuestion(context: ConciergeTurnContext): boolean {
    return context.activeInquiry?.family?.key === 'CAMP'
      && /semanas?\s+(?:extra|adicional)|(?:extra|adicional).*semana|paquetes?|(?:precio|cuesta|costo).*semanas?/i.test(context.latestMessage?.text ?? '');
  }

  private async buildConfirmedTariffAnswer(context: ConciergeTurnContext): Promise<string> {
    const question = context.latestMessage?.text ?? '';
    const extra = /semanas?\s+(?:extra|adicional)|(?:extra|adicional).*semana/i.test(question);
    const spanishNumbers: Record<string, number> = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
    const requested = question.match(/(\d+|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+semanas?/i)?.[1]?.toLowerCase();
    const weeks = requested ? Number(requested) || spanishNumbers[requested] : null;
    const result = await this.toolExecutor.execute('search_resource_content', {
      inquiryId: context.activeInquiry?.id, query: question,
    }) as { matches?: Array<{ resourceTitle: string; tariffs?: ResourceTariff[] }> };
    const lines = (result.matches ?? []).flatMap((resource) => (resource.tariffs ?? [])
      .filter((tariff) => tariff.kind === (extra ? 'EXTRA_WEEK' : 'PACKAGE') && (extra || !weeks || tariff.weeks === weeks))
      .map((tariff) => `• ${resource.resourceTitle}: ${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(tariff.amount)} ${tariff.currency} ${extra ? 'por semana adicional' : `por el paquete de ${tariff.weeks} semanas`}, modalidad ${tariff.modality}${tariff.notes ? `. ${tariff.notes}` : ''}`));
    if (!lines.length) return `No tengo una tarifa confirmada ${extra ? 'por semana adicional' : weeks ? `para el paquete de ${weeks} semanas` : 'para ese paquete'} para estos folletos. Un asesor de TKTours puede confirmarla.`;
    return `Las tarifas registradas son:\n${lines.join('\n')}${extra ? '\nEl precio de un paquete de mayor duración debe confirmarse por separado; este cargo no establece el total del paquete.' : ''}`;
  }

  private isCampPriceQuestion(context: ConciergeTurnContext): boolean {
    return context.activeInquiry?.family?.key === 'CAMP'
      && /\b(precios?|costos?|cu[aá]nto\s+(?:cuesta|cuestan|vale|valen)|cotizaci[oó]n)\b/i.test(context.latestMessage?.text ?? '');
  }

  private async buildConfirmedCampPriceAnswer(context: ConciergeTurnContext): Promise<string> {
    const inquiry = context.activeInquiry;
    const countryCode = inquiry?.country?.code;
    if (!countryCode) return 'Con gusto te ayudo con el costo 😊. ¿Qué país o campamento te interesa?';

    const countryName = inquiry?.country?.name ?? 'ese destino';
    const targetDate = this.getInquiryTargetDate(inquiry);
    try {
      const result = await this.toolExecutor.execute('list_available_resources', {
        activeOnly: true,
        familyKey: 'CAMP',
        type: 'BROCHURE',
        countryCode,
        ...(inquiry?.program?.slug ? { programSlug: inquiry.program.slug } : {}),
        ...(inquiry?.location?.slug ? { locationSlug: inquiry.location.slug } : {}),
        ...(inquiry?.studentAge != null ? { studentAge: inquiry.studentAge } : {}),
        ...(targetDate ? { targetDate } : {}),
        ...(inquiry?.preferredStartMonth ? { targetMonth: inquiry.preferredStartMonth } : {}),
        ...(inquiry?.preferredStartYear ? { targetYear: inquiry.preferredStartYear } : {}),
      });
      const resources = result && typeof result === 'object' && Array.isArray((result as { resources?: unknown }).resources)
        ? (result as { resources: Array<{ priceFrom?: unknown; priceCurrency?: unknown; priceUnit?: unknown }> }).resources
        : [];
      const priced = resources.filter((resource): resource is {
        priceFrom: number; priceCurrency: string; priceUnit?: unknown;
      } => typeof resource.priceFrom === 'number' && Number.isFinite(resource.priceFrom)
        && typeof resource.priceCurrency === 'string' && resource.priceCurrency.length === 3);
      if (priced.length === 0) {
        return `Por ahora no tengo un precio confirmado para los campamentos en ${countryName}. Un asesor de TKTours puede ayudarte a confirmarlo.`;
      }

      const first = priced[0]!;
      const lowest = priced.filter((item) => item.priceCurrency === first.priceCurrency)
        .reduce((selected, item) => item.priceFrom < selected.priceFrom ? item : selected, first);
      const amount = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(lowest.priceFrom);
      const unit = typeof lowest.priceUnit === 'string' && lowest.priceUnit.trim() ? ` por ${lowest.priceUnit.trim()}` : '';
      return `Para los campamentos en ${countryName}, tengo folletos con precios desde ${amount} ${lowest.priceCurrency}${unit}. Si te interesa, puedo compartirte el folleto.`;
    } catch {
      return `Por ahora no tengo un precio confirmado para los campamentos en ${countryName}. Un asesor de TKTours puede ayudarte a confirmarlo.`;
    }
  }

  private async resolveCampBrochureState(
    context: ConciergeTurnContext,
  ): Promise<{ state: CampBrochureState | null; contextPatch: Record<string, unknown> | null }> {
    const inquiry = context.activeInquiry;
    if (!inquiry || inquiry.family?.key !== 'CAMP' || !inquiry.country?.code) {
      return { state: null, contextPatch: null };
    }

    const existing = this.getCampBrochureStateFromContext(context);
    const resolved = await this.findCampBrochureCandidates(context);
    const nowIso = new Date().toISOString();

    if (!resolved.length) {
      const unavailable: CampBrochureState = {
        status: 'UNAVAILABLE',
        candidates: [],
        checkedAt: nowIso,
        offeredAt: null,
        sentAt: null,
      };
      return {
        state: unavailable,
        contextPatch: {
          [this.campBrochureContextKey]: unavailable,
        },
      };
    }

    const keepOffered = existing?.status === 'OFFERED' && this.haveSameCampBrochureCandidates(existing.candidates, resolved);
    const pending = await new ResourceSendHistoryService().pendingVersions(inquiry.id, resolved);
    const keepSent = pending.length === 0;
    const keepDeclined = existing?.status === 'DECLINED' && this.haveSameCampBrochureCandidates(existing.candidates, resolved);

    const state: CampBrochureState = {
      status: keepSent ? 'SENT' : keepOffered ? 'OFFERED' : keepDeclined ? 'DECLINED' : 'READY',
      candidates: resolved,
      checkedAt: nowIso,
      offeredAt: keepOffered ? existing?.offeredAt ?? nowIso : null,
      sentAt: keepSent ? existing?.sentAt ?? nowIso : null,
    };

    return {
      state,
      contextPatch: {
        [this.campBrochureContextKey]: state,
      },
    };
  }

  private getCampBrochureStateFromContext(context: ConciergeTurnContext): CampBrochureState | null {
    const contextJson = context.conversation?.contextJson;
    if (!contextJson || typeof contextJson !== 'object') {
      return null;
    }

    const raw = (contextJson as Record<string, unknown>)[this.campBrochureContextKey];
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const status = (raw as Record<string, unknown>).status;
    const allowedStatus = new Set<CampBrochureStateStatus>(['READY', 'OFFERED', 'SENT', 'DECLINED', 'UNAVAILABLE']);
    if (typeof status !== 'string' || !allowedStatus.has(status as CampBrochureStateStatus)) {
      return null;
    }

    const candidatesRaw = (raw as Record<string, unknown>).candidates;
    const candidates = Array.isArray(candidatesRaw)
      ? candidatesRaw.map((candidate) => this.normalizeCampBrochureCandidate(candidate)).filter((candidate): candidate is CampBrochureCandidate => candidate !== null)
      : [];
    const legacyCandidate = candidates.length === 0 ? this.normalizeCampBrochureCandidate((raw as Record<string, unknown>).candidate) : null;

    return {
      status: status as CampBrochureStateStatus,
      candidates: legacyCandidate ? [legacyCandidate] : candidates,
      checkedAt: this.asIsoString((raw as Record<string, unknown>).checkedAt) ?? new Date().toISOString(),
      offeredAt: this.asIsoString((raw as Record<string, unknown>).offeredAt),
      sentAt: this.asIsoString((raw as Record<string, unknown>).sentAt),
    };
  }

  private normalizeCampBrochureCandidate(value: unknown): CampBrochureCandidate | null {
    if (!value || typeof value !== 'object') return null;
    const payload = value as Record<string, unknown>;
    const resourceId = this.asNonEmptyStringValue(payload.resourceId);
    const resourceTitle = this.asNonEmptyStringValue(payload.resourceTitle);
    const countryCode = this.asNonEmptyStringValue(payload.countryCode);
    const versionId = this.asNonEmptyStringValue(payload.versionId);
    const fileName = this.asNonEmptyStringValue(payload.fileName);
    const fileUrl = this.asNonEmptyStringValue(payload.fileUrl);

    if (!resourceId || !resourceTitle || !countryCode || !versionId || !fileName || !fileUrl) {
      return null;
    }

    return {
      resourceId,
      resourceTitle,
      countryCode,
      countryName: this.asNonEmptyStringValue(payload.countryName),
      programSlug: this.asNonEmptyStringValue(payload.programSlug),
      programName: this.asNonEmptyStringValue(payload.programName),
      locationSlug: this.asNonEmptyStringValue(payload.locationSlug),
      locationName: this.asNonEmptyStringValue(payload.locationName),
      seasonKeys: Array.isArray(payload.seasonKeys)
        ? payload.seasonKeys.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [],
      versionId,
      fileName,
      fileUrl: this.toPublicUrl(fileUrl),
      mimeType: this.asNonEmptyStringValue(payload.mimeType),
      year: this.asFiniteNumberValue(payload.year),
      validFrom: this.asNonEmptyStringValue(payload.validFrom),
      validUntil: this.asNonEmptyStringValue(payload.validUntil),
      minAge: this.asFiniteNumberValue(payload.minAge),
      maxAge: this.asFiniteNumberValue(payload.maxAge),
      minWeeks: this.asFiniteNumberValue(payload.minWeeks),
      maxWeeks: this.asFiniteNumberValue(payload.maxWeeks),
      tariffs: Array.isArray(payload.tariffs) ? payload.tariffs as ResourceTariff[] : [],
      priceFrom: this.asFiniteNumberValue(payload.priceFrom),
      priceCurrency: this.asNonEmptyStringValue(payload.priceCurrency),
      priceUnit: this.asNonEmptyStringValue(payload.priceUnit),
      priceNotes: this.asNonEmptyStringValue(payload.priceNotes),
    };
  }

  private asIsoString(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  private async findCampBrochureCandidates(context: ConciergeTurnContext): Promise<CampBrochureCandidate[]> {
    const inquiry = context.activeInquiry;
    const countryCode = inquiry?.country?.code ?? null;
    if (!inquiry || inquiry.family?.key !== 'CAMP' || !countryCode) {
      return [];
    }

    const locationSlug = inquiry.location?.slug ?? undefined;
    const programSlug = inquiry.program?.slug ?? undefined;
    const studentAge = typeof inquiry.studentAge === 'number' && Number.isFinite(inquiry.studentAge)
      ? inquiry.studentAge
      : undefined;
    const targetDate = this.getInquiryTargetDate(inquiry) ?? undefined;
    const byLocation = locationSlug
      ? await this.queryCampBrochureResources({
          countryCode,
          locationSlug,
          programSlug,
          studentAge,
          targetDate,
        })
      : [];

    const locationCandidates = byLocation
      .map((resource) => this.toCampBrochureCandidate(resource))
      .filter((candidate): candidate is CampBrochureCandidate => candidate !== null);
    const seasonalLocationCandidates = this.getSeasonalCampBrochureCandidates(locationCandidates);
    if (locationSlug) {
      return seasonalLocationCandidates.filter((candidate) => resourceTripCompatibility(candidate, inquiry.preferredStartMonth, inquiry.preferredStartYear) !== 'INCOMPATIBLE');
    }

    const byCountry = await this.queryCampBrochureResources({
      countryCode,
      programSlug,
      studentAge,
      targetDate,
    });

    const countryCandidates = byCountry
      .map((resource) => this.toCampBrochureCandidate(resource))
      .filter((candidate): candidate is CampBrochureCandidate => candidate !== null);

    return this.getSeasonalCampBrochureCandidates(countryCandidates).filter((candidate) => resourceTripCompatibility(candidate, inquiry.preferredStartMonth, inquiry.preferredStartYear) !== 'INCOMPATIBLE');
  }

  private async queryCampBrochureResources(input: {
    countryCode: string;
    programSlug?: string;
    locationSlug?: string;
    studentAge?: number;
    targetDate?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const result = await this.toolExecutor.execute('list_available_resources', {
      activeOnly: true,
      familyKey: 'CAMP',
      type: 'BROCHURE',
      countryCode: input.countryCode,
      ...(input.locationSlug ? { locationSlug: input.locationSlug } : {}),
      ...(input.programSlug ? { programSlug: input.programSlug } : {}),
      ...(input.studentAge != null ? { studentAge: input.studentAge } : {}),
      ...(input.targetDate ? { targetDate: input.targetDate } : {}),
    });

    if (!result || typeof result !== 'object') {
      return [];
    }

    const resources = (result as Record<string, unknown>).resources;
    return Array.isArray(resources) ? (resources.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>) : [];
  }

  private getSeasonalCampBrochureCandidates(candidates: CampBrochureCandidate[]): CampBrochureCandidate[] {
    const byVersion = new Map<string, CampBrochureCandidate>();
    for (const candidate of candidates) {
      if (!this.getPrimarySeasonKey(candidate.seasonKeys)) continue;
      byVersion.set(candidate.versionId, candidate);
    }

    const order = ['SUMMER', 'EASTER', 'WINTER'];
    return [...byVersion.values()].sort((left, right) => {
      const leftSeason = this.getPrimarySeasonKey(left.seasonKeys) ?? '';
      const rightSeason = this.getPrimarySeasonKey(right.seasonKeys) ?? '';
      const leftOrder = order.indexOf(leftSeason);
      const rightOrder = order.indexOf(rightSeason);
      const normalizedLeft = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder;
      const normalizedRight = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder;
      if (normalizedLeft !== normalizedRight) {
        return normalizedLeft - normalizedRight;
      }
      return left.resourceTitle.localeCompare(right.resourceTitle, 'es');
    });
  }

  private toCampBrochureCandidate(resource: Record<string, unknown>): CampBrochureCandidate | null {
    const version = resource.currentVersion;
    if (!version || typeof version !== 'object') {
      return null;
    }

    const resourceId = this.asNonEmptyStringValue(resource.id);
    const resourceTitle = this.asNonEmptyStringValue(resource.title);
    const countryCode = this.asNonEmptyStringValue(resource.countryCode);
    const versionId = this.asNonEmptyStringValue((version as Record<string, unknown>).id);
    const fileName = this.asNonEmptyStringValue((version as Record<string, unknown>).fileName);
    const fileUrl = this.asNonEmptyStringValue((version as Record<string, unknown>).fileUrl);

    if (!resourceId || !resourceTitle || !countryCode || !versionId || !fileName || !fileUrl) {
      return null;
    }

    return {
      resourceId,
      resourceTitle,
      countryCode,
      countryName: this.asNonEmptyStringValue(resource.countryName),
      programSlug: this.asNonEmptyStringValue(resource.programSlug),
      programName: this.asNonEmptyStringValue(resource.programName),
      locationSlug: this.asNonEmptyStringValue(resource.locationSlug),
      locationName: this.asNonEmptyStringValue(resource.locationName),
      seasonKeys: Array.isArray(resource.seasonKeys)
        ? resource.seasonKeys.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [],
      versionId,
      fileName,
      fileUrl: this.toPublicUrl(fileUrl),
      mimeType: this.asNonEmptyStringValue((version as Record<string, unknown>).mimeType),
      year: this.asFiniteNumberValue(resource.year),
      validFrom: this.asNonEmptyStringValue(resource.validFrom),
      validUntil: this.asNonEmptyStringValue(resource.validUntil),
      minAge: this.asFiniteNumberValue(resource.minAge),
      maxAge: this.asFiniteNumberValue(resource.maxAge),
      minWeeks: this.asFiniteNumberValue(resource.minWeeks),
      maxWeeks: this.asFiniteNumberValue(resource.maxWeeks),
      tariffs: Array.isArray(resource.tariffs) ? resource.tariffs as ResourceTariff[] : [],
      priceFrom: this.asFiniteNumberValue(resource.priceFrom),
      priceCurrency: this.asNonEmptyStringValue(resource.priceCurrency),
      priceUnit: this.asNonEmptyStringValue(resource.priceUnit),
      priceNotes: this.asNonEmptyStringValue(resource.priceNotes),
    };
  }

  private asNonEmptyStringValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private asFiniteNumberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private getInquiryTargetDate(inquiry: ConciergeTurnContext['activeInquiry']): string | null {
    const month = inquiry?.preferredStartMonth;
    const year = inquiry?.preferredStartYear;
    if (typeof month !== 'number' || typeof year !== 'number' || month < 1 || month > 12) {
      return null;
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  }

  private getLowestCampBrochurePriceText(candidates: CampBrochureCandidate[]): string | null {
    const firstPriced = candidates.find((candidate) => candidate.priceFrom != null && candidate.priceCurrency);
    if (!firstPriced?.priceCurrency || firstPriced.priceFrom == null) return null;

    const comparable = candidates.filter(
      (candidate) => candidate.priceFrom != null && candidate.priceCurrency === firstPriced.priceCurrency,
    );
    const lowest = comparable.reduce(
      (selected, candidate) => candidate.priceFrom! < selected.priceFrom! ? candidate : selected,
      firstPriced,
    );
    const amount = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(lowest.priceFrom!);
    const unit = lowest.priceUnit ? ` por ${lowest.priceUnit}` : '';
    return `desde ${amount} ${lowest.priceCurrency}${unit}`;
  }

  private toPublicUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }

    const baseUrl = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      return pathOrUrl;
    }

    const relative = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${baseUrl}${relative}`;
  }

  private toAbsoluteMediaUrl(pathOrUrl: string | null): string | null {
    if (!pathOrUrl) return null;
    const normalized = this.toPublicUrl(pathOrUrl);
    return /^https?:\/\//i.test(normalized) ? normalized : null;
  }

  private toAbsoluteMediaUrls(pathOrUrls: string[]): string[] {
    return Array.from(
      new Set(
        pathOrUrls
          .map((pathOrUrl) => this.toAbsoluteMediaUrl(pathOrUrl))
          .filter((url): url is string => typeof url === 'string' && url.trim().length > 0),
      ),
    );
  }

  private haveSameCampBrochureCandidates(
    left: CampBrochureCandidate[],
    right: CampBrochureCandidate[],
  ): boolean {
    const identity = (candidate: CampBrochureCandidate) => JSON.stringify([candidate.versionId, candidate.year, candidate.validFrom, candidate.validUntil, [...candidate.seasonKeys].sort()]);
    const leftKeys = left.map(identity).sort();
    const rightKeys = right.map(identity).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((value, index) => value === rightKeys[index]);
  }

  private getPrimarySeasonKey(seasonKeys: string[]): string | null {
    const normalized = seasonKeys.find((seasonKey) => ['SUMMER', 'EASTER', 'WINTER'].includes(seasonKey));
    return normalized ?? null;
  }

  private getCampBrochureSeasonLabels(candidates: CampBrochureCandidate[]): string[] {
    return Array.from(
      new Set(
        candidates
          .flatMap((candidate) => candidate.seasonKeys.filter((key) => ['SUMMER', 'EASTER', 'WINTER'].includes(key)))
          .filter((seasonKey): seasonKey is string => Boolean(seasonKey))
          .map((seasonKey) => this.toSeasonLabel(seasonKey)),
      ),
    );
  }

  private toSeasonLabel(seasonKey: string): string {
    switch (seasonKey) {
      case 'SUMMER':
        return 'verano';
      case 'EASTER':
        return 'Semana Santa';
      case 'WINTER':
        return 'invierno';
      default:
        return seasonKey;
    }
  }

  private fromSeasonLabel(label: string): string | null {
    switch (label) {
      case 'verano':
        return 'SUMMER';
      case 'Semana Santa':
        return 'EASTER';
      case 'invierno':
        return 'WINTER';
      default:
        return null;
    }
  }

  private async resolveCampBrochureReplyAction(
    context: ConciergeTurnContext,
    state: CampBrochureState | null,
  ): Promise<{
    action: 'SEND' | 'DECLINE' | 'CLARIFY' | 'UNKNOWN';
    selectedSeasonKeys: string[];
    sendAll: boolean;
  }> {
    if (!state || (state.status !== 'OFFERED' && state.status !== 'SENT')) {
      return { action: 'UNKNOWN', selectedSeasonKeys: [], sendAll: false };
    }

    const latestMessage = context.latestMessage;
    if (!latestMessage || latestMessage.direction !== 'INBOUND') {
      return { action: 'UNKNOWN', selectedSeasonKeys: [], sendAll: false };
    }

    const previousOutbound = this.findPreviousOutboundMessage(context);
    const seasonOptions = this.getCampBrochureSeasonLabels(state.candidates);
    const hasMultipleSeasonOptions = seasonOptions.length > 1;
    const instructions = [
      'Clasifica la respuesta del usuario sobre un ofrecimiento de folleto PDF.',
      'Devuelve JSON estricto con la forma {"action":"SEND|DECLINE|CLARIFY|UNKNOWN","confidence":number,"selectedSeasonKeys":string[],"sendAll":boolean}.',
      'selectedSeasonKeys solo puede contener SUMMER, EASTER y/o WINTER.',
      'Estado OFFERED: SEND si el usuario confirma que sí quiere que le envíen el folleto y ya dejó clara la temporada o solo hay una temporada disponible.',
      'Puede haber varios folletos de una misma temporada. Si el usuario confirma esa temporada, comparte todos los folletos compatibles, sin pedirle que elija un único archivo.',
      'Estado OFFERED con varias temporadas: CLARIFY si el usuario responde que sí, pero no especifica cuál quiere.',
      'Estado OFFERED con varias temporadas: SEND si el usuario elige una o varias temporadas específicas, o si pide todas.',
      'Estado SENT: SEND si el usuario pide que lo reenvíen, dice que no le llegó, que no ve el archivo, que lo comparta otra vez o insiste en recibir el PDF.',
      'Si el usuario pide todo, márcalo como sendAll=true.',
      'DECLINE: el usuario rechaza, pospone o dice que no quiere folleto.',
      'UNKNOWN: no está claro, responde una pregunta diferente o continúa dando datos del flujo.',
      'No inventes; usa contexto de latestMessage y previousAssistantMessage.',
    ].join('\n');

    try {
      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          brochureState: state.status,
          brochureTitles: state.candidates.map((candidate) => candidate.resourceTitle),
          brochureSeasons: this.getCampBrochureSeasonLabels(state.candidates),
          seasonOptions: seasonOptions.map((label, index) => ({
            number: index + 1,
            label,
            seasonKey: this.fromSeasonLabel(label),
          })),
          hasMultipleSeasonOptions,
          latestMessage: latestMessage.text,
          previousAssistantMessage: previousOutbound?.text ?? null,
          recentMessages: (context.conversation?.messages ?? []).slice(-10).map((message) => ({
            direction: message.direction,
            text: message.text,
          })),
        }),
      });

      const parsed = JSON.parse(response.outputText) as {
        action?: unknown;
        confidence?: unknown;
        selectedSeasonKeys?: unknown;
        sendAll?: unknown;
      };
      const action = parsed?.action;
      const selectedSeasonKeys = Array.isArray(parsed?.selectedSeasonKeys)
        ? parsed.selectedSeasonKeys.filter((item): item is string => item === 'SUMMER' || item === 'EASTER' || item === 'WINTER')
        : [];
      const sendAll = parsed?.sendAll === true;

      if (action === 'SEND' || action === 'DECLINE' || action === 'CLARIFY' || action === 'UNKNOWN') {
        return {
          action,
          selectedSeasonKeys,
          sendAll,
        };
      }
      return { action: 'UNKNOWN', selectedSeasonKeys: [], sendAll: false };
    } catch {
      return { action: 'UNKNOWN', selectedSeasonKeys: [], sendAll: false };
    }
  }

  private selectCampBrochureCandidatesForReply(
    candidates: CampBrochureCandidate[],
    replyAction: { selectedSeasonKeys: string[]; sendAll: boolean },
  ): CampBrochureCandidate[] {
    if (replyAction.sendAll || (replyAction.selectedSeasonKeys.length === 0 && this.getCampBrochureSeasonLabels(candidates).length <= 1)) {
      return candidates;
    }

    if (!replyAction.selectedSeasonKeys.length) {
      return [];
    }

    const selectedSet = new Set(replyAction.selectedSeasonKeys);
    return candidates.filter((candidate) => {
      return candidate.seasonKeys.some((key) => selectedSet.has(key));
    });
  }

  private shouldOfferCampBrochure(
    context: ConciergeTurnContext,
    nextField:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail'
      | null,
    state: CampBrochureState | null,
  ): boolean {
    if (!context.activeInquiry || context.activeInquiry.family?.key !== 'CAMP') return false;
    if (!context.activeInquiry.country?.code) return false;
    if (!state || state.candidates.length === 0) return false;
    if (state.status === 'OFFERED' || state.status === 'SENT' || state.status === 'DECLINED') return false;
    if (nextField === 'country' || nextField === 'studentAge' || nextField === 'family') return false;
    const needsTargetDate = state.candidates.some((candidate) => candidate.year || candidate.validFrom || candidate.validUntil);
    if (
      needsTargetDate
      && !this.getInquiryTargetDate(context.activeInquiry)
      && this.getPreferredStartStatusFromInquiry(context.activeInquiry) !== 'UNDECIDED'
    ) {
      return false;
    }
    return true;
  }

  private async buildPromptDrivenCampBrochureOffer(params: {
    context: ConciergeTurnContext;
    candidates: CampBrochureCandidate[];
  }): Promise<string> {
    const countryName = params.candidates[0]?.countryName ?? 'este país';
    const seasonLabels = this.getCampBrochureSeasonLabels(params.candidates);
    const years = [...new Set(params.candidates.flatMap((candidate) => candidate.year ? [candidate.year] : []))].sort();
    const editionText = years.length ? ` (edición ${years.join(', ')})` : '';
    const priceText = this.getLowestCampBrochurePriceText(params.candidates);
    const fallback =
      seasonLabels.length > 1
        ? `Tengo folletos disponibles para ${countryName} en estas temporadas: ${seasonLabels.join(', ')}${editionText}${priceText ? `, con opciones ${priceText}` : ''} 😊. ¿Cuál te gustaría que te comparta?`
        : seasonLabels.length > 0
        ? `Tengo ${params.candidates.length > 1 ? 'folletos disponibles' : 'un folleto disponible'} para ${countryName} en ${seasonLabels.join(', ')}${editionText}${priceText ? `, ${priceText}` : ''} 😊. ¿Quieres que te ${params.candidates.length > 1 ? 'los' : 'lo'} comparta ahora?`
        : `Tengo folletos disponibles para ${countryName}${priceText ? `, ${priceText}` : ''} 😊. ¿Quieres que te los comparta ahora?`;
    if (!priceText) return fallback;

    try {
      const instructions = [
        'Eres un concierge comercial de TKTours.',
        'Redacta un mensaje breve, cálido y natural en español para ofrecer folletos PDF de campamentos.',
        'Puedes usar como máximo 1 emoji natural si ayuda al tono.',
        'Indica el año de edición de los folletos usando editionYears. No asumas el año actual.',
        'Si hay temporadas disponibles, menciónalas de forma clara y natural usando verano, Semana Santa e invierno.',
        'Si hay más de una temporada disponible, pide al usuario que elija cuál quiere recibir.',
        'Si solo hay una temporada, termina con una pregunta de confirmación para enviarlo.',
        'Menciona un precio solo cuando el folleto tenga importe y moneda. Exprésalo con "desde", importe y moneda exactos. Si ninguno tiene precio completo, no menciones precios ni cifras.',
        'No inventes, conviertas ni calcules precios.',
        'No menciones procesos internos ni herramientas.',
        'No uses formato JSON.',
      ].join('\n');

      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          familyKey: params.context.activeInquiry?.family?.key ?? null,
          countryName,
          availableSeasons: seasonLabels,
          editionYears: years,
          brochures: params.candidates.map((candidate) => ({
            title: candidate.resourceTitle,
            seasonKeys: candidate.seasonKeys,
            year: candidate.year,
            locationName: candidate.locationName,
            priceFrom: candidate.priceFrom != null && candidate.priceCurrency ? candidate.priceFrom : null,
            priceCurrency: candidate.priceFrom != null && candidate.priceCurrency ? candidate.priceCurrency : null,
            priceUnit: candidate.priceFrom != null && candidate.priceCurrency ? candidate.priceUnit : null,
            priceNotes: candidate.priceFrom != null && candidate.priceCurrency ? candidate.priceNotes : null,
          })),
          latestUserMessage: params.context.latestMessage?.text ?? null,
        }),
      });

      return (response.outputText ?? '').trim() || fallback;
    } catch {
      return fallback;
    }
  }

  private async buildPromptDrivenCampBrochureSeasonChoice(params: {
    context: ConciergeTurnContext;
    candidates: CampBrochureCandidate[];
  }): Promise<string> {
    const seasonLabels = this.getCampBrochureSeasonLabels(params.candidates);
    const years = [...new Set(params.candidates.flatMap((candidate) => candidate.year ? [candidate.year] : []))].sort();
    const editionText = years.length ? ` (edición ${years.join(', ')})` : '';
    const fallback = `Con gusto 😊. Tengo disponible ${seasonLabels.join(', ')}${editionText}. ¿Cuál prefieres que te comparta?`;
    try {
      const instructions = [
        'Eres un concierge comercial de TKTours.',
        'Redacta un mensaje breve, amable y natural en español.',
        'Puedes usar como máximo 1 emoji natural si ayuda al tono.',
        'Indica el año de edición de los folletos usando editionYears. No asumas el año actual.',
        'Pide al usuario que elija una o varias temporadas entre verano, Semana Santa e invierno.',
        'También puedes decir que, si lo prefiere, le puedes compartir todas las opciones disponibles.',
        'No uses formato JSON.',
      ].join('\n');

      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          countryName: params.candidates[0]?.countryName ?? null,
          availableSeasons: seasonLabels,
          editionYears: years,
        }),
      });

      return (response.outputText ?? '').trim() || fallback;
    } catch {
      return fallback;
    }
  }

  private async buildPromptDrivenCampBrochureSend(params: {
    context: ConciergeTurnContext;
    candidates: CampBrochureCandidate[];
  }): Promise<string> {
    return `Claro, te comparto los folletos disponibles:\n${params.candidates.map((candidate) => this.describeResource(candidate)).join('\n')}`;
  }

  private async findMatchingCircuitResourceCandidate(context: ConciergeTurnContext): Promise<CircuitResourceCandidate | null> {
    const inquiry = context.activeInquiry;
    const countryCode = inquiry?.country?.code ?? null;
    const tripDays = this.getTripDaysFromInquiry(inquiry);
    if (!inquiry || !this.isCircuitsInquiry(inquiry) || !countryCode || tripDays == null) {
      return null;
    }

    const result = await this.toolExecutor.execute('list_available_resources', {
      activeOnly: true,
      familyKey: 'SCHOOL_PROGRAM',
      countryCode,
    });

    const resources =
      result && typeof result === 'object' && Array.isArray((result as { resources?: unknown }).resources)
        ? ((result as { resources: Array<Record<string, unknown>> }).resources ?? [])
        : [];

    const candidates = resources
      .map((resource) => this.toCircuitResourceCandidate(resource))
      .filter((candidate): candidate is CircuitResourceCandidate => candidate !== null);

    if (!candidates.length) {
      return null;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    try {
      const response = await this.responsesClient.createTextResponse({
        instructions: [
          'Eres un concierge comercial de TKTours.',
          'Debes elegir si alguno de los itinerarios disponibles coincide claramente con la duración solicitada por el cliente.',
          'Usa title, description y summary para decidir.',
          'Solo elige un recurso si la coincidencia de duración es clara o razonablemente compatible.',
          'Si no hay una coincidencia clara, responde null como selectedResourceId.',
          'Devuelve JSON estricto con la forma {"selectedResourceId": string|null, "confidence": number}.',
        ].join('\n'),
        input: JSON.stringify({
          destination: inquiry.country?.name ?? countryCode,
          tripDays,
          latestUserMessage: context.latestMessage?.text ?? null,
          resources: candidates.map((candidate) => ({
            resourceId: candidate.resourceId,
            title: candidate.resourceTitle,
            description: candidate.description,
            summary: candidate.summary,
            fileName: candidate.fileName,
          })),
        }),
      });

      const parsed = JSON.parse(response.outputText) as {
        selectedResourceId?: unknown;
        confidence?: unknown;
      };
      const selectedResourceId =
        typeof parsed.selectedResourceId === 'string' && parsed.selectedResourceId.trim().length > 0
          ? parsed.selectedResourceId.trim()
          : null;
      const confidence =
        typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : 0;

      if (!selectedResourceId || confidence < 0.55) {
        return null;
      }

      return candidates.find((candidate) => candidate.resourceId === selectedResourceId) ?? null;
    } catch {
      return null;
    }
  }

  private toCircuitResourceCandidate(resource: Record<string, unknown>): CircuitResourceCandidate | null {
    const base = this.toCampBrochureCandidate(resource);
    if (!base) {
      return null;
    }

    const currentVersion =
      resource.currentVersion && typeof resource.currentVersion === 'object'
        ? (resource.currentVersion as Record<string, unknown>)
        : null;

    return {
      ...base,
      description: this.asNonEmptyStringValue(resource.description),
      summary: currentVersion ? this.asNonEmptyStringValue(currentVersion.summary) : null,
    };
  }

  private async buildPromptDrivenCircuitResourceSend(params: {
    context: ConciergeTurnContext;
    candidate: CircuitResourceCandidate;
  }): Promise<string> {
    const fallback = 'Con gusto 😊, te comparto el itinerario en PDF para que lo revises con calma.';
    try {
      const response = await this.responsesClient.createTextResponse({
        instructions: [
          'Eres un concierge comercial de TKTours.',
          'Redacta un mensaje breve, amable y natural en español para compartir un itinerario de viaje como archivo adjunto.',
          'Puedes usar como máximo 1 emoji natural si ayuda al tono.',
          'No incluyas enlaces, rutas internas ni nombres técnicos.',
          'Puedes mencionar de forma breve que, si lo desea, un asesor puede ayudarle a revisar más opciones.',
          'Responde solo texto plano.',
        ].join('\n'),
        input: JSON.stringify({
          destination: params.context.activeInquiry?.country?.name ?? null,
          tripDays: this.getTripDaysFromInquiry(params.context.activeInquiry),
          resourceTitle: params.candidate.resourceTitle,
          description: params.candidate.description,
          summary: params.candidate.summary,
        }),
      });

      const candidate = (response.outputText ?? '').trim();
      return candidate || fallback;
    } catch {
      return fallback;
    }
  }

  private async buildPromptDrivenCircuitNoMatch(params: {
    context: ConciergeTurnContext;
    fallbackReplyText: string;
  }): Promise<string> {
    try {
      const response = await this.responsesClient.createTextResponse({
        instructions: [
          'Eres un concierge comercial de TKTours.',
          'Redacta un mensaje breve, amable y natural en español.',
          'Puedes usar como máximo 1 emoji natural si ayuda al tono.',
          'Explica que por el momento no ves un itinerario que coincida claramente con el destino y la duración solicitados.',
          'Indica que un asesor de TKTours dará seguimiento para proponer alternativas.',
          'No pidas datos adicionales en este mensaje.',
          'No inventes itinerarios.',
          'Responde solo texto plano.',
        ].join('\n'),
        input: JSON.stringify({
          destination: params.context.activeInquiry?.country?.name ?? null,
          tripDays: this.getTripDaysFromInquiry(params.context.activeInquiry),
          latestUserMessage: params.context.latestMessage?.text ?? null,
        }),
      });

      const candidate = (response.outputText ?? '').trim();
      return candidate || params.fallbackReplyText;
    } catch {
      return params.fallbackReplyText;
    }
  }

  private mergeContextPatch(
    base: Record<string, unknown> | null,
    patch: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!base && !patch) return null;
    return {
      ...(base ?? {}),
      ...(patch ?? {}),
    };
  }

  private async applyCityResourceFlow(
    parsed: ReturnType<ConciergeOrchestratorService['parseStructuredResponse']>,
    context: ConciergeTurnContext,
  ): Promise<Awaited<ReturnType<ConciergeOrchestratorService['applyReplyPolicy']>> | null> {
    const inquiry = context.activeInquiry;
    const countryCode = inquiry?.country?.code;
    const familyKey = inquiry?.family?.key;
    if (!countryCode || !familyKey || !['CAMP', 'LANGUAGE_COURSE'].includes(familyKey)) return null;

    const latest = context.latestMessage?.text ?? '';
    const asksForCities = /\bciudad(?:es)?\b/i.test(latest);
    // Answer unrelated questions first instead of trapping the customer in the city menu.
    if (!context.cityWasSelected && !context.countryWasSelected && !context.travelDateWasSelected && !asksForCities
      && (parsed.replyIntent === 'ANSWER_QUESTION' || parsed.replyIntent === 'CHANGE_TOPIC')) return null;

    const locationSlug = inquiry?.location?.slug;
    const { cities, resources } = await new ConciergeCityResourcesService(this.toolExecutor).load({
      countryCode, familyKey, studentAge: inquiry?.studentAge ?? undefined,
      ...(locationSlug && !asksForCities ? { locationSlug } : {}),
    });
    if (!locationSlug || asksForCities) {
      const replyText = cities.length
        ? `¡Con gusto! 😊 Actualmente tenemos programas en las siguientes ciudades de ${inquiry?.country?.name ?? countryCode}:\n${cities.map((city, index) => `${index + 1}) ${city.name}`).join('\n')}\n\n¿Qué ciudad te interesa? 📍`
        : `Por el momento no tengo ciudades con programas o folletos disponibles para ${inquiry?.country?.name ?? countryCode}. Un asesor de TKTours puede ayudarte a revisar alternativas. 😊`;
      return {
        structured: { ...parsed, replyText, missingFields: [], shouldAskFollowUp: cities.length > 0,
          nextStage: cities.length ? 'QUALIFY_PROGRAM' : 'ESCALATED', shouldRefreshRecommendations: false },
        contextPatch: { cityResourceMenu: { countryCode, familyKey, options: cities, replyText } },
        trace: { strategy: cities.length ? 'single_follow_up' : 'none', details: { reason: 'destination_city_menu' } },
        outboundMediaUrls: [], outboundMediaUrl: null,
      };
    }

    const matching = resources.filter((resource) => resource.countryCode === countryCode && resource.familyKey === familyKey
      && (resource.locationSlug === locationSlug
        || (Array.isArray(resource.locationSlugs) && resource.locationSlugs.includes(locationSlug))));
    const candidates = [...new Map(matching.map((resource) => this.toCampBrochureCandidate(resource))
      .filter((candidate): candidate is CampBrochureCandidate => candidate !== null)
      .map((candidate) => [candidate.versionId, candidate])).values()];
    const cityName = inquiry?.location?.name ?? cities.find((city) => city.slug === locationSlug)?.name ?? locationSlug;
    const now = new Date().toISOString();
    const month = inquiry?.preferredStartMonth;
    const year = inquiry?.preferredStartYear;
    const compatible = candidates.filter((candidate) => resourceTripCompatibility(candidate, month, year) !== 'INCOMPATIBLE');
    const confirmed = compatible.filter((candidate) => resourceTripCompatibility(candidate, month, year) === 'CONFIRMED');
    if (month && !confirmed.length && candidates.length) {
      const monthName = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)));
      const maintainMonth = /(?:prefiero|mantener|mantengo|seguir|quedarme).*(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|(?:asesor|seguimiento)/i.test(latest);
      if (maintainMonth) return {
        structured: { ...parsed, replyText: `Mantendremos tu preferencia por ${monthName}${year ? ` de ${year}` : ''}. Un asesor de TKTours dará seguimiento para confirmar opciones para esas fechas.`, missingFields: [], shouldAskFollowUp: false, nextStage: 'ESCALATED', shouldRefreshRecommendations: false },
        trace: { strategy: 'none', details: { reason: 'requested_month_advisor_follow_up' } },
        contextPatch: {}, outboundMediaUrls: [], outboundMediaUrl: null,
      };
      return {
        structured: { ...parsed,
          replyText: `Para ${monthName}${year ? ` de ${year}` : ''} no tengo fechas de viaje confirmadas en estos folletos de ${cityName}. Las opciones registradas son:\n${candidates.map((candidate) => this.describeResource(candidate)).join('\n')}\n\n¿Te sirven estas fechas o prefieres mantener ${monthName} para seguimiento de un asesor?`,
          missingFields: [], shouldAskFollowUp: true, nextStage: 'QUALIFY_DATES', shouldRefreshRecommendations: false },
        trace: { strategy: 'single_follow_up', details: { reason: 'requested_month_not_confirmed' } },
        contextPatch: {}, outboundMediaUrls: [], outboundMediaUrl: null,
      };
    }
    const requestsBrochure = explicitlyRequestsResource(latest);
    const pending = inquiry?.id
      ? await new ResourceSendHistoryService().pendingVersions(inquiry.id, compatible, requestsBrochure)
      : compatible;
    if (compatible.length && !pending.length) return null;
    if (!compatible.length && !context.cityWasSelected && !context.countryWasSelected && !requestsBrochure && inquiry?.id) {
      const history = await prisma.inquiryResourceSend.findFirst({ where: { inquiryId: inquiry.id } });
      if (history) return null;
    }
    const mediaUrls = this.toAbsoluteMediaUrls(pending.map((candidate) => candidate.fileUrl));
    if (!mediaUrls.length) {
      return {
        structured: { ...parsed, replyText: `En ${cityName} por el momento no tengo folletos vigentes compatibles con tu solicitud. Con gusto, un asesor de TKTours te ayudará con información actualizada. 😊`,
          missingFields: [], shouldAskFollowUp: false, nextStage: 'ESCALATED', shouldRefreshRecommendations: false },
        trace: { strategy: 'none', details: { reason: 'city_brochures_unavailable' } }, outboundMediaUrls: [], outboundMediaUrl: null,
        contextPatch: {},
      };
    }
    const documents = pending.map((candidate) => this.describeResource(candidate)).join('\n');
    const nextField = this.getEnforcedNextField(inquiry);
    const followUp = nextField ? await this.buildPromptDrivenFollowUp({ context, nextField, fallbackReplyText: '' }) : null;
    return {
      structured: { ...parsed, replyText: `¡Perfecto! 😊📎 Te comparto los folletos disponibles para ${cityName}:\n${documents}${followUp ? `\n\n${followUp}` : ''}`,
        missingFields: nextField ? [nextField] : [], shouldAskFollowUp: Boolean(followUp),
        nextStage: nextField ? this.mapNextStageFromField(nextField) : 'SEND_RESOURCE', shouldRefreshRecommendations: false },
      trace: { strategy: followUp ? 'single_follow_up' : 'none', details: { reason: 'city_brochures_sent', resourceIds: candidates.map((candidate) => candidate.resourceId) } },
      outboundMediaUrls: mediaUrls, outboundMediaUrl: mediaUrls[0] ?? null,
      contextPatch: {
        cityResourceDelivery: { countryCode, familyKey, locationSlug, versionIds: candidates.map((candidate) => candidate.versionId) },
        ...(familyKey === 'CAMP' ? { [this.campBrochureContextKey]: { status: 'SENT', candidates, checkedAt: now, offeredAt: null, sentAt: now } } : {}),
      },
    };
  }

  private describeResource(candidate: CampBrochureCandidate): string {
    const seasons = this.getCampBrochureSeasonLabels([candidate]);
    const dates = candidate.validFrom && candidate.validUntil
      ? `viaje del ${candidate.validFrom} al ${candidate.validUntil}` : 'fechas del viaje por confirmar';
    const duration = candidate.minWeeks != null && candidate.maxWeeks != null
      ? candidate.minWeeks === candidate.maxWeeks ? `${candidate.minWeeks} semanas` : `${candidate.minWeeks} a ${candidate.maxWeeks} semanas`
      : 'duración por confirmar';
    const price = this.getLowestCampBrochurePriceText([candidate]);
    return `• ${candidate.resourceTitle}${candidate.year ? ` (edición ${candidate.year})` : ', edición por confirmar'} — ${seasons.join(', ') || 'temporada por confirmar'}; ${dates}; ${duration}${price ? `; ${price}` : ''}`;
  }

  private async hydrateInquiryFamilyFromIntent(
    context: ConciergeTurnContext,
    detectedIntent:
      | 'GREETING'
      | 'MENU_OPTION_1'
      | 'MENU_OPTION_2'
      | 'MENU_OPTION_3'
      | 'ASK_AVAILABLE_COUNTRIES'
      | 'ASK_AVAILABLE_PROGRAMS'
      | 'REQUEST_QUOTE'
      | 'ASK_LANGUAGE_COURSES'
      | 'ASK_CAMPS'
      | 'ASK_CIRCUITS'
      | 'UNKNOWN',
  ): Promise<ConciergeTurnContext> {
    if (!context.activeInquiry || context.activeInquiry.family?.key) {
      return context;
    }

    let familyKey: 'LANGUAGE_COURSE' | 'CAMP' | 'SCHOOL_PROGRAM' | null = null;
    if (detectedIntent === 'MENU_OPTION_1' || detectedIntent === 'ASK_LANGUAGE_COURSES') {
      familyKey = 'LANGUAGE_COURSE';
    } else if (detectedIntent === 'MENU_OPTION_2' || detectedIntent === 'ASK_CAMPS') {
      familyKey = 'CAMP';
    } else if (detectedIntent === 'MENU_OPTION_3' || detectedIntent === 'ASK_CIRCUITS') {
      familyKey = 'SCHOOL_PROGRAM';
    }

    if (!familyKey) {
      return context;
    }
    if (context.availableCourseTypes && !context.availableCourseTypes.some((offering) => offering.familyKey === familyKey)) return context;

    await this.inquiryRepository.update({
      inquiryId: context.activeInquiry.id,
      familyKey,
      qualificationJson: this.mergeQualificationJson(context.activeInquiry.qualificationJson, {
        requestMode: familyKey === 'SCHOOL_PROGRAM' ? 'CIRCUITS' : undefined,
      }),
    });

    const refreshedInquiry = await this.inquiryRepository.findById(context.activeInquiry.id);
    return {
      ...context,
      activeInquiry: refreshedInquiry ?? context.activeInquiry,
    };
  }

  private async detectIntentWithTool(
    context: ConciergeTurnContext,
  ): Promise<
    | 'GREETING'
    | 'MENU_OPTION_1'
    | 'MENU_OPTION_2'
    | 'MENU_OPTION_3'
    | 'ASK_AVAILABLE_COUNTRIES'
    | 'ASK_AVAILABLE_PROGRAMS'
      | 'REQUEST_QUOTE'
      | 'ASK_LANGUAGE_COURSES'
      | 'ASK_CAMPS'
      | 'ASK_CIRCUITS'
      | 'UNKNOWN'
  > {
    const latestMessage = context.latestMessage?.text ?? '';
    const choice = displayedCourseChoice(latestMessage, this.findPreviousOutboundMessage(context)?.text ?? null);
    if (choice) return choice === 'LANGUAGE_COURSE' ? 'MENU_OPTION_1' : choice === 'CAMP' ? 'MENU_OPTION_2' : 'MENU_OPTION_3';
    if (context.cityWasSelected || /^\d{1,2}[.)]?$/.test(latestMessage.trim())) return 'UNKNOWN';
    const recentMessages = (context.conversation?.messages ?? [])
      .slice(-12)
      .map((message) => ({
        direction: message.direction,
        text: message.text,
      }));

    try {
      const result = await this.toolExecutor.execute('detect_user_intent', {
        latestMessage,
        recentMessages,
      });

      if (!result || typeof result !== 'object') {
        return 'UNKNOWN';
      }

      const intent = (result as Record<string, unknown>).intent;
      if (typeof intent !== 'string') {
        return 'UNKNOWN';
      }

      if (
        intent === 'GREETING' ||
        intent === 'MENU_OPTION_1' ||
        intent === 'MENU_OPTION_2' ||
        intent === 'MENU_OPTION_3' ||
        intent === 'ASK_AVAILABLE_COUNTRIES' ||
        intent === 'ASK_AVAILABLE_PROGRAMS' ||
        intent === 'REQUEST_QUOTE' ||
        intent === 'ASK_LANGUAGE_COURSES' ||
        intent === 'ASK_CAMPS' ||
        intent === 'ASK_CIRCUITS' ||
        intent === 'UNKNOWN'
      ) {
        return intent;
      }

      return 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private async evaluatePolicySignalsWithTool(context: ConciergeTurnContext): Promise<{
    menuWasShown: boolean;
    asksAccommodationOptions: boolean;
    isNegativeProgramAnswer: boolean;
    handoffStep: 'ask_name' | 'ask_email' | 'confirm_handoff' | 'none';
    resolvedCountryCode:
      | 'CA'
      | 'US'
      | 'GB'
      | 'IT'
      | 'FR'
      | 'IE'
      | 'MX'
      | 'EUROPE'
      | 'SOUTH_AMERICA'
      | 'ASIA'
      | 'OTHER_DESTINATIONS'
      | null;
    confidence: number;
    needsClarification: boolean;
  }> {
    const latestMessage = context.latestMessage?.text ?? '';
    const previousOutbound = this.findPreviousOutboundMessage(context);
    const recentMessages = (context.conversation?.messages ?? [])
      .slice(-15)
      .map((message) => ({
        direction: message.direction,
        text: message.text,
      }));

    try {
      const result = await this.toolExecutor.execute('evaluate_policy_signals', {
        latestMessage,
        previousAssistantMessage: previousOutbound?.text ?? null,
        recentMessages,
        inquirySnapshot: {
          countryCode: context.activeInquiry?.country?.code ?? null,
          familyKey: context.activeInquiry?.family?.key ?? null,
          studentAge: context.activeInquiry?.studentAge ?? null,
          contactLastName: context.activeInquiry?.contact?.lastName ?? null,
          contactEmail: context.activeInquiry?.contact?.email ?? null,
        },
      });

      if (!result || typeof result !== 'object') {
        return {
          menuWasShown: false,
          asksAccommodationOptions: false,
          isNegativeProgramAnswer: false,
          handoffStep: 'none',
          resolvedCountryCode: null,
          confidence: 0,
          needsClarification: true,
        };
      }

      const payload = result as Record<string, unknown>;
      const handoffStep =
        payload.handoffStep === 'ask_name' || payload.handoffStep === 'ask_email' || payload.handoffStep === 'confirm_handoff'
          ? payload.handoffStep
          : 'none';
      const resolvedCountryCode =
        payload.resolvedCountryCode === 'CA' ||
        payload.resolvedCountryCode === 'US' ||
        payload.resolvedCountryCode === 'GB' ||
        payload.resolvedCountryCode === 'IT' ||
        payload.resolvedCountryCode === 'FR' ||
        payload.resolvedCountryCode === 'IE' ||
        payload.resolvedCountryCode === 'MX' ||
        payload.resolvedCountryCode === 'EUROPE' ||
        payload.resolvedCountryCode === 'SOUTH_AMERICA' ||
        payload.resolvedCountryCode === 'ASIA' ||
        payload.resolvedCountryCode === 'OTHER_DESTINATIONS'
          ? payload.resolvedCountryCode
          : null;
      const confidence =
        typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)
          ? Math.max(0, Math.min(1, payload.confidence))
          : 0;

      return {
        menuWasShown: payload.menuWasShown === true,
        asksAccommodationOptions: payload.asksAccommodationOptions === true,
        isNegativeProgramAnswer: payload.isNegativeProgramAnswer === true,
        handoffStep,
        resolvedCountryCode,
        confidence,
        needsClarification: payload.needsClarification === true,
      };
    } catch {
      return {
        menuWasShown: false,
        asksAccommodationOptions: false,
        isNegativeProgramAnswer: false,
        handoffStep: 'none',
        resolvedCountryCode: null,
        confidence: 0,
        needsClarification: true,
      };
    }
  }

  private getLanguageCourseAgeBlock(
    context: ConciergeTurnContext,
    detectedIntent:
      | 'GREETING'
      | 'MENU_OPTION_1'
      | 'MENU_OPTION_2'
      | 'MENU_OPTION_3'
      | 'ASK_AVAILABLE_COUNTRIES'
      | 'ASK_AVAILABLE_PROGRAMS'
      | 'REQUEST_QUOTE'
      | 'ASK_LANGUAGE_COURSES'
      | 'ASK_CAMPS'
      | 'ASK_CIRCUITS'
      | 'UNKNOWN',
  ): { studentAge: number } | null {
    const studentAge = context.activeInquiry?.studentAge;
    if (typeof studentAge !== 'number' || !Number.isFinite(studentAge)) {
      return null;
    }

    const familyKey = context.activeInquiry?.family?.key ?? null;
    const isLanguageCourseFlow =
      familyKey === 'LANGUAGE_COURSE' ||
      detectedIntent === 'MENU_OPTION_1' ||
      detectedIntent === 'ASK_LANGUAGE_COURSES';

    if (!isLanguageCourseFlow || studentAge >= 15) {
      return null;
    }

    return {
      studentAge,
    };
  }

  private mapNextStageFromField(
    field:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail',
  ):
    | 'START'
    | 'QUALIFY_AGE'
    | 'QUALIFY_COUNTRY'
    | 'QUALIFY_PROGRAM'
    | 'QUALIFY_ACCOMMODATION'
    | 'QUALIFY_DATES'
    | 'RECOMMEND'
    | 'SEND_RESOURCE'
    | 'ESCALATED'
    | 'CLOSED'
    | null {
    switch (field) {
      case 'studentAge':
        return 'QUALIFY_AGE';
      case 'country':
      case 'residenceCountry':
      case 'cityOfResidence':
      case 'tripDays':
        return 'QUALIFY_COUNTRY';
      case 'family':
      case 'program':
        return 'QUALIFY_PROGRAM';
      case 'accommodation':
        return 'QUALIFY_ACCOMMODATION';
      case 'preferredStartMonth':
      case 'preferredStartYear':
      case 'weeks':
        return 'QUALIFY_DATES';
      case 'contactName':
      case 'contactEmail':
        return 'RECOMMEND';
      default:
        return null;
    }
  }

  private getEnforcedNextField(
    inquiry: ConciergeTurnContext['activeInquiry'],
  ):
    | 'country'
    | 'studentAge'
    | 'residenceCountry'
    | 'cityOfResidence'
    | 'tripDays'
    | 'family'
    | 'accommodation'
    | 'preferredStartMonth'
    | 'preferredStartYear'
    | 'weeks'
    | 'contactName'
    | 'contactEmail'
    | null {
    if (!inquiry) return null;
    const preferredStartStatus = this.getPreferredStartStatusFromInquiry(inquiry);
    const weeksStatus = this.getWeeksStatusFromInquiry(inquiry);
    if (!inquiry.family?.key) return 'family';

    if (this.isCircuitsInquiry(inquiry)) {
      if (!inquiry.country?.code) return 'country';
      if (this.getTripDaysFromInquiry(inquiry) == null) return 'tripDays';
      return null;
    }

    if (inquiry.family.key === 'CAMP') {
      if (inquiry.studentAge == null) return 'studentAge';
      if (!inquiry.country?.code) return 'country';
      if (!this.getResidenceCountryFromInquiry(inquiry)) return 'residenceCountry';
      if (preferredStartStatus !== 'UNDECIDED' && inquiry.preferredStartMonth == null) return 'preferredStartMonth';
      if (weeksStatus !== 'UNDECIDED' && inquiry.weeks == null) return 'weeks';
      if (!this.hasContactNameForInquiry(inquiry)) return 'contactName';
      if (!this.hasContactEmailForInquiry(inquiry)) return 'contactEmail';
      return null;
    }

    if (!inquiry.country?.code) return 'country';
    if (inquiry.studentAge == null) return 'studentAge';
    if (!this.getResidenceCountryFromInquiry(inquiry)) return 'residenceCountry';
    if (preferredStartStatus !== 'UNDECIDED' && inquiry.preferredStartMonth == null) return 'preferredStartMonth';
    if (weeksStatus !== 'UNDECIDED' && inquiry.weeks == null) return 'weeks';
    if (!this.hasContactNameForInquiry(inquiry)) return 'contactName';
    if (!this.hasContactEmailForInquiry(inquiry)) return 'contactEmail';
    return null;
  }

  private getFirstStillMissingField(
    fields: Array<
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail'
    >,
    inquiry: ConciergeTurnContext['activeInquiry'],
  ): 
    | 'country'
    | 'studentAge'
    | 'residenceCountry'
    | 'cityOfResidence'
    | 'tripDays'
    | 'family'
    | 'program'
    | 'accommodation'
    | 'preferredStartMonth'
    | 'preferredStartYear'
    | 'weeks'
    | 'contactName'
    | 'contactEmail'
    | null {
    return fields.find((field) => this.isFieldStillMissing(field, inquiry)) ?? null;
  }

  private sanitizeMissingFieldsForInquiry(
    fields: Array<
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail'
    >,
    inquiry: ConciergeTurnContext['activeInquiry'],
  ): Array<
    | 'country'
    | 'studentAge'
    | 'residenceCountry'
    | 'cityOfResidence'
    | 'tripDays'
    | 'family'
    | 'program'
    | 'accommodation'
    | 'preferredStartMonth'
    | 'preferredStartYear'
    | 'weeks'
    | 'contactName'
    | 'contactEmail'
  > {
    fields = fields.filter((field) => field !== 'preferredStartYear' && field !== 'accommodation');
    if (!inquiry) {
      return fields;
    }

    if (this.isCircuitsInquiry(inquiry)) {
      return fields.filter((field) => field === 'country' || field === 'tripDays');
    }

    if (inquiry.family?.key === 'CAMP') {
      return fields.filter((field) =>
        [
          'studentAge',
          'country',
          'residenceCountry',
          'preferredStartMonth',
          'weeks',
          'contactName',
          'contactEmail',
        ].includes(field),
      );
    }

    return fields.filter((field) =>
      [
        'country',
        'studentAge',
        'residenceCountry',
        'preferredStartMonth',
        'weeks',
        'contactName',
        'contactEmail',
      ].includes(field),
    );
  }

  private isFieldStillMissing(
    field:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail',
    inquiry: ConciergeTurnContext['activeInquiry'],
  ): boolean {
    if (!inquiry) return false;

    switch (field) {
      case 'country':
        return !inquiry.country?.code;
      case 'studentAge':
        return inquiry.studentAge == null;
      case 'residenceCountry':
        return !this.getResidenceCountryFromInquiry(inquiry);
      case 'cityOfResidence':
        return !inquiry.cityOfResidence;
      case 'tripDays':
        return this.getTripDaysFromInquiry(inquiry) == null;
      case 'family':
        return !inquiry.family?.key;
      case 'program':
        return false;
      case 'accommodation':
        return false;
      case 'preferredStartMonth':
        return this.getPreferredStartStatusFromInquiry(inquiry) !== 'UNDECIDED' && inquiry.preferredStartMonth == null;
      case 'preferredStartYear':
        return false;
      case 'weeks':
        return this.getWeeksStatusFromInquiry(inquiry) !== 'UNDECIDED' && inquiry.weeks == null;
      case 'contactName':
        return !this.hasContactNameForInquiry(inquiry);
      case 'contactEmail':
        return !this.hasContactEmailForInquiry(inquiry);
      default:
        return false;
    }
  }

  private normalizeHandoffStep(
    context: ConciergeTurnContext,
    handoffStep: 'ask_name' | 'ask_email' | 'confirm_handoff' | 'none',
  ): 'ask_name' | 'ask_email' | 'confirm_handoff' | null {
    if (handoffStep === 'none') {
      return null;
    }

    if (!this.isReadyForAdvisorHandoff(context)) {
      return null;
    }

    const contact = context.activeInquiry?.contact ?? context.conversation?.contact ?? null;
    const hasName = this.hasContactName(context);
    const hasEmail = this.hasContactEmail(context);

    if (!hasName) {
      return 'ask_name';
    }
    if (!hasEmail) {
      return 'ask_email';
    }
    return 'confirm_handoff';
  }

  private isReadyForAdvisorHandoff(context: ConciergeTurnContext): boolean {
    const inquiry = context.activeInquiry;
    if (!inquiry?.family?.key) return false;
    if (this.isCircuitsInquiry(inquiry)) return false;
    if (!inquiry.country?.code) return false;
    if (inquiry.studentAge == null) return false;
    if (!this.getResidenceCountryFromInquiry(inquiry)) return false;
    return true;
  }

  private hasContactEmail(context: ConciergeTurnContext): boolean {
    const email = context.activeInquiry?.contact?.email ?? context.conversation?.contact?.email ?? null;
    return typeof email === 'string' && email.trim().length > 0;
  }

  private hasContactName(context: ConciergeTurnContext): boolean {
    return this.hasContactNameForInquiry(context.activeInquiry) || this.hasContactNameFromContact(context.conversation?.contact ?? null);
  }

  private hasContactNameForInquiry(inquiry: ConciergeTurnContext['activeInquiry']): boolean {
    return this.hasContactNameFromContact(inquiry?.contact ?? null);
  }

  private hasContactEmailForInquiry(inquiry: ConciergeTurnContext['activeInquiry']): boolean {
    const email = inquiry?.contact?.email ?? null;
    return typeof email === 'string' && email.trim().length > 0;
  }

  private hasContactNameFromContact(contact: { firstName?: string | null; lastName?: string | null } | null): boolean {
    const firstName = contact?.firstName?.trim() ?? '';
    const lastName = contact?.lastName?.trim() ?? '';
    return Boolean(lastName || (firstName && firstName.includes(' ')));
  }

  private isCircuitsInquiry(inquiry: ConciergeTurnContext['activeInquiry']): boolean {
    if (!inquiry || inquiry.family?.key !== 'SCHOOL_PROGRAM') {
      return false;
    }
    const qualification = inquiry.qualificationJson;
    return Boolean(
      qualification &&
        typeof qualification === 'object' &&
        (qualification as Record<string, unknown>).requestMode === 'CIRCUITS',
    );
  }

  private getTripDaysFromInquiry(inquiry: ConciergeTurnContext['activeInquiry']): number | null {
    const qualification = inquiry?.qualificationJson;
    if (!qualification || typeof qualification !== 'object') {
      return null;
    }
    const tripDays = (qualification as Record<string, unknown>).tripDays;
    return typeof tripDays === 'number' && Number.isFinite(tripDays) && tripDays > 0 ? Math.floor(tripDays) : null;
  }

  private mergeQualificationJson(
    current: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...(current ?? {}),
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    };
  }

  private async withCatalogOptionsForFollowUp(params: {
    replyText: string;
    nextField:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail';
    context: ConciergeTurnContext;
  }): Promise<string> {
    if (params.nextField === 'country') {
      const options = await this.buildCountryOptionsList(params.context);
      if (!options) return params.replyText;
      const cleaned = this.stripCatalogOptionsBlocks(params.replyText, ['Opciones disponibles:']);
      return `${cleaned}\n${options}`;
    }

    if (params.nextField === 'accommodation') {
      const options = await this.buildAccommodationOptionsList(params.context);
      if (!options) return params.replyText;
      const cleaned = this.stripCatalogOptionsBlocks(params.replyText, [
        'Opciones de alojamiento disponibles:',
        'Opciones disponibles:',
      ]);
      return `${cleaned}\n${options}`;
    }

    if (params.nextField === 'weeks') {
      const options = await this.buildWeeksOptionsList(params.context);
      if (!options) return params.replyText;
      const cleaned = this.stripCatalogOptionsBlocks(params.replyText, [
        'Duración disponible:',
        'Opciones de duración disponibles:',
        'Opciones disponibles:',
      ]);
      return `${options}\n${cleaned}`;
    }

    return params.replyText;
  }

  private async buildPromptDrivenFollowUp(params: {
    nextField:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
      | 'tripDays'
      | 'family'
      | 'program'
      | 'accommodation'
      | 'preferredStartMonth'
      | 'preferredStartYear'
      | 'weeks'
      | 'contactName'
      | 'contactEmail';
    context: ConciergeTurnContext;
    fallbackReplyText: string;
  }): Promise<string> {
    const optionsText =
      params.nextField === 'country'
        ? await this.buildCountryOptionsList(params.context)
        : params.nextField === 'accommodation'
          ? await this.buildAccommodationOptionsList(params.context)
          : params.nextField === 'weeks'
            ? await this.buildWeeksOptionsList(params.context)
          : params.nextField === 'family' || params.nextField === 'program'
            ? await this.buildProgramFamilyOptionsList(params.context)
            : null;

    try {
      const instructions = [
        'Eres un concierge comercial para TKTours.',
        'Escribe una sola pregunta en español, cálida, amable y natural (1-2 frases).',
        'Puedes usar como máximo 1 emoji natural si ayuda a que suene más cercano.',
        'Debes pedir exactamente el campo expectedField y no mezclar otros campos.',
        'Si el usuario dio un dato útil pero aún falta expectedField, reconócelo brevemente antes de preguntar el dato faltante.',
        'Si requestMode es CIRCUITS y expectedField es country, pide el destino o región de viaje, no lo formules como país académico o país de estudio.',
        'Si expectedField es residenceCountry y cityOfResidence ya existe, reconoce la ciudad y pide el país de residencia.',
        'Nunca pidas cityOfResidence, año de inicio ni alojamiento; si existen, solo úsalos como contexto.',
        'No hagas listas ni bullets en la pregunta.',
        'Evita sonar seca, tajante, robótica o demasiado directa.',
        'Si optionsText existe, NO lo repitas ni lo reformules; se agregará fuera de tu texto.',
        'Responde solo texto plano.',
        'Ejemplos de estilo (no copiar literal):',
        '- country: "Con gusto 😊, para orientarte mejor, ¿qué país tienes en mente?"',
        '- country con requestMode=CIRCUITS: "Con gusto ✨, para orientarte mejor, ¿qué tipo de destino te interesa?"',
        '- studentAge: "Perfecto 😊, para ubicar mejor la opción, ¿qué edad tiene la persona que viajaría?"',
        '- residenceCountry: "Si te parece, ¿me confirmas en qué país vive actualmente el estudiante?"',
        '- residenceCountry con ciudad conocida: "Gracias 😊, ya tengo Monterrey como referencia. ¿Me confirmas en qué país vive actualmente?"',
        '- tripDays: "Perfecto ✨, para buscar una opción que se ajuste mejor, ¿cuántos días deseas tu viaje?"',
        '- family/program: "Con gusto, ¿qué tipo de programa te interesa?"',
        '- preferredStartMonth: "Para orientarte mejor, ¿en qué mes les gustaría iniciar?"',
        '- weeks: "Para buscar una opción adecuada, ¿cuántas semanas te interesaría que dure el programa? 😊"',
        '- contactName: "Con eso ya puedo dejarlo encaminado ✨. ¿Me compartes tu nombre completo, por favor?"',
        '- contactEmail: "Gracias 😊. ¿Cuál es tu correo electrónico para que un asesor de TKTours pueda dar seguimiento?"',
      ].join('\n');

      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          expectedField: params.nextField,
          conversationStage: params.context.conversation?.currentStage ?? null,
          activeNeed: params.context.activeInquiry?.family?.key ?? null,
          countryName: params.context.activeInquiry?.country?.name ?? null,
          studentAge: params.context.activeInquiry?.studentAge ?? null,
          residenceCountry: this.getResidenceCountryFromInquiry(params.context.activeInquiry),
          cityOfResidence: params.context.activeInquiry?.cityOfResidence ?? null,
          tripDays: this.getTripDaysFromInquiry(params.context.activeInquiry),
          requestMode: this.isCircuitsInquiry(params.context.activeInquiry) ? 'CIRCUITS' : null,
          latestUserMessage: params.context.latestMessage?.text ?? null,
        }),
      });

      const candidate = this.stripCatalogOptionsBlocks((response.outputText ?? '').trim(), [
        'Opciones disponibles:',
        'Opciones de alojamiento disponibles:',
      ]).trim();

      if (!candidate) {
        return this.withCatalogOptionsForFollowUp({
          replyText: params.fallbackReplyText,
          nextField: params.nextField,
          context: params.context,
        });
      }

      if (params.nextField === 'weeks' && optionsText) {
        return `${optionsText}\n${candidate}`.trim();
      }

      return `${candidate}${optionsText ? `\n${optionsText}` : ''}`.trim();
    } catch {
      return this.withCatalogOptionsForFollowUp({
        replyText: params.fallbackReplyText,
        nextField: params.nextField,
        context: params.context,
      });
    }
  }

  private async buildPromptDrivenHandoffConfirmation(params: {
    context: ConciergeTurnContext;
    fallbackReplyText: string;
  }): Promise<string> {
    try {
      const contact = params.context.activeInquiry?.contact ?? params.context.conversation?.contact ?? null;
      const instructions = [
        'Eres un concierge comercial para TKTours.',
        'Escribe un cierre breve, cálido, amable y natural en español.',
        'El cliente ya tiene datos de contacto guardados; NO pidas nombre ni correo.',
        'Confirma que la información quedó lista y que un asesor dará seguimiento más adelante.',
        'No prometas precios, disponibilidad ni tiempos exactos.',
        'No menciones bases de datos, herramientas ni sistemas.',
        'Responde solo texto plano.',
      ].join('\n');

      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          firstName: contact?.firstName ?? null,
          lastName: contact?.lastName ?? null,
          email: contact?.email ?? null,
          familyKey: params.context.activeInquiry?.family?.key ?? null,
          countryName: params.context.activeInquiry?.country?.name ?? null,
          studentAge: params.context.activeInquiry?.studentAge ?? null,
          cityOfResidence: params.context.activeInquiry?.cityOfResidence ?? null,
        }),
      });

      const candidate = (response.outputText ?? '').trim();
      return candidate || params.fallbackReplyText;
    } catch {
      return params.fallbackReplyText;
    }
  }

  private async buildProgramFamilyOptionsList(context: ConciergeTurnContext): Promise<string | null> {
    const offerings = await this.loadAvailableCourseTypes(context.activeInquiry?.country?.code);
    return offerings.length ? `Opciones disponibles:\n${courseMenuText(offerings)}` : null;
  }

  private async loadAvailableCourseTypes(countryCode?: string): Promise<CourseOffering[]> {
    const result = await this.toolExecutor.execute('list_available_course_types', { countryCode });
    if (!result || typeof result !== 'object' || !Array.isArray((result as { courseTypes?: unknown }).courseTypes)) return [];
    return (result as { courseTypes: CourseOffering[] }).courseTypes.filter((offering) =>
      conciergeFamilies.some((family) => family.key === offering.familyKey)
      && (offering.programCount > 0 || offering.brochureCount > 0));
  }

  private courseFamilyFromIntent(intent: string): CourseOffering['familyKey'] | null {
    if (intent === 'MENU_OPTION_1' || intent === 'ASK_LANGUAGE_COURSES') return 'LANGUAGE_COURSE';
    if (intent === 'MENU_OPTION_2' || intent === 'ASK_CAMPS') return 'CAMP';
    if (intent === 'MENU_OPTION_3' || intent === 'ASK_CIRCUITS') return 'SCHOOL_PROGRAM';
    return null;
  }

  private async buildCountryOptionsList(context?: ConciergeTurnContext): Promise<string | null> {
    if (this.isCircuitsInquiry(context?.activeInquiry ?? null)) {
      const circuitOptions = ['México', 'Europa', 'Sudamérica', 'Países Asiáticos', 'Otros destinos'];
      return `Opciones disponibles:\n${circuitOptions.map((item, index) => `${index + 1}) ${item}`).join('\n')}`;
    }

    const familyKey = context?.activeInquiry?.family?.key;
    const countriesResult = familyKey
      ? await this.toolExecutor.execute('list_destination_overview', { familyKey })
      : await this.toolExecutor.execute('list_available_countries', { activeOnly: true });

    const available = countriesResult && typeof countriesResult === 'object'
      ? countriesResult as { countries?: Array<{ name?: unknown }>; destinations?: Array<{ countryName?: unknown }> }
      : null;
    const countries = (familyKey
      ? available?.destinations?.map((country) => country.countryName)
      : available?.countries?.map((country) => country.name))
      ?.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => name.trim()) ?? [];

    if (!countries.length) {
      return null;
    }

    const filteredCountries = countries.filter((country) =>
      !['Europa', 'Sudamérica', 'Países Asiáticos', 'Otros destinos'].includes(country),
    );
    const options = filteredCountries.map((country, index) => `${index + 1}) ${country}`).join('\n');
    return `Opciones disponibles:\n${options}`;
  }

  private get unconfirmedAccommodationReply(): string {
    return 'Con gusto 😊. Necesito confirmar qué opciones de alojamiento aplican a la edad y las fechas que me compartiste. Un asesor de TKTours puede ayudarte a revisarlas.';
  }

  private async buildAccommodationOptionsList(context: ConciergeTurnContext): Promise<string | null> {
    const accommodationResult = await this.toolExecutor.execute('list_available_accommodations', {
      activeOnly: true,
      countryCode: context.activeInquiry?.country?.code ?? undefined,
      familyKey: context.activeInquiry?.family?.key ?? undefined,
      studentAge: context.activeInquiry?.studentAge ?? undefined,
    });

    const accommodations =
      accommodationResult &&
      typeof accommodationResult === 'object' &&
      Array.isArray((accommodationResult as { accommodations?: unknown }).accommodations)
        ? (
            accommodationResult as {
              accommodations: Array<{ key?: unknown; name?: unknown }>;
            }
          ).accommodations
            .map((item) => ({
              key: typeof item?.key === 'string' ? item.key : null,
              name: typeof item?.name === 'string' ? item.name : null,
            }))
            .filter((item): item is { key: string; name: string | null } => Boolean(item.key))
        : [];

    if (!accommodations.length) {
      return null;
    }

    const options = accommodations
      .map((accommodation, index) => `${index + 1}) ${this.toAccommodationLabel(accommodation.key, accommodation.name)}`)
      .join('\n');

    return `Opciones de alojamiento disponibles:\n${options}`;
  }

  private async buildWeeksOptionsList(context: ConciergeTurnContext): Promise<string | null> {
    const weeksResult = await this.toolExecutor.execute('list_weeks_options', {
      countryCode: context.activeInquiry?.country?.code ?? undefined,
      familyKey: context.activeInquiry?.family?.key ?? undefined,
      programSlug: context.activeInquiry?.program?.slug ?? undefined,
      locationSlug: context.activeInquiry?.location?.slug ?? undefined,
      studentAge: context.activeInquiry?.studentAge ?? undefined,
      targetMonth: context.activeInquiry?.preferredStartMonth ?? undefined,
      targetYear: context.activeInquiry?.preferredStartYear ?? undefined,
    });

    if (!weeksResult || typeof weeksResult !== 'object') {
      return null;
    }

    const rows = (weeksResult as { basedOnResources?: Array<{ title: string; minWeeks: number | null; maxWeeks: number | null }> }).basedOnResources;
    if (rows?.length) return rows.map((row) => {
      const duration = row.minWeeks != null && row.maxWeeks != null
        ? row.minWeeks === row.maxWeeks ? `${row.minWeeks} semanas` : `${row.minWeeks} a ${row.maxWeeks} semanas`
        : 'duración por confirmar';
      return `${row.title}: ${duration}.`;
    }).join('\n');
    const { minWeeks, maxWeeks } = weeksResult as { minWeeks?: unknown; maxWeeks?: unknown };
    const minimum = typeof minWeeks === 'number' && Number.isFinite(minWeeks) && minWeeks > 0 ? minWeeks : null;
    const maximum = typeof maxWeeks === 'number' && Number.isFinite(maxWeeks) && maxWeeks > 0 ? maxWeeks : null;

    if (minimum == null && maximum == null) return null;

    if (minimum != null && maximum != null && minimum === maximum) {
      return `Duración disponible: ${minimum} ${minimum === 1 ? 'semana' : 'semanas'}.`;
    }

    if (minimum != null && maximum != null) {
      return `Tenemos opciones de ${minimum} a ${maximum} semanas.`;
    }

    return minimum != null
      ? `Tenemos programas desde ${minimum} ${minimum === 1 ? 'semana' : 'semanas'}.`
      : `Tenemos programas de hasta ${maximum} semanas.`;
  }

  private toAccommodationLabel(key: string, fallbackName: string | null): string {
    switch (key) {
      case 'HOST_FAMILY':
        return 'Familia anfitriona';
      case 'UNIVERSITY_RESIDENCE':
        return 'Residencia universitaria';
      case 'SHARED_APARTMENT':
        return 'Apartamento compartido';
      default:
        return fallbackName?.trim() || key;
    }
  }

  private stripCatalogOptionsBlocks(replyText: string, markers: string[]): string {
    let cutIndex: number | null = null;
    const normalized = replyText.toLowerCase();

    for (const marker of markers) {
      const index = normalized.indexOf(marker.toLowerCase());
      if (index >= 0 && (cutIndex == null || index < cutIndex)) {
        cutIndex = index;
      }
    }

    if (cutIndex == null) {
      return replyText.trim();
    }

    return replyText.slice(0, cutIndex).trim();
  }

  private getResidenceCountryFromInquiry(inquiry: ConciergeTurnContext['activeInquiry']): string | null {
    if (!inquiry?.qualificationJson || typeof inquiry.qualificationJson !== 'object') {
      return null;
    }
    const value = (inquiry.qualificationJson as Record<string, unknown>).residenceCountry;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private getPreferredStartStatusFromInquiry(
    inquiry: ConciergeTurnContext['activeInquiry'],
  ): 'DEFINED' | 'UNDECIDED' | null {
    if (!inquiry) return null;
    if (inquiry.preferredStartMonth != null || inquiry.preferredStartYear != null) {
      return 'DEFINED';
    }
    if (!inquiry.qualificationJson || typeof inquiry.qualificationJson !== 'object') {
      return null;
    }
    const value = (inquiry.qualificationJson as Record<string, unknown>).preferredStartStatus;
    return value === 'DEFINED' || value === 'UNDECIDED' ? value : null;
  }

  private getWeeksStatusFromInquiry(
    inquiry: ConciergeTurnContext['activeInquiry'],
  ): 'DEFINED' | 'UNDECIDED' | null {
    if (!inquiry) return null;
    if (inquiry.weeks != null) {
      return 'DEFINED';
    }
    if (!inquiry.qualificationJson || typeof inquiry.qualificationJson !== 'object') {
      return null;
    }
    const value = (inquiry.qualificationJson as Record<string, unknown>).weeksStatus;
    return value === 'DEFINED' || value === 'UNDECIDED' ? value : null;
  }


  private safeParseArguments(argumentsText: string | null | undefined): unknown {
    if (!argumentsText) {
      return {};
    }

    try {
      return JSON.parse(argumentsText);
    } catch {
      throw new ValidationAppError('Tool call arguments are not valid JSON', {
        rawArguments: argumentsText,
      });
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async persistAssistantTurn(params: {
    conversationId: string;
    activeInquiryId: string | null;
    replyText: string;
    mediaUrl: string | null;
    mediaUrls: string[] | null;
    resourceDeliveries: Array<{ sendId: string; versionId: string; url: string }>;
    nextStage: string | null;
    shouldRefreshRecommendations: boolean;
    responseId: string;
    existingContextJson: Record<string, unknown> | null;
    contextPatch: Record<string, unknown> | null;
  }) {
    let conversation = await this.conversationRepository.createMessage({
      conversationId: params.conversationId,
      direction: 'OUTBOUND',
      text: params.replyText,
      mediaUrl: params.mediaUrl,
      metadata: {
        source: 'concierge-orchestrator',
        mediaUrls: params.mediaUrls ?? [],
        resourceDeliveries: params.resourceDeliveries,
      },
    });

    const nextContextJson = {
      ...(params.existingContextJson ?? {}),
      ...(params.contextPatch ?? {}),
      [this.conversationContextResponseKey]: {
        lastResponseId: params.responseId,
        model: this.responsesClient.getModel(),
        updatedAt: new Date().toISOString(),
      },
    };

    conversation = await this.conversationRepository.update({
      conversationId: params.conversationId,
      ...(params.nextStage
        ? {
            ...(params.nextStage === 'CLOSED' ? { status: 'CLOSED' as const } : {}),
            currentStage: params.nextStage as
              | 'START'
              | 'QUALIFY_AGE'
              | 'QUALIFY_COUNTRY'
              | 'QUALIFY_PROGRAM'
              | 'QUALIFY_ACCOMMODATION'
              | 'QUALIFY_DATES'
              | 'RECOMMEND'
              | 'SEND_RESOURCE'
              | 'ESCALATED'
              | 'CLOSED',
          }
        : {}),
      contextJson: nextContextJson,
    });

    if (params.activeInquiryId && params.nextStage === 'CLOSED') {
      await this.inquiryRepository.updateStatus({
        inquiryId: params.activeInquiryId,
        status: 'CLOSED',
      });
    }

    if (params.activeInquiryId && params.shouldRefreshRecommendations) {
      await this.refreshInquiryRecommendationsUseCase.execute(params.activeInquiryId);
    }

    return conversation;
  }

  private getPreviousResponseId(contextJson: Record<string, unknown> | null): string | undefined {
    if (!contextJson) {
      return undefined;
    }

    const responseState = contextJson[this.conversationContextResponseKey];
    if (!responseState || typeof responseState !== 'object') {
      return undefined;
    }

    const lastResponseId = (responseState as Record<string, unknown>).lastResponseId;
    return typeof lastResponseId === 'string' && lastResponseId.length > 0 ? lastResponseId : undefined;
  }
}
