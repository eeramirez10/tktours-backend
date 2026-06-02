import { NotFoundAppError, ValidationAppError } from '../../../../shared/domain/errors/app-error.js';
import { env } from '../../../../shared/config/env.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { PrismaConversationRepository } from '../../../conversations/infrastructure/repositories/prisma-conversation.repository.js';
import { RefreshInquiryRecommendationsUseCase } from '../../../inquiries/application/use-cases/refresh-inquiry-recommendations.use-case.js';
import { PrismaInquiryRepository } from '../../../inquiries/infrastructure/repositories/prisma-inquiry.repository.js';
import { OpenAiResponsesClient } from '../../infrastructure/clients/openai-response.js';
import { PrismaConciergeTurnTraceRepository } from '../../infrastructure/repositories/prisma-concierge-turn-trace.repository.js';
import { conciergePromptVersion, conciergeSystemPrompt } from '../prompts/concierge-system.prompt.js';
import { conciergeStructuredResponseSchema } from '../schemas/concierge-structured-response.schema.js';
import { conciergeTools } from '../tools/concierge-tools.registry.js';
import { ConciergeToolExecutorService } from './concierge-tool-executor.service.js';

export type ConciergeTurnContext = {
  conversation: Awaited<ReturnType<PrismaConversationRepository['findById']>>;
  activeInquiry: Awaited<ReturnType<PrismaInquiryRepository['findById']>> | null;
  latestMessage: {
    id: string;
    direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
    text: string;
    createdAt: Date;
  } | null;
};

type CampBrochureCandidate = {
  resourceId: string;
  resourceTitle: string;
  countryCode: string;
  countryName: string | null;
  locationSlug: string | null;
  locationName: string | null;
  versionId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
};

type CampBrochureStateStatus = 'READY' | 'OFFERED' | 'SENT' | 'DECLINED' | 'UNAVAILABLE';

type CampBrochureState = {
  status: CampBrochureStateStatus;
  candidate: CampBrochureCandidate | null;
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

    if (context.latestMessage.id !== params.incomingMessageId) {
      throw new NotFoundAppError('Incoming message does not belong to the conversation');
    }

    context = await this.hydrateInquiryFromLatestMessage(context);

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

      rawResponseText = firstResponse.outputText;
      const functionCalls = firstResponse.raw.output.filter((item) => item.type === 'function_call');

      let finalText = firstResponse.outputText;
      let finalResponseId = firstResponse.id;

      if (functionCalls.length > 0) {
        const toolOutputs: Array<Record<string, unknown>> = [];

        for (const call of functionCalls) {
          if (call.type !== 'function_call') continue;

          const args = this.safeParseArguments(call.arguments);

          await this.turnTraceRepository.createToolCall({
            turnId: turn.id,
            callId: call.call_id,
            toolName: call.name,
            argumentsJson: args,
          });

          try {
            const result = await this.toolExecutor.execute(call.name, args);

            await this.turnTraceRepository.completeToolCall({
              turnId: turn.id,
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
              turnId: turn.id,
              callId: call.call_id,
              errorMessage: this.getErrorMessage(error),
            });
            throw error;
          }
        }

        const secondResponse = await this.responsesClient.createTextResponse({
          instructions: conciergeSystemPrompt,
          input: toolOutputs,
          previousResponseId: firstResponse.id,
        });

        finalText = secondResponse.outputText;
        finalResponseId = secondResponse.id;
        rawResponseText = secondResponse.outputText;
      }

      const parsed = this.parseStructuredResponse(finalText);
      const policyResult = await this.applyReplyPolicy(parsed, context);
      const normalized = policyResult.structured;

      const persistedConversation = await this.persistAssistantTurn({
        conversationId: params.conversationId,
        activeInquiryId: context.activeInquiry?.id ?? null,
        replyText: normalized.replyText,
        mediaUrl: policyResult.outboundMediaUrl ?? null,
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
      await this.turnTraceRepository.failTurn({
        turnId: turn.id,
        errorMessage: this.getErrorMessage(error),
        rawResponseText,
      });
      throw error;
    }
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
    if (!context.activeInquiry || !context.latestMessage || context.latestMessage.direction !== 'INBOUND') {
      return context;
    }

    const expectedField = this.getEnforcedNextField(context.activeInquiry);
    const previousOutbound = this.findPreviousOutboundMessage(context);
    const extracted = await this.toolExecutor.execute('extract_inquiry_fields', {
      latestMessage: context.latestMessage.text,
      previousAssistantMessage: previousOutbound?.text ?? null,
      expectedField,
      recentMessages: (context.conversation?.messages ?? []).slice(-10).map((message) => ({
        direction: message.direction,
        text: message.text,
      })),
      inquirySnapshot: {
        countryCode: context.activeInquiry.country?.code ?? null,
        studentAge: context.activeInquiry.studentAge,
        residenceCountry: this.getResidenceCountryFromInquiry(context.activeInquiry),
        cityOfResidence: context.activeInquiry.cityOfResidence,
        familyKey: context.activeInquiry.family?.key ?? null,
        accommodationKey: context.activeInquiry.accommodationType?.key ?? null,
        preferredStartMonth: context.activeInquiry.preferredStartMonth,
        preferredStartYear: context.activeInquiry.preferredStartYear,
        preferredStartStatus: this.getPreferredStartStatusFromInquiry(context.activeInquiry),
        weeks: context.activeInquiry.weeks,
        weeksStatus: this.getWeeksStatusFromInquiry(context.activeInquiry),
      },
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

    maybeSet('countryCode', (extracted as { countryCode?: unknown }).countryCode);
    maybeSet('studentAge', (extracted as { studentAge?: unknown }).studentAge);
    maybeSet('cityOfResidence', (extracted as { cityOfResidence?: unknown }).cityOfResidence);
    maybeSet('familyKey', (extracted as { familyKey?: unknown }).familyKey);
    maybeSet('accommodationKey', (extracted as { accommodationKey?: unknown }).accommodationKey);
    maybeSet('preferredStartMonth', (extracted as { preferredStartMonth?: unknown }).preferredStartMonth);
    maybeSet('preferredStartYear', (extracted as { preferredStartYear?: unknown }).preferredStartYear);
    maybeSet('weeks', (extracted as { weeks?: unknown }).weeks);

    const qualificationJson =
      context.activeInquiry.qualificationJson && typeof context.activeInquiry.qualificationJson === 'object'
        ? { ...context.activeInquiry.qualificationJson }
        : {};
    let qualificationJsonChanged = false;

    const residenceCountry = (extracted as { residenceCountry?: unknown }).residenceCountry;
    if (typeof residenceCountry === 'string' && residenceCountry.trim().length > 0) {
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

    if (Object.keys(inquiryUpdate).length > 0) {
      await this.inquiryRepository.update({
        inquiryId: context.activeInquiry.id,
        ...inquiryUpdate,
      });
    }

    const contactUpdate: Record<string, unknown> = {};
    maybeSetContact(contactUpdate, 'firstName', (extracted as { firstName?: unknown }).firstName);
    maybeSetContact(contactUpdate, 'lastName', (extracted as { lastName?: unknown }).lastName);
    maybeSetContact(contactUpdate, 'email', (extracted as { email?: unknown }).email);

    if (Object.keys(contactUpdate).length > 0) {
      await this.upsertInquiryContact({
        inquiryId: context.activeInquiry.id,
        conversationId: context.conversation?.id ?? context.activeInquiry.conversation.id,
        contactId: context.activeInquiry.contact?.id ?? context.conversation?.contact?.id ?? null,
        contactUpdate,
      });
    }

    const updatedInquiry = await this.inquiryRepository.findById(context.activeInquiry.id);

    return {
      ...context,
      activeInquiry: updatedInquiry ?? context.activeInquiry,
    };

    function maybeSetContact(target: Record<string, unknown>, key: string, value: unknown) {
      if (typeof value === 'string' && value.trim().length > 0) {
        target[key] = value.trim();
      }
    }
  }

  private async upsertInquiryContact(input: {
    inquiryId: string;
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

      await tx.inquiry.update({
        where: { id: input.inquiryId },
        data: { contactId },
      });

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
  }> {
    const detectedIntent = await this.detectIntentWithTool(context);
    const policySignals = await this.evaluatePolicySignalsWithTool(context);
    context = await this.hydrateInquiryFamilyFromIntent(context, detectedIntent);
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
      };
    }

    if (detectedIntent === 'GREETING') {
      const replyText = this.stripCatalogOptionsBlocks(parsed.replyText, [
        'Opciones disponibles:',
        'Opciones de alojamiento disponibles:',
      ]);
      return {
        structured: {
          ...parsed,
          replyText,
          shouldAskFollowUp: false,
          missingFields: [],
          nextStage: 'START',
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'none',
          details: {
            reason: 'greeting_menu',
          },
        },
        contextPatch,
        outboundMediaUrl: null,
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

    if (!context.activeInquiry?.family?.key && detectedIntent === 'UNKNOWN' && !policySignals.menuWasShown) {
      return {
        structured: {
          ...parsed,
          shouldAskFollowUp: false,
          missingFields: [],
          nextStage: 'START',
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: 'none',
          details: {
            reason: 'initial_unknown_keep_menu',
            intent: detectedIntent,
            confidence: policySignals.confidence,
          },
        },
        contextPatch,
      };
    }

    const nextField = enforcedField ?? this.getFirstStillMissingField(parsed.missingFields, context.activeInquiry);
    const brochureReplyAction = await this.resolveCampBrochureReplyAction(context, campBrochureState);

    if (brochureReplyAction === 'SEND' && campBrochureState?.candidate) {
      if (context.activeInquiry?.id) {
        await this.recordCampBrochureSend(context.activeInquiry.id, campBrochureState.candidate);
      }
      const sendReply = await this.buildPromptDrivenCampBrochureSend({
        context,
        candidate: campBrochureState.candidate,
      });
      const followUp = nextField
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
          shouldAskFollowUp: Boolean(followUp),
          nextStage: followUp ? this.mapNextStageFromField(nextField!) : 'SEND_RESOURCE',
          missingFields: followUp ? [nextField!] : [],
          shouldRefreshRecommendations: false,
        },
        trace: {
          strategy: followUp ? 'single_follow_up' : 'none',
          details: {
            reason: 'camp_brochure_sent',
            resourceId: campBrochureState.candidate.resourceId,
            nextField: nextField ?? null,
          },
        },
        contextPatch,
        outboundMediaUrl: this.toAbsoluteMediaUrl(campBrochureState.candidate.fileUrl),
      };
    }

    if (brochureReplyAction === 'DECLINE' && campBrochureState) {
      const nowIso = new Date().toISOString();
      contextPatch = this.mergeContextPatch(contextPatch, {
        [this.campBrochureContextKey]: {
          ...campBrochureState,
          status: 'DECLINED',
          checkedAt: nowIso,
        },
      });
    }

    if (this.shouldOfferCampBrochure(context, nextField, campBrochureState)) {
      const offerReply = await this.buildPromptDrivenCampBrochureOffer({
        context,
        candidate: campBrochureState!.candidate!,
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
            resourceId: campBrochureState?.candidate?.resourceId ?? null,
            nextField: nextField ?? null,
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

  private async resolveCampBrochureState(
    context: ConciergeTurnContext,
  ): Promise<{ state: CampBrochureState | null; contextPatch: Record<string, unknown> | null }> {
    const inquiry = context.activeInquiry;
    if (!inquiry || inquiry.family?.key !== 'CAMP' || !inquiry.country?.code) {
      return { state: null, contextPatch: null };
    }

    const existing = this.getCampBrochureStateFromContext(context);
    const resolved = await this.findCampBrochureCandidate(context);
    const nowIso = new Date().toISOString();

    if (!resolved) {
      const unavailable: CampBrochureState = {
        status: 'UNAVAILABLE',
        candidate: null,
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

    const keepOffered = existing?.status === 'OFFERED' && existing.candidate?.versionId === resolved.versionId;
    const keepSent = existing?.status === 'SENT' && existing.candidate?.versionId === resolved.versionId;
    const keepDeclined = existing?.status === 'DECLINED' && existing.candidate?.versionId === resolved.versionId;

    const state: CampBrochureState = {
      status: keepSent ? 'SENT' : keepOffered ? 'OFFERED' : keepDeclined ? 'DECLINED' : 'READY',
      candidate: resolved,
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

    const candidateRaw = (raw as Record<string, unknown>).candidate;
    const candidate = this.normalizeCampBrochureCandidate(candidateRaw);

    return {
      status: status as CampBrochureStateStatus,
      candidate,
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
      locationSlug: this.asNonEmptyStringValue(payload.locationSlug),
      locationName: this.asNonEmptyStringValue(payload.locationName),
      versionId,
      fileName,
      fileUrl: this.toPublicUrl(fileUrl),
      mimeType: this.asNonEmptyStringValue(payload.mimeType),
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

  private async findCampBrochureCandidate(context: ConciergeTurnContext): Promise<CampBrochureCandidate | null> {
    const inquiry = context.activeInquiry;
    const countryCode = inquiry?.country?.code ?? null;
    if (!inquiry || inquiry.family?.key !== 'CAMP' || !countryCode) {
      return null;
    }

    const locationSlug = inquiry.location?.slug ?? undefined;
    const byLocation = locationSlug
      ? await this.queryCampBrochureResources({
          countryCode,
          locationSlug,
        })
      : [];

    if (byLocation.length > 0) {
      const candidate = this.toCampBrochureCandidate(byLocation[0]);
      if (candidate) return candidate;
    }

    const byCountry = await this.queryCampBrochureResources({
      countryCode,
    });

    return byCountry.length > 0 ? this.toCampBrochureCandidate(byCountry[0]) : null;
  }

  private async queryCampBrochureResources(input: {
    countryCode: string;
    locationSlug?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const result = await this.toolExecutor.execute('list_available_resources', {
      activeOnly: true,
      familyKey: 'CAMP',
      type: 'BROCHURE',
      countryCode: input.countryCode,
      ...(input.locationSlug ? { locationSlug: input.locationSlug } : {}),
    });

    if (!result || typeof result !== 'object') {
      return [];
    }

    const resources = (result as Record<string, unknown>).resources;
    return Array.isArray(resources) ? (resources.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>) : [];
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
      locationSlug: this.asNonEmptyStringValue(resource.locationSlug),
      locationName: this.asNonEmptyStringValue(resource.locationName),
      versionId,
      fileName,
      fileUrl: this.toPublicUrl(fileUrl),
      mimeType: this.asNonEmptyStringValue((version as Record<string, unknown>).mimeType),
    };
  }

  private asNonEmptyStringValue(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
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

  private async resolveCampBrochureReplyAction(
    context: ConciergeTurnContext,
    state: CampBrochureState | null,
  ): Promise<'SEND' | 'DECLINE' | 'UNKNOWN'> {
    if (!state || (state.status !== 'OFFERED' && state.status !== 'SENT')) {
      return 'UNKNOWN';
    }

    const latestMessage = context.latestMessage;
    if (!latestMessage || latestMessage.direction !== 'INBOUND') {
      return 'UNKNOWN';
    }

    const previousOutbound = this.findPreviousOutboundMessage(context);
    const instructions = [
      'Clasifica la respuesta del usuario sobre un ofrecimiento de folleto PDF.',
      'Devuelve JSON estricto con la forma {"action":"SEND|DECLINE|UNKNOWN","confidence":number}.',
      'Estado OFFERED: SEND si el usuario confirma que sí quiere que le envíen el folleto.',
      'Estado SENT: SEND si el usuario pide que lo reenvíen, dice que no le llegó, que no ve el archivo, que lo comparta otra vez o insiste en recibir el PDF.',
      'DECLINE: el usuario rechaza, pospone o dice que no quiere folleto.',
      'UNKNOWN: no está claro, responde una pregunta diferente o continúa dando datos del flujo.',
      'No inventes; usa contexto de latestMessage y previousAssistantMessage.',
    ].join('\n');

    try {
      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          brochureState: state.status,
          brochureTitle: state.candidate?.resourceTitle ?? null,
          latestMessage: latestMessage.text,
          previousAssistantMessage: previousOutbound?.text ?? null,
          recentMessages: (context.conversation?.messages ?? []).slice(-10).map((message) => ({
            direction: message.direction,
            text: message.text,
          })),
        }),
      });

      const parsed = JSON.parse(response.outputText) as { action?: unknown; confidence?: unknown };
      const action = parsed?.action;
      if (action === 'SEND' || action === 'DECLINE' || action === 'UNKNOWN') {
        return action;
      }
      return 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  private shouldOfferCampBrochure(
    context: ConciergeTurnContext,
    nextField:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
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
    if (!state || !state.candidate) return false;
    if (state.status === 'OFFERED' || state.status === 'SENT' || state.status === 'DECLINED') return false;
    if (nextField === 'country' || nextField === 'studentAge' || nextField === 'family') return false;
    return true;
  }

  private async buildPromptDrivenCampBrochureOffer(params: {
    context: ConciergeTurnContext;
    candidate: CampBrochureCandidate;
  }): Promise<string> {
    const fallback = `Tengo un folleto disponible para ${params.candidate.countryName ?? 'este país'}. ¿Quieres que te lo comparta ahora?`;
    try {
      const instructions = [
        'Eres un concierge comercial de TKTours.',
        'Redacta un mensaje breve, cálido y natural en español para ofrecer un folleto PDF.',
        'Debe terminar con una pregunta de confirmación para enviarlo.',
        'No menciones procesos internos ni herramientas.',
        'No uses formato JSON.',
      ].join('\n');

      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          familyKey: params.context.activeInquiry?.family?.key ?? null,
          countryName: params.candidate.countryName,
          locationName: params.candidate.locationName,
          brochureTitle: params.candidate.resourceTitle,
          latestUserMessage: params.context.latestMessage?.text ?? null,
        }),
      });

      return (response.outputText ?? '').trim() || fallback;
    } catch {
      return fallback;
    }
  }

  private async buildPromptDrivenCampBrochureSend(params: {
    context: ConciergeTurnContext;
    candidate: CampBrochureCandidate;
  }): Promise<string> {
    const fallback = `Claro, te comparto el folleto PDF para que lo revises con calma.`;
    try {
      const instructions = [
        'Eres un concierge comercial de TKTours.',
        'Redacta un mensaje breve y natural para confirmar el envío de un folleto PDF.',
        'No incluyas enlaces, URLs, rutas internas ni nombres técnicos de archivo.',
        'Menciona que el PDF se compartirá como archivo adjunto.',
        'No uses formato JSON.',
      ].join('\n');

      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify({
          fileName: params.candidate.fileName,
          brochureTitle: params.candidate.resourceTitle,
          countryName: params.candidate.countryName,
          locationName: params.candidate.locationName,
        }),
      });

      const candidate = (response.outputText ?? '').trim();
      return candidate || fallback;
    } catch {
      return fallback;
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

  private async recordCampBrochureSend(inquiryId: string, candidate: CampBrochureCandidate): Promise<void> {
    try {
      await prisma.inquiryResourceSend.create({
        data: {
          inquiryId,
          resourceId: candidate.resourceId,
          resourceVersionId: candidate.versionId,
          sentReason: 'camp_brochure_confirmed_by_user',
        },
      });
    } catch {
      // Sending trace should not break concierge flow.
    }
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
      | 'UNKNOWN',
  ): Promise<ConciergeTurnContext> {
    if (!context.activeInquiry || context.activeInquiry.family?.key) {
      return context;
    }

    let familyKey: 'LANGUAGE_COURSE' | 'CAMP' | null = null;
    if (detectedIntent === 'MENU_OPTION_1' || detectedIntent === 'ASK_LANGUAGE_COURSES') {
      familyKey = 'LANGUAGE_COURSE';
    } else if (detectedIntent === 'MENU_OPTION_2' || detectedIntent === 'ASK_CAMPS') {
      familyKey = 'CAMP';
    }

    if (!familyKey) {
      return context;
    }

    await this.inquiryRepository.update({
      inquiryId: context.activeInquiry.id,
      familyKey,
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
    | 'UNKNOWN'
  > {
    const latestMessage = context.latestMessage?.text ?? '';
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
    resolvedCountryCode: 'CA' | 'US' | 'GB' | 'IT' | 'FR' | 'IE' | null;
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
        payload.resolvedCountryCode === 'IE'
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

    if (inquiry.family.key === 'CAMP') {
      if (inquiry.studentAge == null) return 'studentAge';
      if (!inquiry.country?.code) return 'country';
      if (!this.getResidenceCountryFromInquiry(inquiry)) return 'residenceCountry';
      if (!inquiry.cityOfResidence) return 'cityOfResidence';
      if (preferredStartStatus !== 'UNDECIDED' && inquiry.preferredStartMonth == null) return 'preferredStartMonth';
      if (preferredStartStatus !== 'UNDECIDED' && inquiry.preferredStartYear == null) return 'preferredStartYear';
      if (!inquiry.accommodationType?.key) return 'accommodation';
      if (weeksStatus !== 'UNDECIDED' && inquiry.weeks == null) return 'weeks';
      if (!this.hasContactNameForInquiry(inquiry)) return 'contactName';
      if (!this.hasContactEmailForInquiry(inquiry)) return 'contactEmail';
      return null;
    }

    if (!inquiry.country?.code) return 'country';
    if (inquiry.studentAge == null) return 'studentAge';
    if (!this.getResidenceCountryFromInquiry(inquiry)) return 'residenceCountry';
    if (!inquiry.cityOfResidence) return 'cityOfResidence';
    if (preferredStartStatus !== 'UNDECIDED' && inquiry.preferredStartMonth == null) return 'preferredStartMonth';
    if (preferredStartStatus !== 'UNDECIDED' && inquiry.preferredStartYear == null) return 'preferredStartYear';
    if (weeksStatus !== 'UNDECIDED' && inquiry.weeks == null) return 'weeks';
    if (!inquiry.accommodationType?.key) return 'accommodation';
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

  private isFieldStillMissing(
    field:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
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
      case 'family':
        return !inquiry.family?.key;
      case 'program':
        return false;
      case 'accommodation':
        return !inquiry.accommodationType?.key;
      case 'preferredStartMonth':
        return this.getPreferredStartStatusFromInquiry(inquiry) !== 'UNDECIDED' && inquiry.preferredStartMonth == null;
      case 'preferredStartYear':
        return this.getPreferredStartStatusFromInquiry(inquiry) !== 'UNDECIDED' && inquiry.preferredStartYear == null;
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
    if (!inquiry.country?.code) return false;
    if (inquiry.studentAge == null) return false;
    if (!this.getResidenceCountryFromInquiry(inquiry)) return false;
    if (!inquiry.cityOfResidence) return false;
    if (!inquiry.accommodationType?.key) return false;
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

  private async withCatalogOptionsForFollowUp(params: {
    replyText: string;
    nextField:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
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
      const options = await this.buildCountryOptionsList();
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

    return params.replyText;
  }

  private async buildPromptDrivenFollowUp(params: {
    nextField:
      | 'country'
      | 'studentAge'
      | 'residenceCountry'
      | 'cityOfResidence'
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
        ? await this.buildCountryOptionsList()
        : params.nextField === 'accommodation'
          ? await this.buildAccommodationOptionsList(params.context)
          : params.nextField === 'family' || params.nextField === 'program'
            ? await this.buildProgramFamilyOptionsList(params.context)
            : null;

    try {
      const instructions = [
        'Eres un concierge comercial para TKTours.',
        'Escribe una sola pregunta en español, cálida y natural (1-2 frases).',
        'Debes pedir exactamente el campo expectedField y no mezclar otros campos.',
        'Si el usuario dio un dato útil pero aún falta expectedField, reconócelo brevemente antes de preguntar el dato faltante.',
        'Si expectedField es residenceCountry y cityOfResidence ya existe, reconoce la ciudad y pide el país de residencia.',
        'Si expectedField es cityOfResidence y residenceCountry ya existe, reconoce el país y pide la ciudad.',
        'No hagas listas ni bullets en la pregunta.',
        'No uses tono robótico.',
        'Si optionsText existe, NO lo repitas ni lo reformules; se agregará fuera de tu texto.',
        'Responde solo texto plano.',
        'Ejemplos de estilo (no copiar literal):',
        '- country: "¡Excelente! Para continuar, ¿qué país tienes en mente?"',
        '- studentAge: "¡Perfecto! ¿Qué edad tiene la persona que viajaría?"',
        '- residenceCountry: "Gracias. ¿En qué país vive actualmente el estudiante?"',
        '- residenceCountry con ciudad conocida: "Gracias, ya tengo Monterrey como ciudad. ¿Me confirmas en qué país vive actualmente?"',
        '- cityOfResidence: "¿Y en qué ciudad reside actualmente?"',
        '- cityOfResidence con país conocido: "Perfecto, ya tengo México como país de residencia. ¿En qué ciudad vive actualmente?"',
        '- family/program: "Buenísimo, ¿qué tipo de programa te interesa?"',
        '- preferredStartMonth: "¿En qué mes les gustaría iniciar?"',
        '- preferredStartYear: "¿En qué año te gustaría comenzar?"',
        '- weeks: "¿Cuántas semanas te gustaría estudiar?"',
        '- accommodation: "Para cerrar esta parte, ¿qué tipo de alojamiento prefieren?"',
        '- contactName: "Con eso ya puedo dejarlo encaminado. ¿Me compartes tu nombre completo?"',
        '- contactEmail: "Gracias. ¿Cuál es tu correo electrónico para que un asesor pueda dar seguimiento?"',
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
        'Escribe un cierre breve, cálido y natural en español.',
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
    const countryCode = context.activeInquiry?.country?.code ?? undefined;
    const programsResult = await this.toolExecutor.execute('list_available_programs', {
      activeOnly: true,
      countryCode,
    });

    const families =
      programsResult &&
      typeof programsResult === 'object' &&
      Array.isArray((programsResult as { programs?: unknown }).programs)
        ? (programsResult as { programs: Array<{ familyKey?: unknown }> }).programs
            .map((program) => (typeof program?.familyKey === 'string' ? program.familyKey : null))
            .filter((key): key is string => Boolean(key))
        : [];

    const unique = [...new Set(families)];
    if (!unique.length) {
      return null;
    }

    const labels: string[] = [];
    for (const key of unique) {
      if (key === 'LANGUAGE_COURSE') labels.push('Cursos de idiomas');
      if (key === 'CAMP') labels.push('Campamentos / viajes');
      if (key === 'SCHOOL_PROGRAM') labels.push('Programas escolares');
    }

    if (!labels.length) {
      return null;
    }

    return `Opciones disponibles:\n${labels.map((label, index) => `${index + 1}) ${label}`).join('\n')}`;
  }

  private async buildCountryOptionsList(): Promise<string | null> {
    const countriesResult = await this.toolExecutor.execute('list_available_countries', {
      activeOnly: true,
    });

    const countries =
      countriesResult &&
      typeof countriesResult === 'object' &&
      Array.isArray((countriesResult as { countries?: unknown }).countries)
        ? (countriesResult as { countries: Array<{ name?: unknown }> }).countries
            .map((country) => (typeof country?.name === 'string' ? country.name.trim() : null))
            .filter((name): name is string => Boolean(name))
        : [];

    if (!countries.length) {
      return null;
    }

    const options = countries.map((country, index) => `${index + 1}) ${country}`).join('\n');
    return `Opciones disponibles:\n${options}`;
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
