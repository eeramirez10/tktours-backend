import { Prisma } from '@prisma/client';

import { prisma } from '../../../../shared/infrastructure/database/prisma.js';

const threadSelect = {
  id: true,
  status: true,
  currentStage: true,
  contextJson: true,
  lastMessageAt: true,
  updatedAt: true,
  createdAt: true,
} satisfies Prisma.ConversationSelect;

type ThreadRecord = Prisma.ConversationGetPayload<{ select: typeof threadSelect }>;

function toJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : null;
}

function toNullableJsonInput(value: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export type ConsolidateWhatsappThreadsResult = {
  contactsAffected: number;
  conversationsDeleted: number;
  inquiriesClosed: number;
  threadsReopened: number;
};

export class WhatsappConversationThreadService {
  async getOrCreateThread(contactId: string): Promise<{ id: string }> {
    const conversations = await this.findThreadsByContact(contactId);

    if (conversations.length === 0) {
      return prisma.conversation.create({
        data: {
          contactId,
          channel: 'WHATSAPP',
          status: 'OPEN',
          currentStage: 'START',
          contextJson: {
            source: 'twilio-webhook',
          },
        },
        select: { id: true },
      });
    }

    const canonical = conversations[0];
    const duplicates = conversations.slice(1);

    if (duplicates.length > 0) {
      await this.mergeIntoCanonical(canonical, duplicates);
    }

    const refreshed = await prisma.conversation.findUnique({
      where: { id: canonical.id },
      select: threadSelect,
    });

    if (!refreshed) {
      throw new Error('Canonical WhatsApp conversation disappeared during consolidation');
    }

    await this.reopenThreadIfNeeded(refreshed);

    return { id: refreshed.id };
  }

  async consolidateAllThreads(): Promise<ConsolidateWhatsappThreadsResult> {
    const groups = await prisma.conversation.groupBy({
      by: ['contactId'],
      where: {
        contactId: { not: null },
        channel: 'WHATSAPP',
      },
      _count: { _all: true },
      having: {
        contactId: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    const result: ConsolidateWhatsappThreadsResult = {
      contactsAffected: groups.length,
      conversationsDeleted: 0,
      inquiriesClosed: 0,
      threadsReopened: 0,
    };

    for (const group of groups) {
      if (!group.contactId) continue;

      const conversations = await this.findThreadsByContact(group.contactId);
      if (conversations.length <= 1) continue;

      const canonical = conversations[0];
      const duplicates = conversations.slice(1);

      const mergeStats = await this.mergeIntoCanonical(canonical, duplicates);
      result.conversationsDeleted += mergeStats.conversationsDeleted;
      result.inquiriesClosed += mergeStats.inquiriesClosed;

      const reopened = await this.reopenThreadIfNeeded(canonical);
      if (reopened) {
        result.threadsReopened += 1;
      }
    }

    return result;
  }

  private async findThreadsByContact(contactId: string): Promise<ThreadRecord[]> {
    return prisma.conversation.findMany({
      where: {
        contactId,
        channel: 'WHATSAPP',
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: threadSelect,
    });
  }

  private async mergeIntoCanonical(
    canonical: ThreadRecord,
    duplicates: ThreadRecord[],
  ): Promise<{ conversationsDeleted: number; inquiriesClosed: number }> {
    if (duplicates.length === 0) {
      return { conversationsDeleted: 0, inquiriesClosed: 0 };
    }

    const duplicateIds = duplicates.map((conversation) => conversation.id);
    const mergedAt = new Date().toISOString();
    const nextContext = {
      ...(toJsonObject(canonical.contextJson) ?? {}),
      whatsappThread: {
        mergedAt,
        mergedFromConversationIds: duplicateIds,
      },
    };

    const inquiriesToClose = await prisma.inquiry.findMany({
      where: {
        conversationId: { in: duplicateIds },
        status: { not: 'CLOSED' },
      },
      select: { id: true },
    });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (inquiriesToClose.length > 0) {
        await tx.inquiry.updateMany({
          where: { id: { in: inquiriesToClose.map((item) => item.id) } },
          data: { status: 'CLOSED' },
        });
      }

      await tx.message.updateMany({
        where: { conversationId: { in: duplicateIds } },
        data: { conversationId: canonical.id },
      });

      await tx.inquiry.updateMany({
        where: { conversationId: { in: duplicateIds } },
        data: { conversationId: canonical.id },
      });

      await tx.conciergeTurn.updateMany({
        where: { conversationId: { in: duplicateIds } },
        data: { conversationId: canonical.id },
      });

      await tx.conversation.update({
        where: { id: canonical.id },
        data: {
          contextJson: toNullableJsonInput(nextContext),
        },
      });

      await tx.conversation.deleteMany({
        where: { id: { in: duplicateIds } },
      });
    });

    return {
      conversationsDeleted: duplicateIds.length,
      inquiriesClosed: inquiriesToClose.length,
    };
  }

  private async reopenThreadIfNeeded(conversation: ThreadRecord): Promise<boolean> {
    const shouldRestartThread =
      conversation.status === 'CLOSED' ||
      conversation.status === 'ARCHIVED' ||
      conversation.currentStage === 'CLOSED';

    if (shouldRestartThread) {
      const nextContext = {
        ...(toJsonObject(conversation.contextJson) ?? {}),
        whatsappThread: {
          ...(toJsonObject(toJsonObject(conversation.contextJson)?.whatsappThread) ?? {}),
          reopenedAt: new Date().toISOString(),
          restartedFromClosedThread: true,
        },
      };

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.inquiry.updateMany({
          where: {
            conversationId: conversation.id,
            status: { not: 'CLOSED' },
          },
          data: { status: 'CLOSED' },
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'OPEN',
            currentStage: 'START',
            contextJson: toNullableJsonInput(nextContext),
          },
        });
      });

      return true;
    }

    if (conversation.status === 'PAUSED') {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: 'OPEN' },
      });
      return true;
    }

    return false;
  }
}
