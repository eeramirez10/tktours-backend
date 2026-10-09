DO $$
DECLARE
  definition RECORD;
  target_id UUID;
  alias_row RECORD;
  known_aliases TEXT[] := ARRAY[
    'LANGUAGE_COURSE','LANGUAGE_COURSES','CURSO_DE_IDIOMAS','CURSOS_DE_IDIOMAS','CURSO_IDIOMAS','CURSOS_IDIOMAS','IDIOMAS',
    'CAMP','CAMPS','CAMPAMENTO','CAMPAMENTOS','CAMPAMENTOS_VIAJES','CAMPAMENTOS_Y_VIAJES',
    'SCHOOL_PROGRAM','CIRCUITOS_POR_EL_MUNDO','CIRCUITOS','TOURS','TOUR'
  ];
BEGIN
  FOR definition IN
    SELECT * FROM (VALUES
      ('LANGUAGE_COURSE', 'Cursos de idiomas', ARRAY['LANGUAGE_COURSE','LANGUAGE_COURSES','CURSO_DE_IDIOMAS','CURSOS_DE_IDIOMAS','CURSO_IDIOMAS','CURSOS_IDIOMAS','IDIOMAS']),
      ('CAMP', 'Campamentos / viajes', ARRAY['CAMP','CAMPS','CAMPAMENTO','CAMPAMENTOS','CAMPAMENTOS_VIAJES','CAMPAMENTOS_Y_VIAJES']),
      ('SCHOOL_PROGRAM', 'Circuitos por el mundo', ARRAY['SCHOOL_PROGRAM','CIRCUITOS_POR_EL_MUNDO','CIRCUITOS','TOURS','TOUR'])
    ) AS families(key, name, aliases)
  LOOP
    target_id := NULL;
    SELECT "id" INTO target_id FROM "ProductFamily"
    WHERE "key" = ANY(definition.aliases)
      OR ("key" <> ALL(known_aliases) AND trim(BOTH '_' FROM regexp_replace(translate(upper(trim("name")), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]+', '_', 'g')) = ANY(definition.aliases))
    ORDER BY ("key" = definition.key) DESC, "active" DESC, "createdAt", "id"
    LIMIT 1;

    IF target_id IS NULL THEN
      INSERT INTO "ProductFamily" ("id", "key", "name", "active", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), definition.key, definition.name, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING "id" INTO target_id;
    ELSE
      UPDATE "ProductFamily" SET "key" = definition.key, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = target_id;
    END IF;

    -- Preserve historical family rows and every linked program, PDF and inquiry.
    FOR alias_row IN
      SELECT "id" FROM "ProductFamily"
      WHERE "id" <> target_id AND (
        "key" = ANY(definition.aliases)
        OR ("key" <> ALL(known_aliases) AND trim(BOTH '_' FROM regexp_replace(translate(upper(trim("name")), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'), '[^A-Z0-9]+', '_', 'g')) = ANY(definition.aliases))
      )
    LOOP
      UPDATE "Program" SET "familyId" = target_id WHERE "familyId" = alias_row.id;
      UPDATE "Resource" SET "familyId" = target_id WHERE "familyId" = alias_row.id;
      UPDATE "Inquiry" SET "familyId" = target_id WHERE "familyId" = alias_row.id;
      UPDATE "ProductFamily" SET "active" = false, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = alias_row.id;
    END LOOP;
  END LOOP;
END $$;
