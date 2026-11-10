-- Deliberately leave existing durations and tariffs unconfirmed. Do not copy ProgramRule.
ALTER TABLE "Resource" ADD COLUMN "minWeeks" INTEGER,
                       ADD COLUMN "maxWeeks" INTEGER,
                       ADD COLUMN "tariffs" JSONB;
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_week_range_check" CHECK (
  ("minWeeks" IS NULL OR "minWeeks" BETWEEN 1 AND 104) AND
  ("maxWeeks" IS NULL OR "maxWeeks" BETWEEN 1 AND 104) AND
  ("minWeeks" IS NULL OR "maxWeeks" IS NULL OR "minWeeks" <= "maxWeeks")
);
ALTER TABLE "InquiryResourceSend" ADD COLUMN "attemptKey" TEXT,
                                  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
                                  ADD COLUMN "providerMessageId" TEXT;
CREATE UNIQUE INDEX "InquiryResourceSend_attemptKey_key" ON "InquiryResourceSend"("attemptKey");
CREATE INDEX "InquiryResourceSend_inquiryId_resourceVersionId_sentAt_idx"
  ON "InquiryResourceSend"("inquiryId", "resourceVersionId", "sentAt");
-- Only publication start changes; travel dates and publication end remain intact.
UPDATE "Resource" SET "shareFrom" = LEAST("shareFrom", DATE '2026-11-09')
WHERE "title" = 'CAD BLI 2027' AND "year" = 2027
  AND "type" = 'BROCHURE' AND "shareFrom" > DATE '2026-11-09';
