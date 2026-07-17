import { z } from 'zod';
import { createEndpoint, Config, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Enable/disable cleanliness tracking for a folk center',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string(),
    enabled: z.boolean(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const role = context.user?.role;
    if (role !== 'Guide' && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    const key = `cleanliness_enabled_${input.residencyId}`;
    const existing = await Config.findOne({ filters: { configKey: key } });

    if (existing) {
      await Config.update({ id: existing.id, record: { configValue: String(input.enabled) } });
    } else {
      await Config.create({ record: { configKey: key, configValue: String(input.enabled) } });
    }

    return { success: true };
  },
});
