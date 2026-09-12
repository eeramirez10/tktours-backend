ALTER TABLE "Message"
ADD COLUMN "readByAdminAt" TIMESTAMP(3);

UPDATE "Message"
SET "readByAdminAt" = "createdAt"
WHERE "direction" = 'INBOUND';

CREATE INDEX "Message_direction_readByAdminAt_idx"
ON "Message"("direction", "readByAdminAt");
