import { z } from 'zod';
import { createEndpoint, Config } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Check if the allocation for a week has been published by a guide',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string(),
    residencyId: z.string().optional(),
  }),
  outputSchema: z.object({
    published: z.boolean(),
    publishedAt: z.string().nullable(),
  }),
  execute: async ({ input }) => {
    const configKey = `service_published_${input.weekStartDate}${input.residencyId ? '_' + input.residencyId : ''}`;
    const record = await Config.findOne({ filters: { configKey }, fields: ['configValue', 'updatedAt'] });
    return {
      published: !!record,
      publishedAt: record?.configValue ?? null,
    };
  },
});
