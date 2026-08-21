-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR');

-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "ResourceVersion" DROP CONSTRAINT "ResourceVersion_uploadedById_fkey";

-- AlterTable
ALTER TABLE "Inquiry" ADD COLUMN     "locationId" UUID;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "locationId" UUID;

-- AlterTable
ALTER TABLE "ProgramRule" ADD COLUMN     "weekOptions" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "locationId" UUID;

-- Rename the legacy table instead of recreating it so existing administrators are preserved.
ALTER TABLE "AdminUser" RENAME TO "users";

-- Normalize legacy text roles before changing the column to the enum used by authentication.
UPDATE "users"
SET "role" = CASE WHEN UPPER("role") = 'ADMIN' THEN 'ADMIN' ELSE 'OPERATOR' END;

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "lastLoginAt" TIMESTAMP(3);

ALTER TABLE "users"
    ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole",
    ALTER COLUMN "role" SET DEFAULT 'OPERATOR',
    ALTER COLUMN "role" SET NOT NULL,
    ALTER COLUMN "passwordHash" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ProgramLocation" (
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

-- CreateTable
CREATE TABLE "ProgramPrice" (
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

-- RenameIndex
ALTER INDEX "AdminUser_email_key" RENAME TO "users_email_key";

-- RenameConstraint
ALTER TABLE "users" RENAME CONSTRAINT "AdminUser_pkey" TO "users_pkey";

-- CreateIndex
CREATE INDEX "users_active_role_idx" ON "users"("active", "role");

-- CreateIndex
CREATE INDEX "ProgramLocation_countryId_active_idx" ON "ProgramLocation"("countryId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramLocation_countryId_slug_key" ON "ProgramLocation"("countryId", "slug");

-- CreateIndex
CREATE INDEX "ProgramPrice_programId_active_idx" ON "ProgramPrice"("programId", "active");

-- CreateIndex
CREATE INDEX "ProgramPrice_year_idx" ON "ProgramPrice"("year");

-- CreateIndex
CREATE INDEX "Inquiry_locationId_idx" ON "Inquiry"("locationId");

-- CreateIndex
CREATE INDEX "Program_locationId_idx" ON "Program"("locationId");

-- CreateIndex
CREATE INDEX "Resource_locationId_idx" ON "Resource"("locationId");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramLocation" ADD CONSTRAINT "ProgramLocation_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramPrice" ADD CONSTRAINT "ProgramPrice_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
