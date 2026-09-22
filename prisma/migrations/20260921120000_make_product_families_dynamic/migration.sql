ALTER TABLE "ProductFamily"
ALTER COLUMN "key" TYPE VARCHAR(64)
USING "key"::text;

DROP TYPE "ProductFamilyKey";
