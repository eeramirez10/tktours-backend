CREATE TABLE "WhatsAppInboundJob" (
  "id" BIGSERIAL PRIMARY KEY,
  "messageId" UUID NOT NULL UNIQUE REFERENCES "Message"("id") ON DELETE CASCADE,
  "conversationId" UUID NOT NULL,
  "recipientWaId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lockedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3)
);
CREATE INDEX "WhatsAppInboundJob_status_id_idx" ON "WhatsAppInboundJob"("status", "id");
CREATE INDEX "WhatsAppInboundJob_conversationId_status_id_idx" ON "WhatsAppInboundJob"("conversationId", "status", "id");
