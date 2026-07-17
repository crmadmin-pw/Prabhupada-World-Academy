import { z } from 'zod';
import { createEndpoint, ServicePreferences, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get service preferences for the current user',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // ServicePreferences uses plain string userId field, not linked record
    const userRec = await Users.findOne({ id: context.user.id, fields: ['id', 'userId'] });
    const userId = userRec?.userId || context.user.id;

    const { records } = await ServicePreferences.findAll({ filters: { userId }, limit: 100 });
    return {
      preferences: records.map(p => ({
        id: p.id,
        serviceId: p.serviceId || '',
        canDo: p.canDo ?? true,
        reason: p.reason || '',
        updatedAt: p.updatedAt || '',
      })),
    };
  },
});
