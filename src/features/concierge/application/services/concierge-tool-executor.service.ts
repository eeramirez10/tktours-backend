import { CatalogRepository } from '../../../catalog/infrastructure/repositories/catalog.repository.js';
import { PrismaInquiryRepository } from '../../../inquiries/infrastructure/repositories/prisma-inquiry.repository.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { OpenAiResponsesClient } from '../../infrastructure/clients/openai-response.js';
import {
  DetectUserIntentArgs,
  EvaluatePolicySignalsArgs,
  ExtractInquiryFieldsArgs,
  FindMatchingProgramsArgs,
  GetContactInfoArgs,
  GetProgramDetailArgs,
  ListAvailableAccommodationsArgs,
  ListAvailableCountriesArgs,
  ListAvailableProgramsArgs,
  ListWeeksOptionsArgs,
  UpdateInquiryArgs,
} from '../../domain/types/concierge-tool.types.js';

type DetectedIntent =
  | 'GREETING'
  | 'MENU_OPTION_1'
  | 'MENU_OPTION_2'
  | 'MENU_OPTION_3'
  | 'ASK_AVAILABLE_COUNTRIES'
  | 'ASK_AVAILABLE_PROGRAMS'
  | 'REQUEST_QUOTE'
  | 'ASK_LANGUAGE_COURSES'
  | 'ASK_CAMPS'
  | 'UNKNOWN';

type ExtractedInquiryFields = {
  countryCode: 'CA' | 'US' | 'GB' | 'IT' | 'FR' | 'IE' | null;
  studentAge: number | null;
  residenceCountry: string | null;
  cityOfResidence: string | null;
  familyKey: 'CAMP' | 'LANGUAGE_COURSE' | 'SCHOOL_PROGRAM' | null;
  accommodationKey: 'HOST_FAMILY' | 'UNIVERSITY_RESIDENCE' | 'SHARED_APARTMENT' | null;
  preferredStartMonth: number | null;
  preferredStartYear: number | null;
  preferredStartUndecided: boolean;
  weeks: number | null;
  weeksUndecided: boolean;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  confidence: number;
};

type PolicySignals = {
  menuWasShown: boolean;
  asksAccommodationOptions: boolean;
  isNegativeProgramAnswer: boolean;
  handoffStep: 'ask_name' | 'ask_email' | 'confirm_handoff' | 'none';
  resolvedCountryCode: 'CA' | 'US' | 'GB' | 'IT' | 'FR' | 'IE' | null;
  confidence: number;
  needsClarification: boolean;
};

const contactInfoSelect = {
  id: true,
  waId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  city: true,
} as const;

const defaultExtractedFields: ExtractedInquiryFields = {
  countryCode: null,
  studentAge: null,
  residenceCountry: null,
  cityOfResidence: null,
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
  confidence: 0,
};

export class ConciergeToolExecutorService {
  constructor(
    private readonly catalogRepository = new CatalogRepository(),
    private readonly inquiryRepository = new PrismaInquiryRepository(),
    private readonly responsesClient = new OpenAiResponsesClient({}),
  ) {}

  async execute(toolName: string, args: unknown) {
    switch (toolName) {
      case 'get_contact_info':
        return this.getContactInfo(args as GetContactInfoArgs);
      case 'detect_user_intent':
        return this.detectUserIntent(args as DetectUserIntentArgs);
      case 'extract_inquiry_fields':
        return this.extractInquiryFields(args as ExtractInquiryFieldsArgs);
      case 'evaluate_policy_signals':
        return this.evaluatePolicySignals(args as EvaluatePolicySignalsArgs);
      case 'find_matching_programs':
        return this.findMatchingPrograms(args as FindMatchingProgramsArgs);
      case 'get_program_detail':
        return this.getProgramDetail(args as GetProgramDetailArgs);
      case 'list_available_countries':
        return this.listAvailableCountries(args as ListAvailableCountriesArgs);
      case 'list_available_programs':
        return this.listAvailablePrograms(args as ListAvailableProgramsArgs);
      case 'list_available_accommodations':
        return this.listAvailableAccommodations(args as ListAvailableAccommodationsArgs);
      case 'list_weeks_options':
        return this.listWeeksOptions(args as ListWeeksOptionsArgs);
      case 'update_inquiry':
        return this.updateInquiry(args as UpdateInquiryArgs);
      default:
        throw new Error(`Unsupported tool: ${toolName}`);
    }
  }

  private async findMatchingPrograms(args: FindMatchingProgramsArgs) {
    return this.catalogRepository.findRecommendedPrograms(args);
  }

  private async getContactInfo(args: GetContactInfoArgs) {
    const contactId = this.asNonEmptyString(args.contactId);
    const conversationId = this.asNonEmptyString(args.conversationId);
    const waId = this.asNonEmptyString(args.waId);

    const contact = contactId
      ? await prisma.contact.findUnique({ where: { id: contactId }, select: contactInfoSelect })
      : conversationId
        ? (
            await prisma.conversation.findUnique({
              where: { id: conversationId },
              select: { contact: { select: contactInfoSelect } },
            })
          )?.contact ?? null
        : waId
          ? await prisma.contact.findUnique({ where: { waId }, select: contactInfoSelect })
          : null;

    const firstName = this.asNonEmptyString(contact?.firstName);
    const lastName = this.asNonEmptyString(contact?.lastName);
    const email = this.asEmail(contact?.email);
    const hasName = Boolean(lastName || (firstName && firstName.includes(' ')));
    const hasEmail = Boolean(email);

    return {
      exists: Boolean(contact),
      hasName,
      hasEmail,
      isComplete: hasName && hasEmail,
      contact: contact
        ? {
            id: contact.id,
            waId: contact.waId,
            firstName,
            lastName,
            email,
            phone: this.asNonEmptyString(contact.phone),
            city: this.asNonEmptyString(contact.city),
          }
        : null,
    };
  }

  private async detectUserIntent(args: DetectUserIntentArgs) {
    const latestMessage = (args.latestMessage ?? '').trim();
    const recentMessages = Array.isArray(args.recentMessages) ? args.recentMessages : [];

    const prompt = [
      'Classify the user intent for a WhatsApp education concierge.',
      'Return strict JSON with shape {"intent": "...", "confidence": number, "menuWasShown": boolean}.',
      'Allowed intents:',
      '- GREETING',
      '- MENU_OPTION_1',
      '- MENU_OPTION_2',
      '- MENU_OPTION_3',
      '- ASK_AVAILABLE_COUNTRIES',
      '- ASK_AVAILABLE_PROGRAMS',
      '- REQUEST_QUOTE',
      '- ASK_LANGUAGE_COURSES',
      '- ASK_CAMPS',
      '- UNKNOWN',
      'Use UNKNOWN when uncertain.',
      'Interpret short confirmations only with context from recent messages.',
    ].join('\n');

    const llmResult = await this.askJson<{ intent?: string; confidence?: number; menuWasShown?: boolean }>(prompt, {
      latestMessage,
      recentMessages: recentMessages.slice(-12),
    });

    const allowed = new Set<DetectedIntent>([
      'GREETING',
      'MENU_OPTION_1',
      'MENU_OPTION_2',
      'MENU_OPTION_3',
      'ASK_AVAILABLE_COUNTRIES',
      'ASK_AVAILABLE_PROGRAMS',
      'REQUEST_QUOTE',
      'ASK_LANGUAGE_COURSES',
      'ASK_CAMPS',
      'UNKNOWN',
    ]);

    const intent = typeof llmResult?.intent === 'string' && allowed.has(llmResult.intent as DetectedIntent)
      ? (llmResult.intent as DetectedIntent)
      : 'UNKNOWN';

    const confidence =
      typeof llmResult?.confidence === 'number' && Number.isFinite(llmResult.confidence)
        ? Math.max(0, Math.min(1, llmResult.confidence))
        : 0.5;

    const menuWasShown = typeof llmResult?.menuWasShown === 'boolean' ? llmResult.menuWasShown : false;

    return { intent, confidence, menuWasShown };
  }

  private async extractInquiryFields(args: ExtractInquiryFieldsArgs): Promise<ExtractedInquiryFields> {
    const latestMessage = (args.latestMessage ?? '').trim();
    if (!latestMessage) {
      return defaultExtractedFields;
    }

    const nowIso = args.nowIso ?? new Date().toISOString();
    const prompt = [
      'Extract structured lead fields from the latest user message for a study-abroad concierge.',
      'Resolve relative dates with nowIso.',
      'Use expectedField as strong guidance for what the assistant asked in this turn.',
      'If a field is not present in the message, return null for that field.',
      'When expectedField is residenceCountry, prioritize residenceCountry and do not fill cityOfResidence unless city is explicit.',
      'When expectedField is cityOfResidence, prioritize cityOfResidence and do not overwrite residenceCountry unless country is explicit.',
      'When expectedField is studentAge, only fill studentAge if an age is explicit.',
      'When expectedField is accommodation, only fill accommodationKey if accommodation is explicit.',
      'Do not infer unrelated fields from short replies.',
      'Handle Spanish and Latin American answers naturally.',
      'If expectedField is residenceCountry and latestMessage is a country name like México, Mexico, Colombia, Chile, Perú, Argentina, Ecuador, Guatemala, return that as residenceCountry.',
      'If expectedField is residenceCountry and latestMessage is clearly a city like Monterrey, Guadalajara, CDMX, Bogotá, Lima, return it as cityOfResidence and keep residenceCountry null.',
      'If expectedField is cityOfResidence and latestMessage is a city, return cityOfResidence.',
      'If expectedField is cityOfResidence and latestMessage is a country, return residenceCountry and keep cityOfResidence null.',
      'If the user gives multiple data in one message, extract all explicit fields.',
      'Examples:',
      '- expectedField=residenceCountry, latestMessage="México" => residenceCountry="México", cityOfResidence=null.',
      '- expectedField=residenceCountry, latestMessage="Monterrey" => residenceCountry=null, cityOfResidence="Monterrey".',
      '- expectedField=cityOfResidence, latestMessage="Monterrey" => cityOfResidence="Monterrey".',
      '- latestMessage="Vivo en México, en Guadalajara" => residenceCountry="México", cityOfResidence="Guadalajara".',
      'Return strict JSON exactly with keys:',
      '{"countryCode","studentAge","residenceCountry","cityOfResidence","familyKey","accommodationKey","preferredStartMonth","preferredStartYear","preferredStartUndecided","weeks","weeksUndecided","firstName","lastName","email","confidence"}',
      'Allowed countryCode: CA, US, GB, IT, FR, IE, or null.',
      'Allowed familyKey: CAMP, LANGUAGE_COURSE, SCHOOL_PROGRAM, or null.',
      'Allowed accommodationKey: HOST_FAMILY, UNIVERSITY_RESIDENCE, SHARED_APARTMENT, or null.',
      'preferredStartMonth must be 1..12 or null.',
      'preferredStartYear must be a 4-digit year or null.',
      'preferredStartUndecided must be true when user explicitly says they do not know date/month yet; otherwise false.',
      'weeks must be positive integer or null.',
      'weeksUndecided must be true when user explicitly says they do not know weeks/duration yet; otherwise false.',
      'confidence must be 0..1.',
    ].join('\n');

    let llmResult = await this.askJson<Partial<ExtractedInquiryFields>>(prompt, {
      latestMessage,
      previousAssistantMessage: args.previousAssistantMessage ?? null,
      expectedField: args.expectedField ?? null,
      inquirySnapshot: args.inquirySnapshot ?? null,
      nowIso,
      recentMessages: Array.isArray(args.recentMessages) ? args.recentMessages.slice(-8) : [],
    });

    // Fallback IA dedicado para fechas relativas cuando no pudo inferir mes/año.
    if (!llmResult?.preferredStartMonth && typeof args.previousAssistantMessage === 'string') {
      const datePrompt = [
        'Extract start month/year from the user message using previous assistant question context.',
        'If previous assistant message is asking about month and user says next/siguiente/próximo, resolve it from nowIso.',
        'Return strict JSON with keys {"preferredStartMonth","preferredStartYear","confidence"}.',
        'preferredStartMonth: 1..12 or null.',
        'preferredStartYear: 4-digit year or null.',
        'confidence: 0..1.',
      ].join('\n');

      const dateResult = await this.askJson<{
        preferredStartMonth?: number | null;
        preferredStartYear?: number | null;
        confidence?: number;
      }>(datePrompt, {
        latestMessage,
        previousAssistantMessage: args.previousAssistantMessage,
        nowIso,
      });

      llmResult = {
        ...(llmResult ?? {}),
        preferredStartMonth: llmResult?.preferredStartMonth ?? dateResult?.preferredStartMonth ?? null,
        preferredStartYear: llmResult?.preferredStartYear ?? dateResult?.preferredStartYear ?? null,
        confidence:
          typeof llmResult?.confidence === 'number'
            ? llmResult.confidence
            : typeof dateResult?.confidence === 'number'
              ? dateResult.confidence
              : llmResult?.confidence,
      };
    }

    return {
      countryCode: this.asCountryCode(llmResult?.countryCode),
      studentAge: this.asPositiveInt(llmResult?.studentAge),
      residenceCountry: this.asNonEmptyString(llmResult?.residenceCountry),
      cityOfResidence: this.asNonEmptyString(llmResult?.cityOfResidence),
      familyKey: this.asFamilyKey(llmResult?.familyKey),
      accommodationKey: this.asAccommodationKey(llmResult?.accommodationKey),
      preferredStartMonth: this.asMonth(llmResult?.preferredStartMonth),
      preferredStartYear: this.asYear(llmResult?.preferredStartYear),
      preferredStartUndecided: this.asBoolean(llmResult?.preferredStartUndecided),
      weeks: this.asPositiveInt(llmResult?.weeks),
      weeksUndecided: this.asBoolean(llmResult?.weeksUndecided),
      firstName: this.asNonEmptyString(llmResult?.firstName),
      lastName: this.asNonEmptyString(llmResult?.lastName),
      email: this.asEmail(llmResult?.email),
      confidence: this.asConfidence(llmResult?.confidence),
    };
  }

  private asCountryCode(value: unknown): ExtractedInquiryFields['countryCode'] {
    return value === 'CA' || value === 'US' || value === 'GB' || value === 'IT' || value === 'FR' || value === 'IE'
      ? value
      : null;
  }

  private asFamilyKey(value: unknown): ExtractedInquiryFields['familyKey'] {
    return value === 'CAMP' || value === 'LANGUAGE_COURSE' || value === 'SCHOOL_PROGRAM' ? value : null;
  }

  private asAccommodationKey(value: unknown): ExtractedInquiryFields['accommodationKey'] {
    return value === 'HOST_FAMILY' || value === 'UNIVERSITY_RESIDENCE' || value === 'SHARED_APARTMENT' ? value : null;
  }

  private asPositiveInt(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  private asMonth(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 12 ? Math.floor(value) : null;
  }

  private asYear(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 2020 && value <= 2100
      ? Math.floor(value)
      : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private asBoolean(value: unknown): boolean {
    return value === true;
  }

  private asEmail(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email.includes('@') && email.includes('.') ? email : null;
  }

  private asConfidence(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  private async askJson<T>(instructions: string, payload: Record<string, unknown>): Promise<T | null> {
    try {
      const response = await this.responsesClient.createTextResponse({
        instructions,
        input: JSON.stringify(payload),
      });
      const parsed = JSON.parse(response.outputText) as T;
      return parsed;
    } catch {
      return null;
    }
  }

  private async evaluatePolicySignals(args: EvaluatePolicySignalsArgs): Promise<PolicySignals> {
    const latestMessage = (args.latestMessage ?? '').trim();
    const prompt = [
      'Evaluate conversation policy signals for a WhatsApp education concierge.',
      'Return strict JSON with shape:',
      '{"menuWasShown": boolean, "asksAccommodationOptions": boolean, "isNegativeProgramAnswer": boolean, "handoffStep": "ask_name|ask_email|confirm_handoff|none", "resolvedCountryCode": "CA|US|GB|IT|FR|IE|null", "confidence": number, "needsClarification": boolean}',
      'Use recent messages, latest message, previous assistant message, and inquiry snapshot context.',
      'Use resolvedCountryCode null when country is not clear.',
      'Use needsClarification=true when ambiguity is high or context is insufficient.',
      'confidence must be 0..1.',
    ].join('\n');

    const llmResult = await this.askJson<Partial<PolicySignals>>(prompt, {
      latestMessage,
      previousAssistantMessage: args.previousAssistantMessage ?? null,
      recentMessages: Array.isArray(args.recentMessages) ? args.recentMessages.slice(-15) : [],
      inquirySnapshot: args.inquirySnapshot ?? null,
    });

    const confidence = this.asConfidence(llmResult?.confidence);
    const needsClarification = llmResult?.needsClarification === true && confidence < 0.8;

    return {
      menuWasShown: llmResult?.menuWasShown === true,
      asksAccommodationOptions: llmResult?.asksAccommodationOptions === true,
      isNegativeProgramAnswer: llmResult?.isNegativeProgramAnswer === true,
      handoffStep: this.asHandoffStep(llmResult?.handoffStep),
      resolvedCountryCode: this.asCountryCode(llmResult?.resolvedCountryCode),
      confidence,
      needsClarification,
    };
  }

  private asHandoffStep(value: unknown): PolicySignals['handoffStep'] {
    return value === 'ask_name' || value === 'ask_email' || value === 'confirm_handoff' ? value : 'none';
  }

  private async getProgramDetail(args: GetProgramDetailArgs) {
    return this.catalogRepository.findProgramBySlug(args.slug);
  }

  private async listAvailableCountries(args: ListAvailableCountriesArgs) {
    const countries = await this.catalogRepository.findCountries({
      activeOnly: args.activeOnly ?? true,
    });

    return {
      countries: countries.map((country) => ({
        code: country.code,
        name: this.toSpanishCountryName(country.code, country.name),
        active: country.active,
      })),
    };
  }

  private async listAvailablePrograms(args: ListAvailableProgramsArgs) {
    const programs = await this.catalogRepository.findPrograms({
      activeOnly: args.activeOnly ?? true,
      countryCode: args.countryCode,
      familyKey: args.familyKey,
    });

    return {
      programs: programs.map((program) => ({
        slug: program.slug,
        name: program.name,
        familyKey: program.family.key,
        familyName: program.family.name,
        countryCode: program.country.code,
        countryName: this.toSpanishCountryName(program.country.code, program.country.name),
        minAge: program.minAge,
        maxAge: program.maxAge,
        minWeeks: program.minWeeks,
        maxWeeks: program.maxWeeks,
      })),
    };
  }

  private async listAvailableAccommodations(args: ListAvailableAccommodationsArgs) {
    const programs = await this.catalogRepository.findPrograms({
      activeOnly: args.activeOnly ?? true,
      countryCode: args.countryCode,
      familyKey: args.familyKey,
    });

    const studentAge = typeof args.studentAge === 'number' && Number.isFinite(args.studentAge) ? args.studentAge : null;
    const byKey = new Map<
      string,
      { key: string; name: string; minAge: number | null; maxAge: number | null }
    >();

    for (const program of programs) {
      for (const accommodation of program.accommodations) {
        if (studentAge != null) {
          if (accommodation.minAge != null && studentAge < accommodation.minAge) continue;
          if (accommodation.maxAge != null && studentAge > accommodation.maxAge) continue;
        }

        const existing = byKey.get(accommodation.key);
        if (!existing) {
          byKey.set(accommodation.key, {
            key: accommodation.key,
            name: accommodation.name,
            minAge: accommodation.minAge ?? null,
            maxAge: accommodation.maxAge ?? null,
          });
          continue;
        }

        const minAge =
          existing.minAge == null
            ? (accommodation.minAge ?? null)
            : accommodation.minAge == null
              ? existing.minAge
              : Math.min(existing.minAge, accommodation.minAge);

        const maxAge =
          existing.maxAge == null
            ? (accommodation.maxAge ?? null)
            : accommodation.maxAge == null
              ? existing.maxAge
              : Math.max(existing.maxAge, accommodation.maxAge);

        byKey.set(accommodation.key, {
          key: accommodation.key,
          name: existing.name || accommodation.name,
          minAge,
          maxAge,
        });
      }
    }

    return {
      countryCode: args.countryCode ?? null,
      familyKey: args.familyKey ?? null,
      studentAge,
      accommodations: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  private async listWeeksOptions(args: ListWeeksOptionsArgs) {
    const programs = await this.catalogRepository.findPrograms({
      activeOnly: true,
      countryCode: args.countryCode,
      familyKey: args.familyKey,
    });

    const filteredPrograms = args.programSlug ? programs.filter((program) => program.slug === args.programSlug) : programs;

    const minCandidates = filteredPrograms
      .map((program) => program.minWeeks)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const maxCandidates = filteredPrograms
      .map((program) => program.maxWeeks)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

    const minWeeks = minCandidates.length > 0 ? Math.min(...minCandidates) : null;
    const maxWeeks = maxCandidates.length > 0 ? Math.max(...maxCandidates) : null;

    // Solo valores explícitos que existen en BD (sin generar rangos artificiales).
    const options = [...new Set([...minCandidates, ...maxCandidates])].sort((a, b) => a - b);

    return {
      countryCode: args.countryCode ?? null,
      familyKey: args.familyKey ?? null,
      programSlug: args.programSlug ?? null,
      minWeeks,
      maxWeeks,
      options,
      basedOnPrograms: filteredPrograms.map((program) => ({
        slug: program.slug,
        name: program.name,
        minWeeks: program.minWeeks,
        maxWeeks: program.maxWeeks,
      })),
    };
  }

  private async updateInquiry(args: UpdateInquiryArgs) {
    return this.inquiryRepository.update({
      inquiryId: args.inquiryId,
      countryCode: args.countryCode,
      familyKey: args.familyKey,
      programSlug: args.programSlug,
      studentAge: args.studentAge,
      cityOfResidence: args.cityOfResidence,
      preferredStartMonth: args.preferredStartMonth,
      preferredStartYear: args.preferredStartYear,
      accommodationKey: args.accommodationKey,
      weeks: args.weeks,
      notes: args.notes,
    });
  }

  private toSpanishCountryName(code: string, fallbackName: string): string {
    switch (code) {
      case 'CA':
        return 'Canadá';
      case 'US':
        return 'Estados Unidos';
      case 'GB':
        return 'Inglaterra';
      case 'IT':
        return 'Italia';
      case 'FR':
        return 'Francia';
      case 'IE':
        return 'Irlanda';
      default:
        return fallbackName;
    }
  }
}
