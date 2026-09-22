ALTER TABLE "Resource"
ADD COLUMN "validFrom" DATE,
ADD COLUMN "validUntil" DATE,
ADD COLUMN "minAge" INTEGER,
ADD COLUMN "maxAge" INTEGER,
ADD COLUMN "priceFrom" DECIMAL(12, 2),
ADD COLUMN "priceCurrency" VARCHAR(3),
ADD COLUMN "priceUnit" VARCHAR(40),
ADD COLUMN "priceNotes" TEXT;

CREATE INDEX "Resource_validFrom_validUntil_idx" ON "Resource"("validFrom", "validUntil");
CREATE INDEX "Resource_minAge_maxAge_idx" ON "Resource"("minAge", "maxAge");

ALTER TABLE "Resource"
ADD CONSTRAINT "Resource_age_range_check"
CHECK (
  ("minAge" IS NULL OR "minAge" BETWEEN 0 AND 120)
  AND ("maxAge" IS NULL OR "maxAge" BETWEEN 0 AND 120)
  AND ("minAge" IS NULL OR "maxAge" IS NULL OR "minAge" <= "maxAge")
);

ALTER TABLE "Resource"
ADD CONSTRAINT "Resource_validity_range_check"
CHECK ("validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" <= "validUntil");

ALTER TABLE "Resource"
ADD CONSTRAINT "Resource_price_from_check"
CHECK ("priceFrom" IS NULL OR "priceFrom" >= 0);
