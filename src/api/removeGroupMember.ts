import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroups, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Remove a member from a BV group',
  authenticated: true,
  inputSchema: z.object({
    membershipId: z.string().optional(),
    groupId: z.string().optional(),
    userId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    let membershipDbId = input.membershipId;

    if (!membershipDbId && input.groupId && input.userId) {
      // Find user by custom userId field
      const user = await Users.findOne({ filters: { userId: input.userId }, fields: ['id'] });

      // Find group — first try by DB record ID (UUID), then by custom groupId field
      let group = await BvGroups.findOne({ filters: { id: input.groupId }, fields: ['id'] });
      if (!group) {
        group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id'] });
      }

      if (group && user) {
        const membership = await BvGroupMembers.findOne({ filters: { group: group.id, user: user.id } });
        if (membership) membershipDbId = membership.id;
      }
    }

    if (!membershipDbId) throw new ZiteError({ code: 'NOT_FOUND', message: 'Membership not found' });

    await BvGroupMembers.delete({ id: membershipDbId });

    return { success: true, message: 'Member removed from group' };
  },
});
