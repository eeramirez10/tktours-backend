-- CreateEnum
CREATE TYPE "ConciergeTurnStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConciergeToolCallStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ConciergeTurn" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "inquiryId" UUID,
    "incomingMessageId" UUID,
    "responseId" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "ConciergeTurnStatus" NOT NULL DEFAULT 'STARTED',
    "inputJson" JSONB NOT NULL,
    "rawResponseText" TEXT,
    "structuredResponseJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ConciergeTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConciergeToolCall" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "turnId" UUID NOT NULL,
    "callId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" "ConciergeToolCallStatus" NOT NULL DEFAULT 'STARTED',
    "argumentsJson" JSONB,
    "outputJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ConciergeToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConciergeTurn_conversationId_startedAt_idx" ON "ConciergeTurn"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "ConciergeTurn_inquiryId_startedAt_idx" ON "ConciergeTurn"("inquiryId", "startedAt");

-- CreateIndex
CREATE INDEX "ConciergeTurn_status_startedAt_idx" ON "ConciergeTurn"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ConciergeToolCall_turnId_startedAt_idx" ON "ConciergeToolCall"("turnId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConciergeToolCall_turnId_callId_key" ON "ConciergeToolCall"("turnId", "callId");

-- AddForeignKey
ALTER TABLE "ConciergeTurn" ADD CONSTRAINT "ConciergeTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciergeTurn" ADD CONSTRAINT "ConciergeTurn_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciergeTurn" ADD CONSTRAINT "ConciergeTurn_incomingMessageId_fkey" FOREIGN KEY ("incomingMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConciergeToolCall" ADD CONSTRAINT "ConciergeToolCall_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "ConciergeTurn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
