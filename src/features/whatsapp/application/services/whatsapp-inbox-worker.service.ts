import { prisma } from '../../../../shared/infrastructure/database/prisma.js';
import { logger } from '../../../../shared/config/logger.js';
import { conversationRealtimeHub } from '../../../conversations/infrastructure/realtime/conversation-realtime-hub.js';
import { MetaWhatsAppInboundService } from './meta-whatsapp-inbound.service.js';

type InboxJob = { id: bigint; conversationId: string; messageId: string; recipientWaId: string };

export class WhatsAppInboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(private readonly inbound = new MetaWhatsAppInboundService()) {}

  start() {
    this.stopped = false;
    this.timer = setInterval(() => { void this.tick(); }, 500);
    this.timer.unref();
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      // A lease interruption has an uncertain transport outcome. Surface it; never silently resend.
      const interrupted = await prisma.whatsAppInboundJob.findMany({ where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - 120_000) } } });
      for (const job of interrupted) {
        const changed = await prisma.whatsAppInboundJob.updateMany({ where: { id: job.id, status: 'PROCESSING', lockedAt: job.lockedAt }, data: {
          status: 'FAILED', finishedAt: new Date(), errorMessage: 'Processing interrupted; transport outcome requires review',
        } });
        if (!changed.count) continue;
        await prisma.conciergeTurn.updateMany({ where: { incomingMessageId: job.messageId, status: 'STARTED' }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'Inbox worker lease interrupted' } });
        logger.error({ messageId: job.messageId, conversationId: job.conversationId }, 'whatsapp processing interrupted; message remains persisted');
        conversationRealtimeHub.publish({ type: 'concierge.failed', conversationId: job.conversationId, messageId: job.messageId, error: 'El procesamiento se interrumpió; el mensaje está guardado y requiere revisión.' });
      }
      while (!this.stopped) {
        const jobs = await prisma.$queryRaw<InboxJob[]>`
          UPDATE "WhatsAppInboundJob" SET "status" = 'PROCESSING', "lockedAt" = NOW()
          WHERE "id" = (
            SELECT candidate."id" FROM "WhatsAppInboundJob" candidate
            WHERE candidate."status" = 'PENDING'
              AND NOT EXISTS (
                SELECT 1 FROM "WhatsAppInboundJob" earlier
                WHERE earlier."conversationId" = candidate."conversationId"
                  AND (earlier."status" = 'PROCESSING' OR (earlier."status" = 'PENDING' AND earlier."id" < candidate."id"))
              )
            ORDER BY candidate."id" FOR UPDATE SKIP LOCKED LIMIT 1
          ) RETURNING "id", "conversationId", "messageId", "recipientWaId"
        `;
        const job = jobs[0];
        if (!job) break;
        const heartbeat = setInterval(() => {
          void prisma.whatsAppInboundJob.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data: { lockedAt: new Date() } })
            .catch((error) => logger.error({ err: error, messageId: job.messageId }, 'inbox heartbeat failed'));
        }, 30_000);
        heartbeat.unref();
        try {
          await this.inbound.processPersistedMessage(job);
          await prisma.whatsAppInboundJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', finishedAt: new Date() } });
        } catch (error) {
          logger.error({ err: error, messageId: job.messageId }, 'whatsapp persisted message processing failed');
          await prisma.whatsAppInboundJob.update({ where: { id: job.id }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: error instanceof Error ? error.message : String(error) } });
          conversationRealtimeHub.publish({ type: 'concierge.failed', conversationId: job.conversationId, messageId: job.messageId, error: 'No se pudo completar la respuesta. El mensaje recibido está guardado.' });
        } finally {
          clearInterval(heartbeat);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'whatsapp inbox worker failed; pending messages retained');
    } finally {
      this.running = false;
    }
  }
}
