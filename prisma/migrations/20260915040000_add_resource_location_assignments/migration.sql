CREATE TABLE "ResourceLocationAssignment" (
    "resourceId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceLocationAssignment_pkey" PRIMARY KEY ("resourceId", "locationId")
);

CREATE INDEX "ResourceLocationAssignment_locationId_idx"
ON "ResourceLocationAssignment"("locationId");

ALTER TABLE "ResourceLocationAssignment"
ADD CONSTRAINT "ResourceLocationAssignment_resourceId_fkey"
FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResourceLocationAssignment"
ADD CONSTRAINT "ResourceLocationAssignment_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "ProgramLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ResourceLocationAssignment" ("resourceId", "locationId")
SELECT "id", "locationId"
FROM "Resource"
WHERE "locationId" IS NOT NULL
ON CONFLICT DO NOTHING;
