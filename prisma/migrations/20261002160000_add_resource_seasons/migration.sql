ALTER TABLE "Resource" ADD COLUMN "seasonKeys" "SeasonKey"[] NOT NULL DEFAULT ARRAY[]::"SeasonKey"[];

-- Only a single configured camp season is safe to carry over automatically.
-- Multi-season programs need each existing brochure classified by an operator.
UPDATE "Resource" AS resource
SET "seasonKeys" = seasons.keys
FROM (
  SELECT "programId", ARRAY_AGG(DISTINCT "seasonKey") AS keys
  FROM "ProgramStartWindow"
  WHERE "active" = true AND "seasonKey" IN ('SUMMER', 'EASTER', 'WINTER')
  GROUP BY "programId"
  HAVING COUNT(DISTINCT "seasonKey") = 1
) AS seasons, "ProductFamily" AS family
WHERE resource."programId" = seasons."programId"
  AND resource."familyId" = family."id"
  AND family."key" = 'CAMP'
  AND resource."type" = 'BROCHURE';
