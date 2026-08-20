export const conciergeTools = [
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
      'List active PDFs/resources such as brochures, presentations or manuals for a country, city/location, program family, or program.',
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
          enum: ['QUOTE', 'INFO', 'BROCHURE', 'MANUAL', 'PRESENTATION'],
        },
        activeOnly: { type: 'boolean' },
      },
      required: [],
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
    description: 'List allowed study duration options in weeks from catalog rules.',
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
