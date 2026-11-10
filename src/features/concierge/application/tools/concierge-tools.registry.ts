export const conciergeTools = [
  {
    type: 'function',
    name: 'list_available_course_types',
    description: 'List only supported course families that currently have active programs or deliverable, valid brochures in active destinations. Use before displaying the greeting menu or offering a course type. A family row alone does not confirm an available offer; programCount does not promise a PDF.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { countryCode: { type: 'string' } }, required: [],
    },
  },
  {
    type: 'function',
    name: 'get_contact_info',
    description:
      'Get saved customer/contact information for the current WhatsApp contact or conversation. Use it to decide whether name/email already exist before asking again.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        contactId: { type: 'string' },
        conversationId: { type: 'string' },
        waId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'detect_user_intent',
    description:
      'Detect user intent from latest message and recent context (greeting, menu option, quote request, available countries question, etc).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        latestMessage: { type: 'string' },
        recentMessages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND', 'SYSTEM'] },
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
      },
      required: ['latestMessage'],
    },
  },
  {
    type: 'function',
    name: 'find_matching_programs',
    description: 'Find valid programs using catalog rules like country, age, accommodation, start month, and weeks.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        studentAge: { type: 'number' },
        accommodationKey: {
          type: 'string',
          enum: ['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT'],
        },
        preferredStartMonth: { type: 'number' },
        weeks: { type: 'number' },
        search: { type: 'string' },
      },
      required: ['countryCode'],
    },
  },
  {
    type: 'function',
    name: 'list_available_countries',
    description: 'List destination countries available in the active catalog.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        activeOnly: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_destination_overview',
    description:
      'Consult current catalog programs and deliverable PDF resources grouped by destination. Use for questions about available countries, cities, programs, brochures, summaries, ages, dates or prices. Filter by the selected family and country when known. A country without a brochure is identified explicitly.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        familyKey: { type: 'string', enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] },
        countryCode: { type: 'string' },
        studentAge: { type: 'number' },
        targetMonth: { type: 'integer', minimum: 1, maximum: 12 },
        targetYear: { type: 'integer' },
        targetDate: { type: 'string', description: 'ISO date YYYY-MM-DD for the intended start.' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_available_programs',
    description: 'List active programs available in the catalog, optionally filtered by country and family.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string' },
        locationSlug: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        activeOnly: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_available_locations',
    description:
      'List active destination cities/locations available in the catalog, optionally filtered by country and program family.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        activeOnly: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_available_resources',
    description:
      'List only currently authorized, non-expired PDF brochures or manuals compatible with destination, age and requested month/year. Camp brochures missing edition or sharing validity are excluded. Future trip editions may be shared once their commercial sharing validity begins.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        locationSlug: { type: 'string' },
        programSlug: { type: 'string' },
        type: {
          type: 'string',
          enum: ['BROCHURE', 'MANUAL'],
        },
        studentAge: { type: 'number' },
        targetMonth: { type: 'integer', minimum: 1, maximum: 12 },
        targetYear: { type: 'integer' },
        targetDate: { type: 'string', description: 'Requested travel month/year as YYYY-MM-01. Matches any travel dates overlapping that month. Commercial sharing validity is always evaluated against today, independently.' },
        activeOnly: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'search_resource_content',
    description:
      'Read administrator-confirmed resource form fields for factual answers about a brochure or manual. Never read or reinterpret raw PDF text during chat. Always use the active inquiryId and the customer question. Results are restricted to resources compatible with that inquiry.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inquiryId: { type: 'string' },
        query: { type: 'string' },
        resourceId: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 8 },
      },
      required: ['inquiryId', 'query'],
    },
  },
  {
    type: 'function',
    name: 'list_available_accommodations',
    description:
      'List active accommodation options from catalog rules, optionally filtered by country, family, and student age.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        studentAge: { type: 'number' },
        activeOnly: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'list_weeks_options',
    description: 'Obtiene la duración confirmada por recurso; nunca hereda reglas de semanas del programa.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        countryCode: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        programSlug: { type: 'string' },
        locationSlug: { type: 'string' },
        studentAge: { type: 'number' },
        targetMonth: { type: 'integer', minimum: 1, maximum: 12 },
        targetYear: { type: 'integer' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'extract_inquiry_fields',
    description:
      'Use AI to extract normalized inquiry/contact fields from latest user message and context, including relative dates.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        latestMessage: { type: 'string' },
        previousAssistantMessage: { type: 'string' },
        expectedField: {
          type: 'string',
          enum: [
            'country',
            'studentAge',
            'residenceCountry',
            'cityOfResidence',
            'tripDays',
            'family',
            'program',
            'accommodation',
            'preferredStartMonth',
            'preferredStartYear',
            'weeks',
            'contactName',
            'contactEmail',
          ],
        },
        recentMessages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND', 'SYSTEM'] },
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
        inquirySnapshot: {
          type: 'object',
          additionalProperties: false,
          properties: {
            countryCode: { type: 'string' },
            studentAge: { type: 'number' },
            residenceCountry: { type: 'string' },
            cityOfResidence: { type: 'string' },
            tripDays: { type: 'number' },
            familyKey: { type: 'string', enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] },
            accommodationKey: {
              type: 'string',
              enum: ['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT'],
            },
            preferredStartMonth: { type: 'number' },
            preferredStartYear: { type: 'number' },
            preferredStartStatus: { type: 'string', enum: ['DEFINED', 'UNDECIDED'] },
            weeks: { type: 'number' },
            weeksStatus: { type: 'string', enum: ['DEFINED', 'UNDECIDED'] },
          },
          required: [],
        },
        nowIso: { type: 'string' },
      },
      required: ['latestMessage'],
    },
  },
  {
    type: 'function',
    name: 'evaluate_policy_signals',
    description:
      'Use AI to evaluate policy signals from conversation context (menu shown, accommodation-options request, negative program answer, handoff step, country mention).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        latestMessage: { type: 'string' },
        previousAssistantMessage: { type: 'string' },
        recentMessages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              direction: { type: 'string', enum: ['INBOUND', 'OUTBOUND', 'SYSTEM'] },
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
        inquirySnapshot: {
          type: 'object',
          additionalProperties: false,
          properties: {
            countryCode: { type: 'string' },
            familyKey: { type: 'string', enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'] },
            studentAge: { type: 'number' },
            contactLastName: { type: 'string' },
            contactEmail: { type: 'string' },
          },
          required: [],
        },
      },
      required: ['latestMessage'],
    },
  },
  {
    type: 'function',
    name: 'get_program_detail',
    description: 'Get detailed info for one program by slug, including resources and rules.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        slug: { type: 'string' },
      },
      required: ['slug'],
    },
  },
  {
    type: 'function',
    name: 'update_inquiry',
    description: 'Update the active inquiry with newly discovered qualification fields.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inquiryId: { type: 'string' },
        countryCode: { type: 'string' },
        familyKey: {
          type: 'string',
          enum: ['CAMP', 'LANGUAGE_COURSE', 'SCHOOL_PROGRAM'],
        },
        programSlug: { type: 'string' },
        locationSlug: { type: 'string' },
        studentAge: { type: 'number' },
        cityOfResidence: { type: 'string' },
        preferredStartMonth: { type: 'number' },
        preferredStartYear: { type: 'number' },
        accommodationKey: {
          type: 'string',
          enum: ['HOST_FAMILY', 'UNIVERSITY_RESIDENCE', 'SHARED_APARTMENT'],
        },
        weeks: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['inquiryId'],
    },
  },
] as const;
