import { z } from 'zod';
import { createEndpoint, BvGroupMembers } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Leave a BV group',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional(), groupId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    const res = await BvGroupMembers.findAll({ filters: { user: uid, group: input.groupId }, limit: 5, fields: ['id'] });
    for (const m of res.records) await BvGroupMembers.delete({ id: m.id });
    return { success: true };
  },
});
