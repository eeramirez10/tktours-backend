import { Prisma } from '@prisma/client';

import { NotFoundAppError } from '../../../../shared/domain/errors/app-error.js';
import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import type { ConversationRepository } from '../../domain/repositories/conversation.repository.js';
import type {
  ConversationDetail,
  ConversationListItem,
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  UpdateConversationInput,
} from '../../domain/types/conversation.types.js';

const conversationSelect = {
  id: true,
  channel: true,
  status: true,
  currentStage: true,
  contextJson: true,
  lastMessageAt: true,
  createdAt: true,
  updatedAt: true,
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
  inquiries: {
    orderBy: { createdAt: 'desc' },
    select: {
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
      country: { select: { name: true } },
      family: { select: { name: true } },
      location: { select: { name: true } },
      program: { select: { name: true } },
      accommodationType: { select: { name: true } },
    },
  },
  messages: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      direction: true,
      text: true,
      mediaUrl: true,
      providerMessageId: true,
      metadata: true,
      createdAt: true,
    },
  },
  _count: {
    select: {
      inquiries: true,
      messages: true,
    },
  },
} satisfies Prisma.ConversationSelect;

type ConversationRecord = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

function toNullableJsonInput(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function mapConversation(record: ConversationRecord): ConversationDetail {
  return {
    id: record.id,
    channel: record.channel,
    status: record.status,
    currentStage: record.currentStage,
    lastMessageAt: record.lastMessageAt,
    contextJson: (record.contextJson as Record<string, unknown> | null) ?? null,
    contact: record.contact,
    inquiriesCount: record._count.inquiries,
    messagesCount: record._count.messages,
    inquiries: record.inquiries.map((item) => {
      const qualification = item.qualificationJson as Record<string, unknown> | null;
      const residenceCountry =
        qualification && typeof qualification.residenceCountry === 'string' && qualification.residenceCountry.trim().length > 0
          ? qualification.residenceCountry.trim()
          : null;
      return {
        id: item.id,
        status: item.status,
        studentAge: item.studentAge,
        residenceCountry,
        cityOfResidence: item.cityOfResidence,
        countryName: item.country?.name ?? null,
        familyName: item.family?.name ?? null,
        locationName: item.location?.name ?? null,
        programName: item.program?.name ?? null,
        accommodationName: item.accommodationType?.name ?? null,
        preferredStartMonth: item.preferredStartMonth,
        preferredStartYear: item.preferredStartYear,
        weeks: item.weeks,
        notes: item.notes,
        createdAt: item.createdAt,
      };
    }),
    messages: record.messages.map((item) => ({
      id: item.id,
      direction: item.direction,
      text: item.text,
      mediaUrl: item.mediaUrl,
      providerMessageId: item.providerMessageId,
      metadata: (item.metadata as Record<string, unknown> | null) ?? null,
      createdAt: item.createdAt,
    })),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapListItem(record: ConversationRecord): ConversationListItem {
  const detail = mapConversation(record);
  return {
    id: detail.id,
    channel: detail.channel,
    status: detail.status,
    currentStage: detail.currentStage,
    lastMessageAt: detail.lastMessageAt,
    contextJson: detail.contextJson,
    contact: detail.contact,
    inquiriesCount: detail.inquiriesCount,
    messagesCount: detail.messagesCount,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export class PrismaConversationRepository implements ConversationRepository {
  async findMany(query: ListConversationsQuery): Promise<ConversationListItem[]> {
    const items = await prisma.conversation.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(query.search
          ? {
              OR: [
                { contact: { firstName: { contains: query.search, mode: 'insensitive' } } },
                { contact: { lastName: { contains: query.search, mode: 'insensitive' } } },
                { contact: { waId: { contains: query.search, mode: 'insensitive' } } },
                { messages: { some: { text: { contains: query.search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      select: conversationSelect,
    });

    return items.map(mapListItem);
  }

  async findById(conversationId: string): Promise<ConversationDetail | null> {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: conversationSelect });
    return conversation ? mapConversation(conversation) : null;
  }

  async create(input: CreateConversationInput): Promise<ConversationDetail> {
    const conversation = await prisma.conversation.create({
      data: {
        contactId: input.contactId ?? null,
        channel: input.channel ?? 'WHATSAPP',
        status: input.status ?? 'OPEN',
        currentStage: input.currentStage ?? 'START',
        contextJson: toNullableJsonInput(input.contextJson),
      },
      select: conversationSelect,
    });

    return mapConversation(conversation);
  }

  async update(input: UpdateConversationInput): Promise<ConversationDetail> {
    try {
      const conversation = await prisma.conversation.update({
        where: { id: input.conversationId },
        data: {
          ...(input.status ? { status: input.status } : {}),
          ...(input.currentStage ? { currentStage: input.currentStage } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, 'contextJson') ? { contextJson: toNullableJsonInput(input.contextJson) } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, 'lastMessageAt')
            ? { lastMessageAt: input.lastMessageAt ? new Date(input.lastMessageAt) : null }
            : {}),
        },
        select: conversationSelect,
      });

      return mapConversation(conversation);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundAppError('Conversation not found');
      }
      throw error;
    }
  }

  async createMessage(input: CreateMessageInput): Promise<ConversationDetail> {
    const exists = await prisma.conversation.findUnique({ where: { id: input.conversationId }, select: { id: true } });
    if (!exists) {
      throw new NotFoundAppError('Conversation not found');
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.message.create({
        data: {
          conversationId: input.conversationId,
          direction: input.direction,
          text: input.text,
          mediaUrl: input.mediaUrl ?? null,
          providerMessageId: input.providerMessageId ?? null,
          metadata: toNullableJsonInput(input.metadata),
        },
      });

      await tx.conversation.update({
        where: { id: input.conversationId },
        data: {
          lastMessageAt: new Date(),
        },
      });
    });

    const updated = await this.findById(input.conversationId);
    if (!updated) {
      throw new NotFoundAppError('Conversation not found');
    }
    return updated;
  }
}
