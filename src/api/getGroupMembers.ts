import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get members of a specific BV group with user details',
  authenticated: true,
  inputSchema: z.object({ groupDbId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Try by DB UUID first, then by custom groupId field
    let group = await BvGroups.findOne({ id: input.groupDbId, fields: ['id', 'groupId', 'groupName'] });
    if (!group) group = await BvGroups.findOne({ filters: { groupId: input.groupDbId }, fields: ['id', 'groupId', 'groupName'] });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });

    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { group: group.id },
      fields: ['id', 'user', 'role', 'joinedAt'],
      limit: 500,
    });

    const memberUserIds = memberships
      .map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string)
      .filter(Boolean);

    const userMap: Record<string, any> = {};
    if (memberUserIds.length > 0) {
      const { records: users } = await Users.findAll({
        filters: { id: { in: memberUserIds } as any },
        fields: ['id', 'fullName', 'phone', 'ashrayLevel', 'currentStreak'],
        limit: 500,
      });
      for (const u of users) userMap[u.id] = u;
    }

    return {
      groupId: group.groupId || group.id,
      groupDbId: group.id,
      groupName: group.groupName || '',
      members: memberships.map(m => {
        const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
        const u = userMap[uid] || {};
        return {
          membershipId: m.id,
          userId: uid,
          fullName: u.fullName || '',
          phone: u.phone || '',
          ashrayLevel: u.ashrayLevel || null,
          currentStreak: u.currentStreak ?? 0,
          role: m.role || 'Member',
          joinedAt: m.joinedAt || null,
        };
      }),
    };
  },
});
