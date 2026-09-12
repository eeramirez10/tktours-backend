ALTER TABLE "Message"
ADD COLUMN "notificationSeenAt" TIMESTAMP(3);

UPDATE "Message"
SET "notificationSeenAt" = "createdAt"
WHERE "direction" = 'INBOUND';

CREATE INDEX "Message_direction_notificationSeenAt_idx"
ON "Message"("direction", "notificationSeenAt");
