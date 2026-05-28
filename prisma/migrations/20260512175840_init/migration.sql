-- Enable native UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "ProductFamilyKey" AS ENUM ('CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM');

-- CreateEnum
CREATE TYPE "QuoteMode" AS ENUM ('WEEK', 'SEMESTER', 'YEAR', 'MINI_STAY');

-- CreateEnum
CREATE TYPE "SeasonKey" AS ENUM ('SUMMER', 'WINTER', 'EASTER', 'YEAR_ROUND', 'JANUARY', 'SEPTEMBER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AccommodationKey" AS ENUM ('HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('QUOTE', 'INFO', 'BROCHURE', 'MANUAL', 'PRESENTATION');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('S3', 'R2', 'SUPABASE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ResourceSourceType" AS ENUM ('UPLOAD', 'EXTERNAL_LINK');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'WEB', 'EMAIL');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConversationStage" AS ENUM ('START', 'QUALIFY_AGE', 'QUALIFY_COUNTRY', 'QUALIFY_PROGRAM', 'QUALIFY_ACCOMMODATION', 'QUALIFY_DATES', 'RECOMMEND', 'SEND_RESOURCE', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('OPEN', 'QUALIFYING', 'READY_TO_RECOMMEND', 'RECOMMENDED', 'WAITING_HUMAN', 'CLOSED');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFamily" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" "ProductFamilyKey" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "countryId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "programId" UUID NOT NULL,
    "quoteMode" "QuoteMode" NOT NULL,
    "minWeeks" INTEGER,
    "maxWeeks" INTEGER,
    "allowsMiniStay" BOOLEAN NOT NULL DEFAULT false,
    "miniStayGroupOnly" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccommodationType" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" "AccommodationKey" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccommodationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramAccommodationRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "programId" UUID NOT NULL,
    "accommodationTypeId" UUID NOT NULL,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramAccommodationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramStartWindow" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "programId" UUID NOT NULL,
    "seasonKey" "SeasonKey" NOT NULL,
    "startMonth" INTEGER,
    "endMonth" INTEGER,
    "startDay" INTEGER,
    "endDay" INTEGER,
    "startsEveryMonday" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramStartWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "countryId" UUID NOT NULL,
    "familyId" UUID,
    "programId" UUID,
    "type" "ResourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "month" INTEGER,
    "year" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resourceId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL,
    "sourceType" "ResourceSourceType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "uploadedById" UUID,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceExtraction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "resourceVersionId" UUID NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "rawText" TEXT,
    "cleanText" TEXT,
    "summary" TEXT,
    "detectedLanguage" TEXT,
    "errorMessage" TEXT,
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceChunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "extractionId" UUID NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "pageFrom" INTEGER,
    "pageTo" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "waId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contactId" UUID,
    "channel" "Channel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "currentStage" "ConversationStage" NOT NULL DEFAULT 'START',
    "contextJson" JSONB,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "text" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "providerMessageId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" UUID NOT NULL,
    "contactId" UUID,
    "countryId" UUID,
    "familyId" UUID,
    "programId" UUID,
    "studentAge" INTEGER,
    "cityOfResidence" TEXT,
    "preferredStartMonth" INTEGER,
    "preferredStartYear" INTEGER,
    "accommodationTypeId" UUID,
    "weeks" INTEGER,
    "status" "InquiryStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "qualificationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryRecommendation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiryId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "resourceId" UUID,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryResourceSend" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inquiryId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "resourceVersionId" UUID,
    "sentReason" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryResourceSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFamily_key_key" ON "ProductFamily"("key");

-- CreateIndex
CREATE INDEX "Program_familyId_idx" ON "Program"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_countryId_slug_key" ON "Program"("countryId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramRule_programId_key" ON "ProgramRule"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "AccommodationType_key_key" ON "AccommodationType"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramAccommodationRule_programId_accommodationTypeId_key" ON "ProgramAccommodationRule"("programId", "accommodationTypeId");

-- CreateIndex
CREATE INDEX "ProgramStartWindow_programId_seasonKey_idx" ON "ProgramStartWindow"("programId", "seasonKey");

-- CreateIndex
CREATE INDEX "Resource_countryId_type_active_idx" ON "Resource"("countryId", "type", "active");

-- CreateIndex
CREATE INDEX "Resource_familyId_idx" ON "Resource"("familyId");

-- CreateIndex
CREATE INDEX "Resource_programId_idx" ON "Resource"("programId");

-- CreateIndex
CREATE INDEX "Resource_month_year_idx" ON "Resource"("month", "year");

-- CreateIndex
CREATE INDEX "ResourceVersion_resourceId_isCurrent_idx" ON "ResourceVersion"("resourceId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceVersion_resourceId_versionNumber_key" ON "ResourceVersion"("resourceId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceExtraction_resourceVersionId_key" ON "ResourceExtraction"("resourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceChunk_extractionId_chunkIndex_key" ON "ResourceChunk"("extractionId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_waId_key" ON "Contact"("waId");

-- CreateIndex
CREATE INDEX "Conversation_contactId_status_idx" ON "Conversation"("contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Message_providerMessageId_key" ON "Message"("providerMessageId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Inquiry_conversationId_status_idx" ON "Inquiry"("conversationId", "status");

-- CreateIndex
CREATE INDEX "Inquiry_countryId_familyId_studentAge_idx" ON "Inquiry"("countryId", "familyId", "studentAge");

-- CreateIndex
CREATE INDEX "InquiryRecommendation_inquiryId_createdAt_idx" ON "InquiryRecommendation"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryResourceSend_inquiryId_sentAt_idx" ON "InquiryResourceSend"("inquiryId", "sentAt");

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramRule" ADD CONSTRAINT "ProgramRule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramAccommodationRule" ADD CONSTRAINT "ProgramAccommodationRule_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramAccommodationRule" ADD CONSTRAINT "ProgramAccommodationRule_accommodationTypeId_fkey" FOREIGN KEY ("accommodationTypeId") REFERENCES "AccommodationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramStartWindow" ADD CONSTRAINT "ProgramStartWindow_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceExtraction" ADD CONSTRAINT "ResourceExtraction_resourceVersionId_fkey" FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceChunk" ADD CONSTRAINT "ResourceChunk_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "ResourceExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_accommodationTypeId_fkey" FOREIGN KEY ("accommodationTypeId") REFERENCES "AccommodationType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryRecommendation" ADD CONSTRAINT "InquiryRecommendation_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryRecommendation" ADD CONSTRAINT "InquiryRecommendation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryRecommendation" ADD CONSTRAINT "InquiryRecommendation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryResourceSend" ADD CONSTRAINT "InquiryResourceSend_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryResourceSend" ADD CONSTRAINT "InquiryResourceSend_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryResourceSend" ADD CONSTRAINT "InquiryResourceSend_resourceVersionId_fkey" FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
