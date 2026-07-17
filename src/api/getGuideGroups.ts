import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Guides, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get BV groups for the current guide with member details',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    let guideDbId: string | null = null;

    if (!isSuperGuide) {
      const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
      if (!guide) return { groups: [], availableUsers: [] };
      guideDbId = (guide as any).id;
    }

    const filter: any = { isActive: true };
    if (guideDbId) filter.guide = guideDbId;

    const [{ records: groups }, { records: activeUsers }] = await Promise.all([
      BvGroups.findAll({ filters: filter, fields: ['id', 'groupId', 'groupName', 'description'], limit: 200 }),
      Users.findAll({
        filters: { status: 'Active', ...(guideDbId ? { guide: guideDbId } : {}) },
        fields: ['id', 'userId', 'fullName', 'status'],
        limit: 500,
      }),
    ]);

    const groupsWithDetails = await Promise.all(groups.map(async (g: any) => {
      const { records: memberships } = await BvGroupMembers.findAll({
        filters: { group: g.id },
        fields: ['id', 'user'],
        limit: 500,
      });

      const memberUserIds = memberships.map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user).filter(Boolean) as string[];
      const memberUsers = memberUserIds.length > 0
        ? await Users.findAll({ filters: { id: { in: memberUserIds } }, fields: ['id', 'userId', 'fullName'], limit: 500 })
        : { records: [] };

      return {
        groupId: (g.groupId as string) || g.id,
        groupName: (g.groupName as string) || '',
        description: (g.description as string) || '',
        memberCount: memberships.length,
        avgScore7d: 0,
        submissionRate7d: 0,
        members: memberUsers.records.map((u: any) => ({
          userId: (u.userId as string) || u.id,
          fullName: (u.fullName as string) || '',
        })),
      };
    }));

    return {
      groups: groupsWithDetails,
      availableUsers: activeUsers.map((u: any) => ({
        userId: (u.userId as string) || u.id,
        fullName: (u.fullName as string) || '',
        status: (u.status as string) || 'Active',
      })),
    };
  },
});
