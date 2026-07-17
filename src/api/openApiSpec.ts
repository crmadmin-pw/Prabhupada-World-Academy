/**
 * GET /api/openApiSpec
 * Returns the OpenAPI 3.0 specification for the Sadhana Status API.
 * Used by the Swagger UI docs page at /api-docs.
 */
import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';

const spec = {
  openapi: '3.0.0',
  info: {
    title: 'FOLK Sadhana Tracker API',
    version: '1.0.0',
    description:
      'REST API for the FOLK Sadhana Tracker — fetch sadhana submission status, ' +
      'filter by guide/residency/date, and power WhatsApp reminders and bulk automation.',
    contact: {
      name: 'FOLK Tech Team',
    },
  },
  servers: [
    {
      url: '{baseUrl}',
      description: 'Current deployment',
      variables: {
        baseUrl: {
          default: '',
          description: 'Base URL of the app (leave empty for relative calls)',
        },
      },
    },
  ],
  tags: [
    { name: 'Sadhana', description: 'Sadhana entry status and reporting' },
  ],
  paths: {
    '/api/sadhanaStatus': {
      get: {
        tags: ['Sadhana'],
        summary: 'Get Sadhana status for all users on a date',
        description:
          'Returns all users with their Sadhana submission status for the specified date. ' +
          'Users who have submitted will include full entry details. ' +
          'Users who have not submitted will have `sadhanaStatus: "missing"` and `entry: null`. ' +
          'Defaults to **today** if `date` is omitted.',
        operationId: 'getSadhanaStatus',
        parameters: [
          {
            name: 'date',
            in: 'query',
            required: false,
            description:
              'Target date in `yyyy-mm-dd` format. Defaults to today if omitted.',
            example: '2026-04-13',
            schema: { type: 'string', format: 'date', example: '2026-04-13' },
          },
          {
            name: 'guide',
            in: 'query',
            required: false,
            description: 'Filter by guide full name (partial match, case-insensitive).',
            example: 'Bhakti Das',
            schema: { type: 'string' },
          },
          {
            name: 'residency',
            in: 'query',
            required: false,
            description: 'Filter by residency name (partial match, case-insensitive).',
            example: 'Ashram A',
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            description: 'Filter by user account status.',
            schema: {
              type: 'string',
              enum: ['Active', 'Inactive', 'Pending Approval', 'Rejected'],
              example: 'Active',
            },
          },
          {
            name: 'ashrayLevel',
            in: 'query',
            required: false,
            description: 'Filter by ashray initiation level.',
            schema: {
              type: 'string',
              enum: [
                'Jigyasa',
                'Shraddhavan',
                'Sevak',
                'Sadhaka',
                'Upasaka',
                'Caranashraya',
                'Harinam Diksha',
              ],
              example: 'Sevak',
            },
          },
          {
            name: 'sadhanaStatus',
            in: 'query',
            required: false,
            description: 'Filter to only submitted or only missing entries.',
            schema: {
              type: 'string',
              enum: ['submitted', 'missing'],
              example: 'missing',
            },
          },
          {
            name: 'userId',
            in: 'query',
            required: false,
            description: 'Filter by exact User ID (e.g. U123).',
            example: 'U123',
            schema: { type: 'string' },
          },
          {
            name: 'phone',
            in: 'query',
            required: false,
            description: 'Filter by exact phone number.',
            example: '+919876543210',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Successful response with user sadhana status list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SadhanaStatusResponse' },
                examples: {
                  mixed: {
                    summary: 'Mixed submitted and missing',
                    value: {
                      date: '2026-04-13',
                      count: 2,
                      submittedCount: 1,
                      missingCount: 1,
                      data: [
                        {
                          id: 'rec-uuid-101',
                          fullName: 'John Doe',
                          userId: 'U123',
                          phone: '+919876543210',
                          email: 'john@example.com',
                          guide: 'Bhakti Das',
                          residency: 'Ashram A',
                          ashrayLevel: 'Sevak',
                          status: 'Active',
                          sadhanaStatus: 'submitted',
                          date: '2026-04-13',
                          entry: {
                            entryId: 'SE-501',
                            roundsChanted: 16,
                            totalScore: 85,
                            maxScore: 100,
                            scorePercent: 85,
                            templateMode: 'Resident',
                            flagSick: false,
                            flagOs: false,
                            sleepMinutes: 360,
                            japaFinishTime: '06:30',
                            sbPoints: 10,
                            spReadingMinutes: 20,
                            preachingMinutes: 30,
                            studyMinutes: 15,
                            nrChantingRounds: null,
                            nrReadingMinutes: null,
                            nrHearingMinutes: null,
                            fieldValuesJson: '{}',
                            submittedAt: '2026-04-13T06:30:00.000Z',
                          },
                        },
                        {
                          id: 'rec-uuid-102',
                          fullName: 'Jane Smith',
                          userId: 'U124',
                          phone: '+919123456780',
                          email: 'jane@example.com',
                          guide: 'Bhakti Das',
                          residency: 'Ashram A',
                          ashrayLevel: 'Sadhaka',
                          status: 'Active',
                          sadhanaStatus: 'missing',
                          date: '2026-04-13',
                          entry: null,
                        },
                      ],
                    },
                  },
                  missingOnly: {
                    summary: 'Only missing users (sadhanaStatus=missing)',
                    value: {
                      date: '2026-04-13',
                      count: 1,
                      submittedCount: 0,
                      missingCount: 1,
                      data: [
                        {
                          id: 'rec-uuid-102',
                          fullName: 'Jane Smith',
                          userId: 'U124',
                          phone: '+919123456780',
                          email: 'jane@example.com',
                          guide: 'Bhakti Das',
                          residency: 'Ashram A',
                          ashrayLevel: 'Sadhaka',
                          status: 'Active',
                          sadhanaStatus: 'missing',
                          date: '2026-04-13',
                          entry: null,
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Bad request — invalid date format or parameter',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: {
                  error: 'BAD_REQUEST',
                  message: 'Invalid date format. Use yyyy-mm-dd (e.g. 2026-04-13)',
                },
              },
            },
          },
          '500': {
            description: 'Internal server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: { error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      SadhanaEntry: {
        type: 'object',
        description: 'Sadhana entry details — present only when sadhanaStatus is "submitted"',
        properties: {
          entryId: { type: 'string', nullable: true, example: 'SE-501', description: 'Entry ID string' },
          roundsChanted: { type: 'number', nullable: true, example: 16, description: 'Japa rounds count' },
          totalScore: { type: 'number', nullable: true, example: 85 },
          maxScore: { type: 'number', nullable: true, example: 100 },
          scorePercent: { type: 'number', nullable: true, example: 85 },
          templateMode: {
            type: 'string',
            nullable: true,
            enum: ['Resident', 'Non-Resident', null],
            example: 'Resident',
          },
          flagSick: { type: 'boolean', nullable: true, example: false, description: 'Marked as sick' },
          flagOs: { type: 'boolean', nullable: true, example: false, description: 'Marked as outstation' },
          sleepMinutes: { type: 'number', nullable: true, example: 360, description: 'Sleep duration in minutes' },
          japaFinishTime: { type: 'string', nullable: true, example: '06:30', description: 'Time japa was finished' },
          sbPoints: { type: 'number', nullable: true, example: 10, description: 'Srimad Bhagavatam points' },
          spReadingMinutes: { type: 'number', nullable: true, example: 20, description: 'Srila Prabhupada reading minutes' },
          preachingMinutes: { type: 'number', nullable: true, example: 30 },
          studyMinutes: { type: 'number', nullable: true, example: 15 },
          nrChantingRounds: { type: 'number', nullable: true, example: null, description: 'Non-Resident chanting rounds' },
          nrReadingMinutes: { type: 'number', nullable: true, example: null },
          nrHearingMinutes: { type: 'number', nullable: true, example: null },
          fieldValuesJson: { type: 'string', nullable: true, example: '{}', description: 'Raw JSON of all dynamic field values' },
          submittedAt: { type: 'string', format: 'date-time', nullable: true, example: '2026-04-13T06:30:00.000Z' },
        },
      },
      UserSadhanaStatus: {
        type: 'object',
        required: ['id', 'sadhanaStatus', 'date'],
        properties: {
          id: { type: 'string', example: 'rec-uuid-101', description: 'Unique record UUID' },
          fullName: { type: 'string', nullable: true, example: 'John Doe' },
          userId: { type: 'string', nullable: true, example: 'U123' },
          phone: { type: 'string', nullable: true, example: '+919876543210' },
          email: { type: 'string', nullable: true, example: 'john@example.com' },
          guide: { type: 'string', nullable: true, example: 'Bhakti Das' },
          residency: { type: 'string', nullable: true, example: 'Ashram A' },
          ashrayLevel: {
            type: 'string',
            nullable: true,
            enum: ['Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha', null],
            example: 'Sevak',
          },
          status: {
            type: 'string',
            nullable: true,
            enum: ['Active', 'Inactive', 'Pending Approval', 'Rejected', null],
            example: 'Active',
          },
          sadhanaStatus: {
            type: 'string',
            enum: ['submitted', 'missing'],
            description: '"submitted" if an entry exists for the date, "missing" otherwise',
            example: 'submitted',
          },
          date: { type: 'string', format: 'date', example: '2026-04-13' },
          entry: {
            oneOf: [
              { $ref: '#/components/schemas/SadhanaEntry' },
              { type: 'null' },
            ],
            description: 'Entry details if submitted, null if missing',
          },
        },
      },
      SadhanaStatusResponse: {
        type: 'object',
        required: ['date', 'count', 'submittedCount', 'missingCount', 'data'],
        properties: {
          date: { type: 'string', format: 'date', example: '2026-04-13', description: 'The queried date' },
          count: { type: 'integer', example: 2, description: 'Total number of users returned (after all filters)' },
          submittedCount: { type: 'integer', example: 1, description: 'Number of users who submitted' },
          missingCount: { type: 'integer', example: 1, description: 'Number of users who did not submit' },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/UserSadhanaStatus' },
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'BAD_REQUEST' },
          message: { type: 'string', example: 'Invalid date format. Use yyyy-mm-dd' },
        },
      },
    },
  },
};

export default createEndpoint({
  description: 'Returns the OpenAPI 3.0 specification JSON for the Sadhana Status API',
  inputSchema: z.object({}),
  outputSchema: z.object({ spec: z.any() }),
  execute: async () => {
    return { spec };
  },
});
