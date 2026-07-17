import { z } from 'zod';
import { createEndpoint, Config, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save TagMango configuration (Super Guide only)',
  authenticated: true,
  inputSchema: z.object({
    apiKey: z.string().optional(),
    apiUrl: z.string().optional(),
    courseConfig: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    const now = new Date().toISOString();
    const records: { configKey: string; configValue: string; updatedAt: string }[] = [];

    if (input.apiKey !== undefined) {
      records.push({ configKey: 'tagmango_api_key', configValue: input.apiKey, updatedAt: now });
    }
    if (input.apiUrl !== undefined) {
      records.push({ configKey: 'tagmango_api_url', configValue: input.apiUrl, updatedAt: now });
    }
    if (input.courseConfig !== undefined) {
      records.push({ configKey: 'course_config', configValue: JSON.stringify(input.courseConfig), updatedAt: now });
    }

    if (records.length > 0) {
      await Config.bulkCreate({ records, matchOn: ['configKey'] });
    }

    return { success: true };
  },
});
