import { z } from 'zod';
import { createEndpoint, ServicePreferences, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save service preferences for the current user',
  authenticated: true,
  inputSchema: z.object({
    preferences: z.array(z.object({ serviceId: z.string(), canDo: z.boolean(), reason: z.string().optional() })),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const userRec = await Users.findOne({ id: context.user.id, fields: ['id', 'userId'] });
    const userId = userRec?.userId || context.user.id;

    const existing = await ServicePreferences.findAll({ filters: { userId }, limit: 100 });
    const existingMap = new Map(existing.records.map(p => [p.serviceId || '', p]));

    for (const pref of input.preferences) {
      const ex = existingMap.get(pref.serviceId);
      if (ex) {
        await ServicePreferences.update({ id: ex.id, record: { canDo: pref.canDo, reason: pref.reason || '' } });
      } else {
        await ServicePreferences.create({ record: {
          userId, serviceId: pref.serviceId, canDo: pref.canDo, reason: pref.reason || '',
          updatedAt: new Date().toISOString(),
        }});
      }
    }
    return { success: true };
  },
});
