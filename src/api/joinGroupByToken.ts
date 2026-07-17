import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Join a BV group using an invite token',
  authenticated: true,
  inputSchema: z.object({
    token: z.string(),
    userId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const group = await BvGroups.findOne({ filters: { joinToken: input.token, isActive: true } });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Invalid or expired invite link' });

    const existing = await BvGroupMembers.findOne({ filters: { user: context.user.id, group: group.id } });
    if (existing) return { success: true, groupName: group.groupName, message: 'You are already a member of this group' };

    await BvGroupMembers.create({
      record: { user: context.user.id, group: group.id, role: 'Member', joinedAt: new Date().toISOString() },
    });

    return { success: true, groupName: group.groupName, message: `Successfully joined ${group.groupName}!` };
  },
});
