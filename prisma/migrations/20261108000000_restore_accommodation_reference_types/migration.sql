-- Reference values only: no program accommodation rules or availability are invented.
INSERT INTO "AccommodationType" ("id", "key", "name", "active", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'HOST_FAMILY', 'Familia anfitriona', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'UNIVERSITY_RESIDENCE', 'Residencia estudiantil', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SHARED_APARTMENT', 'Apartamento compartido', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
