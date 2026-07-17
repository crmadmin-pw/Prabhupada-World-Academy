import { z } from 'zod';
import { createEndpoint, BvGroups, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Soft delete (deactivate) a BV group',
  authenticated: true,
  inputSchema: z.object({ groupId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!['Guide', 'Super Guide'].includes(callerRole) && !isBvMentor) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides or BV Mentors can delete groups' });
    }

    let group = await BvGroups.findOne({ id: input.groupId, fields: ['id'] }).catch(() => undefined);
    if (!group) group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id'] });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });

    await BvGroups.update({
      id: group.id,
      record: { isActive: false },
    });

    return { success: true };
  },
});
