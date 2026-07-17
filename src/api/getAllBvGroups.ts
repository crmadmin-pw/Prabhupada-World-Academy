import { z } from 'zod';
import { createEndpoint, Users, BvGroups, BvGroupMembers, Guides } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get all BV groups available to a user (filtered by their guide)',
  inputSchema: z.object({
    userId: z.string(), // custom userId field
  }),
  outputSchema: z.object({
    groups: z.array(z.object({
      groupId: z.string(),
      groupName: z.string(),
      description: z.string(),
      memberCount: z.number(),
      joinToken: z.string().nullable(),
      bvslName: z.string().nullable(),
      guideName: z.string().nullable(),
    })),
    error: z.string().nullable(),
  }),
  execute: async ({ input }) => {
    if (!input.userId) return { groups: [], error: null };

    // BUG-5 FIX: Resolve custom userId to DB record to get their guide link
    const userRecord = await Users.findOne({ filters: { userId: input.userId }, fields: ['id', 'guide'] });
    if (!userRecord) return { groups: [], error: null };

    const guideId = Array.isArray(userRecord.guide) ? userRecord.guide[0] : userRecord.guide;
    if (!guideId) return { groups: [], error: null };

    // BUG-10 FIX: filter by guide field directly (no extra join needed)
    const { records: groupRecords } = await BvGroups.findAll({
      filters: { guide: guideId, isActive: true },
      limit: 200,
    });

    if (groupRecords.length === 0) return { groups: [], error: null };

    const guideRecord = await Guides.findOne({ id: guideId, fields: ['id', 'fullName'] });

    const groups = await Promise.all(groupRecords.map(async (g) => {
      const bvslDbId = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader as string | undefined;

      const [membersRes, bvslRecord] = await Promise.all([
        BvGroupMembers.findAll({ filters: { group: g.id }, limit: 500, fields: ['id'] }),
        bvslDbId
          ? Users.findOne({ id: bvslDbId, fields: ['id', 'fullName'] })
          : Promise.resolve(undefined),
      ]);

      return {
        groupId: g.groupId || g.id,
        groupName: g.groupName || '',
        description: g.description || '',
        memberCount: membersRes.records.length,
        joinToken: g.joinToken || null,
        bvslName: (bvslRecord as any)?.fullName || null,
        guideName: (guideRecord as any)?.fullName || null,
      };
    }));

    return { groups, error: null };
  },
});
