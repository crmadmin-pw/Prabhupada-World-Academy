import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Bulk add multiple users to a BV group (guide-driven, by DB record IDs)',
  authenticated: true,
  inputSchema: z.object({
    groupDbId: z.string(),
    userIds: z.array(z.string()),
  }),
  outputSchema: z.object({ added: z.number(), alreadyMembers: z.number() }),
  execute: async ({ input, context }) => {
    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!['Guide', 'Super Guide'].includes(callerRole) && !isBvMentor) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides or BV Mentors can bulk add members' });
    }

    // Try by DB UUID first, then by custom groupId field
    let group = await BvGroups.findOne({ id: input.groupDbId, fields: ['id'] });
    if (!group) group = await BvGroups.findOne({ filters: { groupId: input.groupDbId }, fields: ['id'] });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });
    const resolvedGroupId = group.id;

    const { records: existing } = await BvGroupMembers.findAll({
      filters: { group: resolvedGroupId },
      fields: ['user'],
      limit: 2000,
    });
    const existingSet = new Set(
      existing.map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string).filter(Boolean)
    );

    const toAdd = input.userIds.filter(id => !existingSet.has(id));

    for (let i = 0; i < toAdd.length; i += 100) {
      const batch = toAdd.slice(i, i + 100);
      await BvGroupMembers.bulkCreate({
        records: batch.map(userId => ({
          user: userId,
          group: resolvedGroupId,
          role: 'Member',
          joinedAt: new Date().toISOString(),
        })),
      });
    }

    return { added: toAdd.length, alreadyMembers: input.userIds.length - toAdd.length };
  },
});
