import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Add a member to a BV group',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string(),
    userId: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id', 'groupName'] });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });

    const user = await Users.findOne({ filters: { userId: input.userId }, fields: ['id'] });
    if (!user) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const existing = await BvGroupMembers.findOne({ filters: { user: user.id, group: group.id } });
    if (existing) return { success: true, message: 'User is already a member of this group' };

    await BvGroupMembers.create({
      record: {
        user: user.id,
        group: group.id,
        role: 'Member',
        joinedAt: new Date().toISOString(),
      },
    });

    return { success: true, message: `Added to ${group.groupName}` };
  },
});
