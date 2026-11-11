import { env } from '../../../../shared/config/env.js';
import { inquiryProgress } from '../../../inquiries/domain/services/inquiry-progress.js';
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
  PersistConciergeOutcomeInput,
} from '../../domain/types/conversation.types.js';

const conversationSelect = {
  id: true,
  channel: true,
  status: true,
  controlMode: true,
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
      notes: true,
    },
  },
  inquiries: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      updatedAt: true,
      contact: { select: { firstName: true, lastName: true, email: true } },
      recommendations: { orderBy: { createdAt: 'asc' }, include: { program: true, resource: true } },
      resourceSends: { orderBy: { sentAt: 'asc' }, include: { resourceVersion: true, resource: true } },
      createdAt: true,
      country: { select: { name: true, code: true } },
      family: { select: { name: true, key: true } },
      location: { select: { name: true, slug: true } },
      program: { select: { name: true, slug: true } },
      accommodationType: { select: { name: true, key: true } },
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
      readByAdminAt: true,
      notificationSeenAt: true,
      createdAt: true,
    },
  },
  _count: {
    select: {
      inquiries: true,
      messages: true,
      conciergeTurns: { where: { status: 'STARTED' } },
    },
  },
} satisfies Prisma.ConversationSelect;

type ConversationRecord = Prisma.ConversationGetPayload<{ select: typeof conversationSelect }>;

function toNullableJsonInput(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function publicFileUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}
function deliveryStatus(value: unknown): string {
  const status = typeof value === 'string' ? value.toUpperCase() : 'UNKNOWN';
  if (['READ', 'DELIVERED', 'RESERVED', 'FAILED', 'ACCEPTED'].includes(status)) return status;
  return status === 'SENT' ? 'ACCEPTED' : status === 'FAILED_TO_REQUEST' ? 'FAILED' : 'UNKNOWN';
}
function mapConversation(record: ConversationRecord): ConversationDetail {
  const latestUnreadMessage = [...record.messages]
    .reverse()
    .find((item) => item.direction === 'INBOUND' && !item.readByAdminAt) ?? null;

  const context = record.contextJson as Record<string, unknown> | null;
  const current = record.inquiries[0];
  const recommendation = context?.resourceRecommendation as { criteria?: Record<string, unknown>; resourceIds?: string[]; status?: string; presentedAt?: string } | undefined;
  const detail: ConversationDetail = {
    recommendations: (current?.recommendations ?? []).map((item) => ({ id: item.id, title: item.resource?.title ?? item.program.name,
      reason: item.reason, criteria: null, createdAt: item.createdAt, status: 'REGISTERED' })),
    files: (current?.resourceSends ?? []).map((send) => ({ id: send.id, title: send.resource.title,
      fileName: send.resourceVersion?.fileName ?? null, versionId: send.resourceVersionId,
      versionNumber: send.resourceVersion?.versionNumber ?? null, url: send.resourceVersion?.fileUrl ? publicFileUrl(send.resourceVersion.fileUrl) : null,
      createdAt: send.sentAt, deliveryStatus: send.deliveryStatus, delivered: ['DELIVERED', 'READ'].includes(send.deliveryStatus) })),
    id: record.id,
    channel: record.channel,
    status: record.status,
    controlMode: record.controlMode,
    isConciergeProcessing: record._count.conciergeTurns > 0,
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
        progress: inquiryProgress({ ...item, qualificationJson: qualification, contact: item.contact ?? record.contact }, recommendation),
        preferredStartStatus: item.preferredStartMonth != null ? 'DEFINED' : qualification?.preferredStartStatus === 'UNDECIDED' ? 'UNDECIDED' : null,
        weeksStatus: item.weeks != null ? 'DEFINED' : qualification?.weeksStatus === 'UNDECIDED' ? 'UNDECIDED' : null,
        tripDays: typeof qualification?.tripDays === 'number' ? qualification.tripDays : null,
        updatedAt: item.updatedAt,
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
      readByAdminAt: item.readByAdminAt,
      notificationSeenAt: item.notificationSeenAt,
      createdAt: item.createdAt,
    })),
    unreadMessagesCount: record.messages.filter((item) => item.direction === 'INBOUND' && !item.readByAdminAt).length,
    unseenNotificationsCount: record.messages.filter((item) => item.direction === 'INBOUND' && !item.notificationSeenAt).length,
    latestMessage: record.messages.length > 0
      ? {
          ...record.messages[record.messages.length - 1],
          metadata: (record.messages[record.messages.length - 1].metadata as Record<string, unknown> | null) ?? null,
      }
      : null,
    latestUnreadMessage: latestUnreadMessage
      ? {
          ...latestUnreadMessage,
          metadata: (latestUnreadMessage.metadata as Record<string, unknown> | null) ?? null,
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  detail.currentInquiry = detail.inquiries[0] ?? null;
  return detail;
}

function mapListItem(record: ConversationRecord): ConversationListItem {
  const detail = mapConversation(record);
  return {
    id: detail.id,
    channel: detail.channel,
    status: detail.status,
    controlMode: detail.controlMode,
    isConciergeProcessing: detail.isConciergeProcessing,
    currentStage: detail.currentStage,
    lastMessageAt: detail.lastMessageAt,
    contextJson: detail.contextJson,
    contact: detail.contact,
    currentInquiry: detail.inquiries[0] ?? null,
    inquiriesCount: detail.inquiriesCount,
    messagesCount: detail.messagesCount,
    unreadMessagesCount: detail.unreadMessagesCount,
    unseenNotificationsCount: detail.unseenNotificationsCount,
    latestMessage: detail.latestMessage,
    latestUnreadMessage: detail.latestUnreadMessage,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };
}

export class PrismaConversationRepository implements ConversationRepository {
  async persistConciergeOutcome(input: PersistConciergeOutcomeInput): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (input.inquiryId && input.inquiryStatus) await tx.inquiry.update({ where: { id: input.inquiryId }, data: { status: input.inquiryStatus } });
      await tx.message.create({ data: { conversationId: input.conversationId, direction: 'OUTBOUND', text: input.replyText,
        mediaUrl: input.mediaUrl, metadata: input.metadata as Prisma.InputJsonValue } });
      await tx.conversation.update({ where: { id: input.conversationId }, data: {
        ...(input.explicitlyClosed ? { status: 'CLOSED' } : {}),
        ...(input.nextStage ? { currentStage: input.nextStage } : {}),
        contextJson: input.contextJson as Prisma.InputJsonValue, lastMessageAt: new Date(),
      } });
    });
  }
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

    return items.map(mapListItem).filter((item) => !query.inquiryStatus || item.currentInquiry?.status === query.inquiryStatus);
  }

  async findById(conversationId: string): Promise<ConversationDetail | null> {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: conversationSelect });
    if (!conversation) return null;
    const detail = mapConversation(conversation);
    detail.currentInquiry = detail.inquiries[0] ?? null;
    const current = conversation.inquiries[0];
    if (!current) return detail;
    const context = conversation.contextJson as Record<string, unknown> | null;
    const r = context?.resourceRecommendation as { criteria?: Record<string, unknown>; resourceIds?: string[]; status?: string; presentedAt?: string } | undefined;
    const urls = new Map<string, { messageId: string; createdAt: Date; deliveryStatus: string }>();
    for (const message of conversation.messages) {
      if (message.direction === 'SYSTEM' || message.createdAt < current.createdAt) continue;
      const metadata = message.metadata as Record<string, unknown> | null;
      const mediaUrls = [...new Set([message.mediaUrl, ...(Array.isArray(metadata?.mediaUrls) ? metadata.mediaUrls : [])]
        .filter((url): url is string => typeof url === 'string'))];
      for (const [index, url] of mediaUrls.entries()) {
        const statuses = Array.isArray(metadata?.metaMediaStatuses) ? metadata.metaMediaStatuses : [];
        urls.set(publicFileUrl(url), { messageId: message.id, createdAt: message.createdAt,
          deliveryStatus: message.direction === 'INBOUND' ? 'RECEIVED' : deliveryStatus(statuses[index]) });
      }
    }

    // Match historical URLs/IDs against every version, never assume the current edition was sent.
    const ids = [...urls.keys()].flatMap((url) => url.match(/versions\/([0-9a-f-]{36})\//i)?.[1] ?? []);
    const versions = await prisma.resourceVersion.findMany({ where: { OR: [
      { id: { in: ids } }, { fileUrl: { in: [...new Set([...urls.keys()].flatMap((url) => [url, url.startsWith(env.PUBLIC_BASE_URL.replace(/\/+$/, '') + '/') ? url.slice(env.PUBLIC_BASE_URL.replace(/\/+$/, '').length) : url]))] } },
      { resourceId: { in: r?.criteria?.inquiryId === current.id ? r.resourceIds ?? [] : [] } },
    ] }, include: { resource: true } });
    if (r?.criteria?.inquiryId === current.id && r.presentedAt) {
      for (const id of r.resourceIds ?? []) {
        const version = versions.find((item) => item.resourceId === id);
        detail.recommendations.push({ id, title: version?.resource.title ?? id, reason: null,
          criteria: r.criteria, createdAt: new Date(r.presentedAt), status: inquiryProgress({ ...current,
            qualificationJson: current.qualificationJson as Record<string, unknown> | null }, r).recommendationConfirmed ? 'CONFIRMED' : 'OUTDATED' });
      }
    }
    for (const [url, message] of urls) {
      const version = versions.find((item) => publicFileUrl(item.fileUrl) === url || url.includes(`/versions/${item.id}/`));
      const existing = detail.files.find((file) => file.url === url || (version && file.versionId === version.id));
      if (existing) continue;
      const legacy = version && detail.files.find((file) => !file.versionId && current.resourceSends.some((send) => send.id === file.id && send.resourceId === version.resourceId));
      const file = { id: `${message.messageId}:${url}`, title: version?.resource.title ?? 'Archivo adjunto', fileName: version?.fileName ?? null,
        versionId: version?.id ?? null, versionNumber: version?.versionNumber ?? null, url,
        createdAt: message.createdAt, deliveryStatus: message.deliveryStatus, delivered: ['DELIVERED', 'READ'].includes(message.deliveryStatus) };
      if (legacy) Object.assign(legacy, file, { id: legacy.id, deliveryStatus: legacy.deliveryStatus === 'UNKNOWN' ? file.deliveryStatus : legacy.deliveryStatus, delivered: legacy.delivered || (legacy.deliveryStatus === 'UNKNOWN' && file.delivered) });
      else detail.files.push(file);
    }
    return detail;
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
