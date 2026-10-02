ALTER TABLE "Resource"
ADD COLUMN "shareFrom" DATE,
ADD COLUMN "shareUntil" DATE;

ALTER TABLE "Resource" ADD CONSTRAINT "Resource_sharing_dates_check"
CHECK ("shareFrom" IS NULL OR "shareUntil" IS NULL OR "shareFrom" <= "shareUntil");

CREATE INDEX "Resource_shareFrom_shareUntil_idx" ON "Resource"("shareFrom", "shareUntil");
