import { PrismaClient, ProductFamilyKey, QuoteMode, SeasonKey, AccommodationKey } from '@prisma/client';

const prisma = new PrismaClient();

type ProductFamilyKeyValue = (typeof ProductFamilyKey)[keyof typeof ProductFamilyKey];
type QuoteModeValue = (typeof QuoteMode)[keyof typeof QuoteMode];
type SeasonKeyValue = (typeof SeasonKey)[keyof typeof SeasonKey];
type AccommodationKeyValue = (typeof AccommodationKey)[keyof typeof AccommodationKey];

type ProgramSeed = {
  slug: string;
  name: string;
  description: string;
  familyKey: ProductFamilyKeyValue;
  minAge: number | null;
  maxAge: number | null;
  rule: {
    quoteMode: QuoteModeValue;
    minWeeks: number | null;
    maxWeeks: number | null;
    weekOptions: number[];
    allowsMiniStay: boolean;
    miniStayGroupOnly: boolean;
    notes: string | null;
  };
  accommodations: Array<{
    key: AccommodationKeyValue;
    minAge: number | null;
    maxAge: number | null;
    notes: string | null;
  }>;
  startWindows: Array<{
    seasonKey: SeasonKeyValue;
    startMonth: number | null;
    endMonth: number | null;
    startDay: number | null;
    endDay: number | null;
    startsEveryMonday: boolean;
    notes: string | null;
  }>;
};

const productFamilies = [
  { key: ProductFamilyKey.CAMP, name: 'Camp', active: true },
  { key: ProductFamilyKey.LANGUAGE_COURSE, name: 'Language course', active: true },
  { key: ProductFamilyKey.SCHOOL_PROGRAM, name: 'Circuitos por el mundo', active: true },
] as const;

const accommodationTypes = [
  { key: AccommodationKey.HOST_FAMILY, name: 'Host family', active: true },
  { key: AccommodationKey.UNIVERSITY_RESIDENCE, name: 'University residence', active: true },
  { key: AccommodationKey.SHARED_APARTMENT, name: 'Shared apartment', active: true },
] as const;

const focusCountries = [
  { code: 'CA', name: 'Canada', active: true },
  { code: 'US', name: 'United States', active: true },
  { code: 'GB', name: 'England', active: true },
  { code: 'IT', name: 'Italy', active: true },
  { code: 'FR', name: 'France', active: true },
  { code: 'IE', name: 'Ireland', active: true },
  { code: 'MX', name: 'Mexico', active: true },
  { code: 'EUROPE', name: 'Europa', active: true },
  { code: 'SOUTH_AMERICA', name: 'Sudamérica', active: true },
  { code: 'ASIA', name: 'Países Asiáticos', active: true },
  { code: 'OTHER_DESTINATIONS', name: 'Otros destinos', active: true },
] as const;

const canadaPrograms: ProgramSeed[] = [
  {
    slug: 'canada-summer-camp',
    name: 'Canada Summer Camp',
    description: 'Programa base de campamento de verano en Canadá con cotización semanal.',
    familyKey: ProductFamilyKey.CAMP,
    minAge: 7,
    maxAge: 18,
    rule: {
      quoteMode: QuoteMode.WEEK,
      minWeeks: 1,
      maxWeeks: null,
      weekOptions: [2, 3, 4, 5, 6, 7, 8],
      allowsMiniStay: false,
      miniStayGroupOnly: false,
      notes: 'Temporada principal de finales de junio a mediados de agosto.',
    },
    accommodations: [
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: 7, maxAge: null, notes: null },
      { key: AccommodationKey.HOST_FAMILY, minAge: 13, maxAge: 18, notes: 'Disponible solo desde 13 años.' },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.SUMMER,
        startMonth: 6,
        endMonth: 8,
        startDay: 20,
        endDay: 15,
        startsEveryMonday: false,
        notes: 'Ventana aproximada de verano.',
      },
    ],
  },
  {
    slug: 'canada-winter-camp',
    name: 'Canada Winter Camp',
    description: 'Programa base de campamento de invierno en Canadá con cotización semanal.',
    familyKey: ProductFamilyKey.CAMP,
    minAge: 7,
    maxAge: 18,
    rule: {
      quoteMode: QuoteMode.WEEK,
      minWeeks: 1,
      maxWeeks: null,
      weekOptions: [2, 3, 4, 5, 6, 7, 8],
      allowsMiniStay: false,
      miniStayGroupOnly: false,
      notes: 'Temporada de diciembre a finales de enero.',
    },
    accommodations: [
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: 7, maxAge: null, notes: null },
      { key: AccommodationKey.HOST_FAMILY, minAge: 13, maxAge: 18, notes: 'Disponible solo desde 13 años.' },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.WINTER,
        startMonth: 12,
        endMonth: 1,
        startDay: 1,
        endDay: 31,
        startsEveryMonday: false,
        notes: 'Ventana aproximada de invierno.',
      },
    ],
  },
  {
    slug: 'canada-easter-camp',
    name: 'Canada Easter Camp',
    description: 'Programa base de campamento de Easter en Canadá con cotización semanal.',
    familyKey: ProductFamilyKey.CAMP,
    minAge: 7,
    maxAge: 18,
    rule: {
      quoteMode: QuoteMode.WEEK,
      minWeeks: 1,
      maxWeeks: 2,
      weekOptions: [1, 2],
      allowsMiniStay: false,
      miniStayGroupOnly: false,
      notes: 'Ventana corta de dos semanas durante Easter.',
    },
    accommodations: [
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: 7, maxAge: null, notes: null },
      { key: AccommodationKey.HOST_FAMILY, minAge: 13, maxAge: 18, notes: 'Disponible solo desde 13 años.' },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.EASTER,
        startMonth: null,
        endMonth: null,
        startDay: null,
        endDay: null,
        startsEveryMonday: false,
        notes: 'Ventana variable de dos semanas según calendario de Easter.',
      },
    ],
  },
  {
    slug: 'canada-language-course',
    name: 'Canada Language Course',
    description: 'Programa base de curso de idiomas en Canadá con inicio semanal.',
    familyKey: ProductFamilyKey.LANGUAGE_COURSE,
    minAge: 15,
    maxAge: null,
    rule: {
      quoteMode: QuoteMode.WEEK,
      minWeeks: 1,
      maxWeeks: null,
      weekOptions: [2, 4, 8, 12, 24],
      allowsMiniStay: false,
      miniStayGroupOnly: false,
      notes: 'Disponible todo el año con inicios cada lunes.',
    },
    accommodations: [
      { key: AccommodationKey.HOST_FAMILY, minAge: 15, maxAge: null, notes: null },
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: 15, maxAge: null, notes: null },
      { key: AccommodationKey.SHARED_APARTMENT, minAge: 18, maxAge: null, notes: 'Recomendado para estudiantes adultos.' },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.YEAR_ROUND,
        startMonth: null,
        endMonth: null,
        startDay: null,
        endDay: null,
        startsEveryMonday: true,
        notes: 'Inicios semanales durante todo el año.',
      },
    ],
  },
  {
    slug: 'canada-school-semester',
    name: 'Canada School Semester',
    description: 'Programa base de semestre escolar en Canadá.',
    familyKey: ProductFamilyKey.SCHOOL_PROGRAM,
    minAge: null,
    maxAge: null,
    rule: {
      quoteMode: QuoteMode.SEMESTER,
      minWeeks: null,
      maxWeeks: null,
      weekOptions: [],
      allowsMiniStay: false,
      miniStayGroupOnly: false,
      notes: 'Inicio regular en septiembre o enero.',
    },
    accommodations: [
      { key: AccommodationKey.HOST_FAMILY, minAge: null, maxAge: null, notes: null },
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: null, maxAge: null, notes: null },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.SEPTEMBER,
        startMonth: 9,
        endMonth: 9,
        startDay: 1,
        endDay: 30,
        startsEveryMonday: false,
        notes: 'Inicio de otoño.',
      },
      {
        seasonKey: SeasonKey.JANUARY,
        startMonth: 1,
        endMonth: 1,
        startDay: 1,
        endDay: 31,
        startsEveryMonday: false,
        notes: 'Inicio de invierno.',
      },
    ],
  },
  {
    slug: 'canada-school-year',
    name: 'Canada School Year',
    description: 'Programa base de año escolar en Canadá.',
    familyKey: ProductFamilyKey.SCHOOL_PROGRAM,
    minAge: null,
    maxAge: null,
    rule: {
      quoteMode: QuoteMode.YEAR,
      minWeeks: null,
      maxWeeks: null,
      weekOptions: [],
      allowsMiniStay: false,
      miniStayGroupOnly: false,
      notes: 'Programa de ciclo escolar anual.',
    },
    accommodations: [
      { key: AccommodationKey.HOST_FAMILY, minAge: null, maxAge: null, notes: null },
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: null, maxAge: null, notes: null },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.SEPTEMBER,
        startMonth: 9,
        endMonth: 9,
        startDay: 1,
        endDay: 30,
        startsEveryMonday: false,
        notes: 'Inicio principal de ciclo escolar.',
      },
    ],
  },
  {
    slug: 'canada-school-mini-stay-group',
    name: 'Canada School Mini Stay Group',
    description: 'Programa base de mini stay escolar para grupos en Canadá.',
    familyKey: ProductFamilyKey.SCHOOL_PROGRAM,
    minAge: null,
    maxAge: null,
    rule: {
      quoteMode: QuoteMode.MINI_STAY,
      minWeeks: null,
      maxWeeks: null,
      weekOptions: [2, 3, 4],
      allowsMiniStay: true,
      miniStayGroupOnly: true,
      notes: 'Mini stay de 1 a 3 meses exclusivo para grupos.',
    },
    accommodations: [
      { key: AccommodationKey.HOST_FAMILY, minAge: null, maxAge: null, notes: null },
      { key: AccommodationKey.UNIVERSITY_RESIDENCE, minAge: null, maxAge: null, notes: null },
    ],
    startWindows: [
      {
        seasonKey: SeasonKey.CUSTOM,
        startMonth: null,
        endMonth: null,
        startDay: null,
        endDay: null,
        startsEveryMonday: false,
        notes: 'Ventana flexible según grupo y disponibilidad.',
      },
    ],
  },
];

type FocusCountry = (typeof focusCountries)[number];

function stripCanadaPrefix(slug: string): string {
  if (slug.startsWith('canada-')) {
    return slug.slice('canada-'.length);
  }
  return slug;
}

function replaceCanadaLabel(text: string, countryName: string): string {
  return text.replace(/\bCanada\b/g, countryName).replace(/\bCanadá\b/g, countryName);
}

function buildProgramsForCountry(country: FocusCountry): ProgramSeed[] {
  if (country.code === 'CA') {
    return canadaPrograms;
  }

  return canadaPrograms.map((program) => ({
    ...program,
    slug: `${country.code.toLowerCase()}-${stripCanadaPrefix(program.slug)}`,
    name: replaceCanadaLabel(program.name, country.name),
    description: replaceCanadaLabel(program.description, country.name),
  }));
}

async function seedFamilies() {
  for (const family of productFamilies) {
    await prisma.productFamily.upsert({
      where: { key: family.key },
      update: { name: family.name, active: family.active },
      create: family,
    });
  }
}

async function seedAccommodations() {
  for (const accommodation of accommodationTypes) {
    await prisma.accommodationType.upsert({
      where: { key: accommodation.key },
      update: { name: accommodation.name, active: accommodation.active },
      create: accommodation,
    });
  }
}

async function seedFocusCountries() {
  for (const country of focusCountries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: {
        name: country.name,
        active: country.active,
      },
      create: country,
    });
  }
}

async function seedProgramsForCountry(countrySeed: FocusCountry) {
  const country = await prisma.country.upsert({
    where: { code: countrySeed.code },
    update: { name: countrySeed.name, active: countrySeed.active },
    create: { code: countrySeed.code, name: countrySeed.name, active: countrySeed.active },
  });

  const families = await prisma.productFamily.findMany({
    where: { key: { in: productFamilies.map((family) => family.key) } },
  });

  const familyByKey = new Map(families.map((family) => [family.key, family]));

  const accommodations = await prisma.accommodationType.findMany({
    where: { key: { in: accommodationTypes.map((accommodation) => accommodation.key) } },
  });

  const accommodationByKey = new Map(accommodations.map((accommodation) => [accommodation.key, accommodation]));

  for (const program of buildProgramsForCountry(countrySeed)) {
    const family = familyByKey.get(program.familyKey);

    if (!family) {
      throw new Error(`Missing family for key ${program.familyKey}`);
    }

    const savedProgram = await prisma.program.upsert({
      where: {
        countryId_slug: {
          countryId: country.id,
          slug: program.slug,
        },
      },
      update: {
        familyId: family.id,
        name: program.name,
        description: program.description,
        minAge: program.minAge,
        maxAge: program.maxAge,
        active: true,
      },
      create: {
        countryId: country.id,
        familyId: family.id,
        slug: program.slug,
        name: program.name,
        description: program.description,
        minAge: program.minAge,
        maxAge: program.maxAge,
        active: true,
      },
    });

    await prisma.programRule.upsert({
      where: { programId: savedProgram.id },
      update: {
        quoteMode: program.rule.quoteMode,
        minWeeks: program.rule.minWeeks,
        maxWeeks: program.rule.maxWeeks,
        weekOptions: program.rule.weekOptions,
        allowsMiniStay: program.rule.allowsMiniStay,
        miniStayGroupOnly: program.rule.miniStayGroupOnly,
        notes: program.rule.notes,
        active: true,
      },
      create: {
        programId: savedProgram.id,
        quoteMode: program.rule.quoteMode,
        minWeeks: program.rule.minWeeks,
        maxWeeks: program.rule.maxWeeks,
        weekOptions: program.rule.weekOptions,
        allowsMiniStay: program.rule.allowsMiniStay,
        miniStayGroupOnly: program.rule.miniStayGroupOnly,
        notes: program.rule.notes,
        active: true,
      },
    });

    await prisma.programAccommodationRule.deleteMany({
      where: { programId: savedProgram.id },
    });

    for (const accommodation of program.accommodations) {
      const accommodationType = accommodationByKey.get(accommodation.key);

      if (!accommodationType) {
        throw new Error(`Missing accommodation for key ${accommodation.key}`);
      }

      await prisma.programAccommodationRule.create({
        data: {
          programId: savedProgram.id,
          accommodationTypeId: accommodationType.id,
          minAge: accommodation.minAge,
          maxAge: accommodation.maxAge,
          notes: accommodation.notes,
          active: true,
        },
      });
    }

    await prisma.programStartWindow.deleteMany({
      where: { programId: savedProgram.id },
    });

    for (const startWindow of program.startWindows) {
      await prisma.programStartWindow.create({
        data: {
          programId: savedProgram.id,
          seasonKey: startWindow.seasonKey,
          startMonth: startWindow.startMonth,
          endMonth: startWindow.endMonth,
          startDay: startWindow.startDay,
          endDay: startWindow.endDay,
          startsEveryMonday: startWindow.startsEveryMonday,
          notes: startWindow.notes,
          active: true,
        },
      });
    }
  }
}

async function main() {
  await seedFamilies();
  await seedAccommodations();
  await seedFocusCountries();
  for (const country of focusCountries) {
    await seedProgramsForCountry(country);
  }

  console.log('Seed complete: focus countries + base catalog programs are ready.');
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
