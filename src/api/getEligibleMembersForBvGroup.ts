import { z } from 'zod';
import { createEndpoint, Users, Guides, BvGroups, BvGroupMembers, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get eligible members (active non-folk-residents) for adding to BV groups under this guide',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!['Guide', 'Super Guide'].includes(callerRole) && !isBvMentor) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides can access this' });
    }

    // Robust 3-step guide ID resolution (handles Users-table UUID, Guides-table UUID, or custom ID)
    let guideDbId: string | null = null;

    // Step 1: Try direct Guides-table lookup by UUID
    const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] }).catch(() => undefined);
    if (directGuideRec) {
      guideDbId = directGuideRec.id;
    } else {
      // Step 2: Try as a Users-table UUID — look up email, then find Guides record
      const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] }).catch(() => undefined);
      if (guideUser?.email) {
        const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] }).catch(() => undefined);
        if (guideByEmail) guideDbId = guideByEmail.id;
      }
      // Step 3: Fallback — legacy custom guideId string field
      if (!guideDbId) {
        const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] }).catch(() => undefined);
        if (guideByCustomId) guideDbId = guideByCustomId.id;
      }
    }

    if (!guideDbId) return { members: [] };

    // Fetch all BV groups under this guide to know who's already in a group
    const { records: groups } = await BvGroups.findAll({
      filters: { guide: guideDbId },
      fields: ['id', 'groupId', 'groupName'],
      limit: 200,
    });
    const groupDbIds = groups.map(g => g.id);

    // Build map: userDbId -> { groupId, groupName }
    const memberGroupMap: Record<string, { groupId: string; groupName: string }> = {};
    if (groupDbIds.length > 0) {
      const { records: allMembers } = await BvGroupMembers.findAll({
        filters: { group: { in: groupDbIds } as any },
        fields: ['user', 'group'],
        limit: 2000,
      });
      for (const m of allMembers) {
        const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
        const gid = (Array.isArray(m.group) ? m.group[0] : m.group) as string;
        if (uid && gid) {
          const grp = groups.find(g => g.id === gid);
          if (grp) memberGroupMap[uid] = { groupId: grp.groupId || grp.id, groupName: grp.groupName || '' };
        }
      }
    }

    const { records: users } = await Users.findAll({
      filters: { guide: guideDbId, status: 'Active' },
      fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'isBvsl'],
      limit: 1000,
    });

    // Include all active users with a userId (residents and non-residents can both be in BV groups)
    const eligible = users.filter(u => !!u.userId);

    return {
      members: eligible.map(u => ({
        userId: u.id,
        displayId: u.userId || u.id,
        fullName: u.fullName || '',
        phone: u.phone || '',
        ashrayLevel: u.ashrayLevel || null,
        isBvsl: u.isBvsl || false,
        existingGroup: memberGroupMap[u.id] || null,
      })),
    };
  },
});
