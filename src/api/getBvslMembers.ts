import { z } from 'zod';
import { createEndpoint, Users, Guides, BvGroups, BvGroupMembers, FolkResidencies } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get members for BVSL groups',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string().optional(),
    bvslId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    let guideDbId: string | null = null;

    // If bvslId given, find groups led by that BVSL user
    if (input.bvslId) {
      const bvslUser = await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id'] });
      if (bvslUser) {
        const { records: bvslGroups } = await BvGroups.findAll({
          filters: { bvslLeader: bvslUser.id, isActive: true },
          fields: ['id', 'groupId', 'groupName'],
          limit: 50,
        });

        if (bvslGroups.length === 0) return { members: [] };

        const groupIds = bvslGroups.map((g: any) => g.id);
        const groupMap: Record<string, string> = {};
        const groupIdMap: Record<string, string> = {};
        bvslGroups.forEach((g: any) => {
          groupMap[g.id] = (g.groupName as string) || '';
          groupIdMap[g.id] = (g.groupId as string) || g.id;
        });

        const { records: memberships } = await BvGroupMembers.findAll({
          filters: { group: { in: groupIds } },
          fields: ['id', 'user', 'group'],
          limit: 500,
        });

        const userIds = [...new Set(memberships.map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user).filter(Boolean))] as string[];
        const { records: memberUsers } = userIds.length > 0
          ? await Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved'], limit: 500 })
          : { records: [] };

        const userMap: Record<string, any> = {};
        memberUsers.forEach((u: any) => { userMap[u.id] = u; });

        // Get residency names
        const residencyIds = [...new Set(memberUsers.map((u: any) => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean))] as string[];
        const residencyMap: Record<string, string> = {};
        if (residencyIds.length > 0) {
          const { records: residencies } = await FolkResidencies.findAll({ filters: { id: { in: residencyIds } }, fields: ['id', 'residencyName'], limit: 100 });
          residencies.forEach((r: any) => { residencyMap[r.id] = (r.residencyName as string) || ''; });
        }

        return {
          members: memberships.map((m: any) => {
            const uid = Array.isArray(m.user) ? m.user[0] : m.user as string;
            const gid = Array.isArray(m.group) ? m.group[0] : m.group as string;
            const u = userMap[uid] as any;
            const residencyId = Array.isArray(u?.residency) ? u.residency[0] : u?.residency;
            return {
              userId: u?.userId || uid || '',
              fullName: (u?.fullName as string) || '',
              phone: u?.phone || '',
              ashrayLevel: (u?.ashrayLevel as string) || null,
              email: (u?.email as string) || '',
              groupName: groupMap[gid] || '',
              groupId: groupIdMap[gid] || '',
              isResident: !!(u?.residencyApproved && residencyId),
              residencyName: residencyId ? (residencyMap[residencyId] || null) : null,
            };
          }),
        };
      }
    }

    // Fallback: get by guide
    if (!isSuperGuide) {
      const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
      if (!guide) return { members: [] };
      guideDbId = (guide as any).id;
    }

    const filter: any = { isBvsl: true, status: 'Active' };
    if (guideDbId) filter.guide = guideDbId;

    const { records } = await Users.findAll({
      filters: filter,
      fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email'],
      limit: 500,
    });

    return {
      members: records.map((u: any) => ({
        userId: (u.userId as string) || u.id,
        fullName: (u.fullName as string) || '',
        phone: u.phone || '',
        ashrayLevel: (u.ashrayLevel as string) || null,
        email: (u.email as string) || '',
        groupName: '',
        isResident: false,
        residencyName: null,
      })),
    };
  },
});
