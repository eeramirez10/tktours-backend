-- Reconcile databases that received catalog/location changes before the migration
-- history was committed. Every operation is safe when the target already exists.

DO $$
BEGIN
  CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Resource" DROP CONSTRAINT IF EXISTS "Resource_createdById_fkey";
ALTER TABLE "Resource" DROP CONSTRAINT IF EXISTS "Resource_updatedById_fkey";
ALTER TABLE "ResourceVersion" DROP CONSTRAINT IF EXISTS "ResourceVersion_uploadedById_fkey";

ALTER TABLE "Inquiry" ADD COLUMN IF NOT EXISTS "locationId" UUID;
ALTER TABLE "Program" ADD COLUMN IF NOT EXISTS "locationId" UUID;
ALTER TABLE "ProgramRule" ADD COLUMN IF NOT EXISTS "weekOptions" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Resource" ADD COLUMN IF NOT EXISTS "locationId" UUID;

DO $$
BEGIN
  IF to_regclass('public."AdminUser"') IS NOT NULL
    AND to_regclass('public.users') IS NULL THEN
    ALTER TABLE "AdminUser" RENAME TO "users";
  END IF;
END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
      AND udt_name <> 'UserRole'
  ) THEN
    UPDATE "users"
    SET "role" = CASE WHEN UPPER("role") = 'ADMIN' THEN 'ADMIN' ELSE 'OPERATOR' END;

    ALTER TABLE "users"
      ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole",
      ALTER COLUMN "role" SET DEFAULT 'OPERATOR',
      ALTER COLUMN "role" SET NOT NULL;
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "ProgramLocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "countryId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "venueName" TEXT,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgramLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProgramPrice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "programId" UUID NOT NULL,
  "currency" TEXT NOT NULL,
  "amountFrom" DECIMAL(12,2),
  "amountTo" DECIMAL(12,2),
  "priceLabel" TEXT,
  "notes" TEXT,
  "year" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProgramPrice_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF to_regclass('public."AdminUser_email_key"') IS NOT NULL
    AND to_regclass('public.users_email_key') IS NULL THEN
    ALTER INDEX "AdminUser_email_key" RENAME TO "users_email_key";
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'AdminUser_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_pkey'
  ) THEN
    ALTER TABLE "users" RENAME CONSTRAINT "AdminUser_pkey" TO "users_pkey";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_active_role_idx" ON "users"("active", "role");
CREATE INDEX IF NOT EXISTS "ProgramLocation_countryId_active_idx" ON "ProgramLocation"("countryId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "ProgramLocation_countryId_slug_key" ON "ProgramLocation"("countryId", "slug");
CREATE INDEX IF NOT EXISTS "ProgramPrice_programId_active_idx" ON "ProgramPrice"("programId", "active");
CREATE INDEX IF NOT EXISTS "ProgramPrice_year_idx" ON "ProgramPrice"("year");
CREATE INDEX IF NOT EXISTS "Inquiry_locationId_idx" ON "Inquiry"("locationId");
CREATE INDEX IF NOT EXISTS "Program_locationId_idx" ON "Program"("locationId");
CREATE INDEX IF NOT EXISTS "Resource_locationId_idx" ON "Resource"("locationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Program_locationId_fkey') THEN
    ALTER TABLE "Program" ADD CONSTRAINT "Program_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProgramLocation_countryId_fkey') THEN
    ALTER TABLE "ProgramLocation" ADD CONSTRAINT "ProgramLocation_countryId_fkey"
      FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProgramPrice_programId_fkey') THEN
    ALTER TABLE "ProgramPrice" ADD CONSTRAINT "ProgramPrice_programId_fkey"
      FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Resource_locationId_fkey') THEN
    ALTER TABLE "Resource" ADD CONSTRAINT "Resource_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Resource_createdById_fkey') THEN
    ALTER TABLE "Resource" ADD CONSTRAINT "Resource_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Resource_updatedById_fkey') THEN
    ALTER TABLE "Resource" ADD CONSTRAINT "Resource_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ResourceVersion_uploadedById_fkey') THEN
    ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_uploadedById_fkey"
      FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Inquiry_locationId_fkey') THEN
    ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
