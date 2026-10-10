import { z } from 'zod';
import { createEndpoint, AppError, BvGroups, BvGroupMembers, BvAttendance, Guides, Users } from '@/lib/backend-sdk';
import { getGuideIdsForResidencies } from '../lib/guideScope';
import { bvGroupFacilitatorAliases, bvUserAliases, isBvDepartmentAdmin, isBvSuperAdminUser, resolveBvDepartmentGroups, resolveBvScopedGroups, resolveBvUsersByAliases } from '../lib/bvGroupMemberScope';

export default createEndpoint({
  description: 'Get BV group stats for guide dashboard — member count, attendance rate per group',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional(), bvslMode: z.boolean().optional(), residencyIds: z.array(z.string()).optional(), segment: z.enum(['PW', 'FOLK']).optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isBvslMode = input.bvslMode === true;
    const isSuperGuide = context.user.role === 'Super Guide';

    const groupFilter: any = { isActive: true };
    let hierarchyGroups: any[] | null = null;

    if (input.guideId === 'ALL' && input.segment && isBvSuperAdminUser(context.user as any)) {
      if (!isBvSuperAdminUser(context.user as any)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Department-wide BV reports require super admin access' });
      }
      hierarchyGroups = (await resolveBvDepartmentGroups(input.segment)).map(group => group.record);
    } else if (isBvDepartmentAdmin(context.user as any) && !isBvSuperAdminUser(context.user as any)) {
      hierarchyGroups = (await resolveBvScopedGroups(context.user as any, { segment: input.segment }))
        .map(group => group.record);
    } else if (isBvslMode) {
      const rawSegment = String(context.user.segment || (context.user.isBvSupervisor ? 'FOLK' : '')).toUpperCase();
      const segment = rawSegment === 'FOLK' || rawSegment === 'PW' ? rawSegment as 'FOLK' | 'PW' : undefined;
      hierarchyGroups = (await resolveBvScopedGroups(context.user as any, { segment }))
        .map(group => group.record);
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
          const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] });
          if (directGuideRec) {
            guideDbId = directGuideRec.id;
          } else {
            const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] });
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
        const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] });
        if (directGuideRec) {
          guideDbId = directGuideRec.id;
        } else {
          const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] });
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

    let groups = hierarchyGroups ?? (await BvGroups.findAll({
      filters: groupFilter,
      fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId'],
      limit: 200,
    })).records;

    if (!isBvSuperAdminUser(context.user as any)) {
      const permitted = new Set((await resolveBvScopedGroups(context.user as any, { segment: input.segment })).map(g => g.id));
      groups = groups.filter(group => permitted.has(group.id));
    }
    if (groups.length === 0) return { groups: [] };

    const callerAliases = new Set(bvUserAliases(context.user as any));

    const facilitatorUsers = await resolveBvUsersByAliases(
      groups.flatMap((group: any) => bvGroupFacilitatorAliases(group)),
      ['id', 'userId', 'email', 'fullName', 'status', 'role', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator'],
    );
    const facilitatorByAlias = new Map<string, any>();
    facilitatorUsers.forEach((user: any) => {
      const normalizedRole = String(user.role || '').toUpperCase().replace(/[\s-]+/g, '_');
      const isActive = !user.status || String(user.status).toLowerCase() === 'active';
      const isFacilitator = !!(
        user.isBvFacilitator || user.isBvsl || user.isBvSubFacilitator ||
        ['RGF', 'RGSF', 'BVSL', 'FACILITATOR', 'SUB_FACILITATOR'].includes(normalizedRole)
      );
      if (!isActive || !isFacilitator) return;
      bvUserAliases(user).forEach(alias => facilitatorByAlias.set(alias, user));
    });

    const stats = await Promise.all(groups.map(async (g: any) => {
      const groupIds = [...new Set([g.id, g.groupId].filter(Boolean))];
      const [membersByGroup, membersByGroupId, attendanceByGroup, attendanceByGroupId] = await Promise.all([
        BvGroupMembers.findAll({ filters: { group: { in: groupIds } } as any, fields: ['id', 'user', 'userId', 'memberId'], limit: 500 }),
        BvGroupMembers.findAll({ filters: { groupId: { in: groupIds } } as any, fields: ['id', 'user', 'userId', 'memberId'], limit: 500 }),
        BvAttendance.findAll({ filters: { group: { in: groupIds } } as any, fields: ['id', 'user', 'present', 'attendanceDate'], limit: 2000 }),
        BvAttendance.findAll({ filters: { groupId: { in: groupIds } } as any, fields: ['id', 'user', 'present', 'attendanceDate'], limit: 2000 }),
      ]);
      const memberRows = [...membersByGroup.records, ...membersByGroupId.records]
        .filter((row, index, rows) => rows.findIndex(candidate => candidate.id === row.id) === index);
      const attendanceRows = [...attendanceByGroup.records, ...attendanceByGroupId.records]
        .filter((row, index, rows) => rows.findIndex(candidate => candidate.id === row.id) === index);

      const isCaller = (value: unknown) => {
        const values = (Array.isArray(value) ? value : [value])
          .flatMap(item => Array.isArray(item) ? item : String(item || '').split(','));
        return values.some(item => callerAliases.has(String(item || '').trim().toLowerCase()));
      };
      const memberRecords = isBvslMode
        ? memberRows.filter(member => !isCaller([member.user, member.userId, member.memberId]))
        : memberRows;
      const attRecords = isBvslMode
        ? attendanceRows.filter(attendance => !isCaller(attendance.user))
        : attendanceRows;
      const memberCount = new Set(memberRecords.map(member =>
        String(member.user || member.userId || member.memberId || member.id),
      )).size;

      // Count distinct session dates
      const distinctDates = new Set(attRecords.map((a: any) => a.attendanceDate).filter(Boolean));
      const totalSessions = distinctDates.size;

      const presentCount = attRecords.filter((a: any) => a.present).length;
      const totalPossible = memberCount * totalSessions;
      const facilitator = bvGroupFacilitatorAliases(g)
        .map(alias => facilitatorByAlias.get(alias))
        .find(Boolean);

      return {
        groupId: (g.groupId as string) || g.id,
        groupName: (g.groupName as string) || '',
        bvslName: facilitator?.fullName || null,
        hasValidFacilitator: !!facilitator,
        memberCount,
        totalSessions,
        presentCount,
        attendanceRate: totalPossible > 0 ? Math.round((presentCount / totalPossible) * 100) : 0,
      };
    }));

    // Suppress stale orphan records: an empty group with no resolvable active
    // RGF/RGSF is not a usable reading group. Legitimate vacant groups remain
    // visible when their facilitator assignment is valid.
    return {
      groups: stats
        .filter(group => group.hasValidFacilitator || group.memberCount > 0 || group.totalSessions > 0)
        .map(({ hasValidFacilitator: _hasValidFacilitator, ...group }) => group),
    };
  },
});
