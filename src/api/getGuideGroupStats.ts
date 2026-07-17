import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Guides, Users } from 'zite-integrations-backend-sdk';
import { getGuideIdsForResidencies } from '../lib/guideScope';

export default createEndpoint({
  description: 'Get BV group stats for guide dashboard — member count, attendance rate per group',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional(), bvslMode: z.boolean().optional(), residencyIds: z.array(z.string()).optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isBvslMode = input.bvslMode === true;
    const isSuperGuide = context.user.role === 'Super Guide';

    const groupFilter: any = { isActive: true };

    if (isBvslMode) {
      const userRecord = await Users.findOne({ filters: { email: context.user.email }, fields: ['id'] });
      if (!userRecord) return { groups: [] };
      groupFilter.bvslLeader = userRecord.id;
    } else {
      const isBvMentor = !!(context.user as any).isBvMentor;
      let guideDbId: string | null = null;
      if (!isSuperGuide) {
        // Try email-based lookup first
        const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'fullName'] });
        if (guide) {
          guideDbId = (guide as any).id;
        } else if ((isBvMentor || true) && input.guideId) {
          // Robust 3-step resolution for BV Mentors (and any caller providing guideId)
          const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] }).catch(() => undefined);
          if (directGuideRec) {
            guideDbId = directGuideRec.id;
          } else {
            const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] }).catch(() => undefined);
            if (guideUser?.email) {
              const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
              if (guideByEmail) guideDbId = guideByEmail.id;
            }
            if (!guideDbId) {
              const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] });
              if (guideByCustomId) guideDbId = guideByCustomId.id;
            }
          }
          if (!guideDbId) return { groups: [] };
        } else {
          return { groups: [] };
        }
      } else if (input.guideId) {
        // Super Guide viewing a specific guide — resolve that guide's ID
        const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] }).catch(() => undefined);
        if (directGuideRec) {
          guideDbId = directGuideRec.id;
        } else {
          const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] }).catch(() => undefined);
          if (guideUser?.email) {
            const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
            if (guideByEmail) guideDbId = guideByEmail.id;
          }
          if (!guideDbId) {
            const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] });
            if (guideByCustomId) guideDbId = guideByCustomId.id;
          }
        }
      }
      if (input.residencyIds && input.residencyIds.length > 0) {
        const allGuideIds = await getGuideIdsForResidencies(input.residencyIds);
        if (allGuideIds.length > 0) {
          groupFilter.guide = { in: allGuideIds };
        } else if (guideDbId) {
          groupFilter.guide = guideDbId;
        }
      } else if (guideDbId) {
        groupFilter.guide = guideDbId;
      }
    }

    const { records: groups } = await BvGroups.findAll({
      filters: groupFilter,
      fields: ['id', 'groupId', 'groupName', 'bvslLeader'],
      limit: 200,
    });

    if (groups.length === 0) return { groups: [] };

    const bvslIds = [...new Set(groups.map((g: any) => Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader).filter(Boolean))] as string[];
    const bvslMap = new Map<string, string>();
    if (bvslIds.length > 0) {
      const { records: bvslUsers } = await Users.findAll({ filters: { id: { in: bvslIds } }, fields: ['id', 'fullName'], limit: 200 });
      bvslUsers.forEach((u: any) => bvslMap.set(u.id, (u.fullName as string) || ''));
    }

    const stats = await Promise.all(groups.map(async (g: any) => {
      const [membersRes, attRes] = await Promise.all([
        BvGroupMembers.findAll({ filters: { group: g.id }, fields: ['id'], limit: 500 }),
        // Query attendance directly by group (new approach)
        BvAttendance.findAll({
          filters: { group: g.id },
          fields: ['id', 'present', 'attendanceDate'],
          limit: 2000,
        }),
      ]);

      const attRecords = attRes.records;
      const memberCount = membersRes.records.length;

      // Count distinct session dates
      const distinctDates = new Set(attRecords.map((a: any) => a.attendanceDate).filter(Boolean));
      const totalSessions = distinctDates.size;

      const presentCount = attRecords.filter((a: any) => a.present).length;
      const totalPossible = memberCount * totalSessions;
      const bvslId = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader as string;

      return {
        groupId: (g.groupId as string) || g.id,
        groupName: (g.groupName as string) || '',
        bvslName: bvslId ? (bvslMap.get(bvslId) || null) : null,
        memberCount,
        totalSessions,
        presentCount,
        attendanceRate: totalPossible > 0 ? Math.round((presentCount / totalPossible) * 100) : 0,
      };
    }));

    return { groups: stats };
  },
});
