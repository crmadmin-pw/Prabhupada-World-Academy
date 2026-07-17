import { z } from 'zod';
import { createEndpoint, Config } from 'zite-integrations-backend-sdk';

const KEY_PREFIX = 'service_published_';

export default createEndpoint({
  description: 'Mark a weekly allocation as published and store publication timestamp so residents see a notification on next visit',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string(), // yyyy-MM-dd
    residencyId: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    publishedAt: z.string(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role ?? '';
    const isServiceAllocator = context.user.isServiceAllocator === true;
    if (!['Guide', 'Super Guide', 'BVSL'].includes(role) && !isServiceAllocator) {
      throw new Error('Only guides or service allocators can publish allocations');
    }
    const configKey = `${KEY_PREFIX}${input.weekStartDate}${input.residencyId ? '_' + input.residencyId : ''}`;
    const publishedAt = new Date().toISOString();

    const existing = await Config.findOne({ filters: { configKey } });
    if (existing) {
      await Config.update({ id: existing.id, record: { configValue: publishedAt, updatedAt: publishedAt } });
    } else {
      await Config.create({ record: { configKey, configValue: publishedAt, updatedAt: publishedAt } });
    }

    return { success: true, publishedAt };
  },
});
