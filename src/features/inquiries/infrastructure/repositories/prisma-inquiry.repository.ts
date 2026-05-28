import { Prisma } from '@prisma/client';

import { ConflictAppError, NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { InquiryRepository } from '../../domain/repositories/inquiry.repository.js';
import type {
  CreateInquiryInput,
  InquiryDetail,
  InquiryListItem,
  ListInquiriesQuery,
  UpdateInquiryInput,
  UpdateInquiryStatusInput,
} from '../../domain/types/inquiry.types.js';

const inquirySelect = {
  id: true,
  status: true,
  studentAge: true,
  cityOfResidence: true,
  preferredStartMonth: true,
  preferredStartYear: true,
  weeks: true,
  notes: true,
  qualificationJson: true,
  createdAt: true,
  updatedAt: true,
  country: { select: { id: true, code: true, name: true } },
  family: { select: { id: true, key: true, name: true } },
  program: { select: { id: true, slug: true, name: true } },
  accommodationType: { select: { id: true, key: true, name: true } },
  contact: {
    select: {
      id: true,
      waId: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      city: true,
    },
  },
  conversation: {
    select: {
      id: true,
      channel: true,
      status: true,
      currentStage: true,
      lastMessageAt: true,
    },
  },
  recommendations: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reason: true,
      confidence: true,
      createdAt: true,
      program: { select: { id: true, slug: true, name: true } },
      resource: { select: { id: true, title: true } },
    },
  },
  resourceSends: {
    orderBy: { sentAt: 'desc' },
    select: {
      id: true,
      sentReason: true,
      sentAt: true,
      resourceVersionId: true,
      resource: { select: { id: true, title: true } },
    },
  },
  _count: {
    select: { recommendations: true },
  },
} satisfies Prisma.InquirySelect;

type InquiryRecord = Prisma.InquiryGetPayload<{ select: typeof inquirySelect }>;

function mapInquiry(record: InquiryRecord): InquiryDetail {
  return {
    id: record.id,
    status: record.status,
    studentAge: record.studentAge,
    cityOfResidence: record.cityOfResidence,
    preferredStartMonth: record.preferredStartMonth,
    preferredStartYear: record.preferredStartYear,
    weeks: record.weeks,
    notes: record.notes,
    qualificationJson: (record.qualificationJson as Record<string, unknown> | null) ?? null,
    country: record.country ? { id: record.country.id, code: record.country.code, name: record.country.name } : null,
    family: record.family ? { id: record.family.id, key: record.family.key, name: record.family.name } : null,
    program: record.program ? { id: record.program.id, slug: record.program.slug, name: record.program.name } : null,
    accommodationType: record.accommodationType
      ? { id: record.accommodationType.id, key: record.accommodationType.key, name: record.accommodationType.name }
      : null,
    contact: record.contact,
    conversation: record.conversation,
    recommendationsCount: record._count.recommendations,
    recommendations: record.recommendations.map((item) => ({
      id: item.id,
      reason: item.reason,
      confidence: item.confidence,
      createdAt: item.createdAt,
      program: { id: item.program.id, slug: item.program.slug, name: item.program.name },
      resource: item.resource ? { id: item.resource.id, name: item.resource.title } : null,
    })),
    resourceSends: record.resourceSends.map((item) => ({
      id: item.id,
      sentReason: item.sentReason,
      sentAt: item.sentAt,
      resourceVersionId: item.resourceVersionId,
      resource: { id: item.resource.id, name: item.resource.title },
    })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toNullableJsonInput(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function mapListItem(record: InquiryRecord): InquiryListItem {
  const detail = mapInquiry(record);
  return {
    id: detail.id,
    status: detail.status,
    studentAge: detail.studentAge,
    cityOfResidence: detail.cityOfResidence,
    preferredStartMonth: detail.preferredStartMonth,
    preferredStartYear: detail.preferredStartYear,
    weeks: detail.weeks,
    notes: detail.notes,
    country: detail.country,
    family: detail.family,
    program: detail.program,
    accommodationType: detail.accommodationType,
    contact: detail.contact,
    conversation: detail.conversation,
    recommendationsCount: detail.recommendationsCount,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export class PrismaInquiryRepository implements InquiryRepository {
  async findMany(query: ListInquiriesQuery): Promise<InquiryListItem[]> {
    const items = await prisma.inquiry.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.countryCode ? { country: { code: query.countryCode } } : {}),
        ...(query.familyKey ? { family: { key: query.familyKey } } : {}),
        ...(query.search
          ? {
              OR: [
                { notes: { contains: query.search, mode: 'insensitive' } },
                { cityOfResidence: { contains: query.search, mode: 'insensitive' } },
                { program: { name: { contains: query.search, mode: 'insensitive' } } },
                { contact: { firstName: { contains: query.search, mode: 'insensitive' } } },
                { contact: { lastName: { contains: query.search, mode: 'insensitive' } } },
                { contact: { waId: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: inquirySelect,
    });

    return items.map(mapListItem);
  }

  async findById(inquiryId: string): Promise<InquiryDetail | null> {
    const inquiry = await prisma.inquiry.findUnique({ where: { id: inquiryId }, select: inquirySelect });
    return inquiry ? mapInquiry(inquiry) : null;
  }

  async create(input: CreateInquiryInput): Promise<InquiryDetail> {
    const relations = await this.resolveRelations({
      countryCode: input.countryCode,
      familyKey: input.familyKey,
      programSlug: input.programSlug,
      accommodationKey: input.accommodationKey,
    });

    const inquiry = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const contactId = await this.resolveOrCreateContact(tx, input);
      const conversationId = await this.resolveOrCreateConversation(tx, input, contactId);

      return tx.inquiry.create({
        data: {
          conversationId,
          contactId,
          countryId: relations.countryId,
          familyId: relations.familyId,
          programId: relations.programId,
          accommodationTypeId: relations.accommodationTypeId,
          studentAge: input.studentAge ?? null,
          cityOfResidence: input.cityOfResidence ?? null,
          preferredStartMonth: input.preferredStartMonth ?? null,
          preferredStartYear: input.preferredStartYear ?? null,
          weeks: input.weeks ?? null,
          notes: input.notes ?? null,
          qualificationJson: toNullableJsonInput(input.qualificationJson),
          status: input.status ?? 'OPEN',
        },
        select: inquirySelect,
      });
    });

    return mapInquiry(inquiry);
  }

  async update(input: UpdateInquiryInput): Promise<InquiryDetail> {
    const current = await prisma.inquiry.findUnique({
      where: { id: input.inquiryId },
      select: {
        id: true,
        country: { select: { code: true } },
        family: { select: { key: true } },
        program: { select: { slug: true } },
        accommodationType: { select: { key: true } },
      },
    });

    if (!current) {
      throw new NotFoundAppError('Inquiry not found');
    }

    const relations = await this.resolveRelations({
      countryCode: Object.prototype.hasOwnProperty.call(input, 'countryCode') ? input.countryCode ?? undefined : current.country?.code,
      familyKey: Object.prototype.hasOwnProperty.call(input, 'familyKey') ? input.familyKey ?? undefined : current.family?.key,
      programSlug: Object.prototype.hasOwnProperty.call(input, 'programSlug') ? input.programSlug ?? undefined : current.program?.slug,
      accommodationKey: Object.prototype.hasOwnProperty.call(input, 'accommodationKey')
        ? input.accommodationKey ?? undefined
        : current.accommodationType?.key,
    });

    const updated = await prisma.inquiry.update({
      where: { id: input.inquiryId },
      data: {
        countryId: relations.countryId,
        familyId: relations.familyId,
        programId: relations.programId,
        accommodationTypeId: relations.accommodationTypeId,
        ...(Object.prototype.hasOwnProperty.call(input, 'studentAge') ? { studentAge: input.studentAge ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'cityOfResidence') ? { cityOfResidence: input.cityOfResidence ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'preferredStartMonth') ? { preferredStartMonth: input.preferredStartMonth ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'preferredStartYear') ? { preferredStartYear: input.preferredStartYear ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'weeks') ? { weeks: input.weeks ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'notes') ? { notes: input.notes ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'qualificationJson')
          ? { qualificationJson: toNullableJsonInput(input.qualificationJson) }
          : {}),
      },
      select: inquirySelect,
    });

    return mapInquiry(updated);
  }

  async updateStatus(input: UpdateInquiryStatusInput): Promise<InquiryDetail> {
    try {
      const updated = await prisma.inquiry.update({
        where: { id: input.inquiryId },
        data: { status: input.status },
        select: inquirySelect,
      });
      return mapInquiry(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundAppError('Inquiry not found');
      }
      throw error;
    }
  }

  async replaceRecommendations(
    inquiryId: string,
    recommendations: Array<{ programId: string; reason: string | null; confidence: number | null }>,
  ): Promise<InquiryDetail> {
    const exists = await prisma.inquiry.findUnique({ where: { id: inquiryId }, select: { id: true } });
    if (!exists) {
      throw new NotFoundAppError('Inquiry not found');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.inquiryRecommendation.deleteMany({ where: { inquiryId } });
      if (recommendations.length > 0) {
        await tx.inquiryRecommendation.createMany({
          data: recommendations.map((item) => ({
            inquiryId,
            programId: item.programId,
            reason: item.reason,
            confidence: item.confidence,
          })),
        });
      }
    });

    const updated = await this.findById(inquiryId);
    if (!updated) {
      throw new NotFoundAppError('Inquiry not found');
    }
    return updated;
  }

  private async resolveRelations(input: {
    countryCode?: string;
    familyKey?: string;
    programSlug?: string;
    accommodationKey?: string;
  }) {
    const country = input.countryCode
      ? await prisma.country.findUnique({ where: { code: input.countryCode }, select: { id: true } })
      : null;
    if (input.countryCode && !country) {
      throw new NotFoundAppError(`Country not found for code ${input.countryCode}`);
    }

    const family = input.familyKey
      ? await prisma.productFamily.findUnique({ where: { key: input.familyKey as never }, select: { id: true } })
      : null;
    if (input.familyKey && !family) {
      throw new NotFoundAppError(`Family not found for key ${input.familyKey}`);
    }

    const accommodationType = input.accommodationKey
      ? await prisma.accommodationType.findUnique({ where: { key: input.accommodationKey as never }, select: { id: true } })
      : null;
    if (input.accommodationKey && !accommodationType) {
      throw new NotFoundAppError(`Accommodation not found for key ${input.accommodationKey}`);
    }

    const program = input.programSlug
      ? await prisma.program.findFirst({
          where: {
            slug: input.programSlug,
            ...(country ? { countryId: country.id } : {}),
          },
          select: { id: true, familyId: true, countryId: true },
        })
      : null;
    if (input.programSlug && !program) {
      throw new NotFoundAppError(`Program not found for slug ${input.programSlug}`);
    }

    if (program && family && program.familyId !== family.id) {
      throw new ConflictAppError('Program does not belong to the provided family');
    }
    if (program && country && program.countryId !== country.id) {
      throw new ConflictAppError('Program does not belong to the provided country');
    }

    return {
      countryId: country?.id ?? null,
      familyId: family?.id ?? null,
      programId: program?.id ?? null,
      accommodationTypeId: accommodationType?.id ?? null,
    };
  }

  private async resolveOrCreateContact(tx: Prisma.TransactionClient, input: CreateInquiryInput): Promise<string | null> {
    if (input.contactId) {
      const contact = await tx.contact.findUnique({ where: { id: input.contactId }, select: { id: true } });
      if (!contact) {
        throw new NotFoundAppError('Contact not found');
      }
      return contact.id;
    }

    if (!input.contact) {
      return null;
    }

    if (input.contact.waId) {
      const existing = await tx.contact.findUnique({ where: { waId: input.contact.waId }, select: { id: true } });
      if (existing) {
        return existing.id;
      }
    }

    const created = await tx.contact.create({
      data: {
        waId: input.contact.waId,
        firstName: input.contact.firstName,
        lastName: input.contact.lastName,
        email: input.contact.email,
        phone: input.contact.phone,
        city: input.contact.city,
        notes: input.contact.notes ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveOrCreateConversation(
    tx: Prisma.TransactionClient,
    input: CreateInquiryInput,
    contactId: string | null,
  ): Promise<string> {
    if (input.conversationId) {
      const conversation = await tx.conversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, contactId: true },
      });
      if (!conversation) {
        throw new NotFoundAppError('Conversation not found');
      }
      if (contactId && conversation.contactId && conversation.contactId !== contactId) {
        throw new ConflictAppError('Conversation belongs to a different contact');
      }
      return conversation.id;
    }

    const conversation = await tx.conversation.create({
      data: {
        contactId,
        channel: input.channel ?? 'WHATSAPP',
      },
      select: { id: true },
    });

    return conversation.id;
  }
}
