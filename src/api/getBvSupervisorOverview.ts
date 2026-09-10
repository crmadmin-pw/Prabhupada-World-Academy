import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvMemberRegistrations, BvAttendance, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds } from '../lib/hierarchyUtils';
import { getTodayIST } from '../lib/streakUtils';

function normalizedRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(normalizedRefs);
  return value == null
    ? []
    : String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

export default createEndpoint({
  description: 'Get overview stats and group list for BV Supervisor dashboard',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({}),
  outputSchema: z.object({
    rgfCount: z.number(),
    groupCount: z.number(),
    totalMembers: z.number(),
    pendingRegistrations: z.number(),
    groups: z.array(z.object({
      id: z.string(),
      groupId: z.string(),
      groupName: z.string(),
      description: z.string(),
      bvslId: z.string(),
      bvslName: z.string(),
      guideName: z.string().nullable(),
      meetingTime: z.string().nullable().optional(),
      memberCount: z.number(),
      totalSessions: z.number(),
      presentToday: z.number(),
      joinToken: z.string().nullable(),
      segment: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
    })),
  }),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isAuthorized = context.user.role === 'SUPER_GUIDE' ||
      context.user.role === 'GUIDE' ||
      context.user.isBvAdmin ||
      context.user.isBvSuperAdmin ||
      context.user.isBvSupervisor ||
      context.user.isBvMentor;

    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Supervisor access required' });
    }

    const scopedUserIds = await getScopedHierarchyUserIds(context.user);

    // This endpoint powers the FOLK Supervisor dashboard. Older supervisor
    // profiles can predate the segment field; treating those as PW hides all
    // correctly linked FOLK RGFs and groups.
    const userSegment = String(context.user.segment || 'FOLK').toUpperCase();
    const { records: rawGroups } = await BvGroups.findAll({ filters: { isActive: true }, limit: 500 });
    let groups = rawGroups.filter((g: any) => String(g.segment || 'PW').toUpperCase() === userSegment);

    // Apply hierarchy scoping if not Super Admin
    if (scopedUserIds !== null) {
      groups = groups.filter((g: any) => {
        const ownerRefs = normalizedRefs([g.bvslId, g.bvslLeader]);
        if (ownerRefs.length > 0) return ownerRefs.some(owner => scopedUserIds.has(owner));

        // Legacy groups may have no facilitator owner and only a guide link.
        return normalizedRefs(g.guide).some(guide => scopedUserIds.has(guide));
      });
    }

    const { records: rawMembers } = await BvGroupMembers.findAll({ limit: 2000 });
    const groupByAlias = new Map<string, any>();
    groups.forEach((group: any) => {
      normalizedRefs([group.id, group.groupId]).forEach(alias => groupByAlias.set(alias, group));
    });
    const membershipsByGroup = new Map<string, Map<string, any>>();
    rawMembers.forEach((membership: any) => {
      const matchedGroup = normalizedRefs([membership.group, membership.groupId])
        .map(alias => groupByAlias.get(alias))
        .find(Boolean);
      if (!matchedGroup) return;
      const groupKey = String(matchedGroup.id || matchedGroup.groupId);
      if (!membershipsByGroup.has(groupKey)) membershipsByGroup.set(groupKey, new Map());
      const membershipKey = String(normalizedRefs([membership.user, membership.userId, membership.memberId])[0] || membership.id || '');
      if (membershipKey) membershipsByGroup.get(groupKey)!.set(membershipKey, membership);
    });
    const members = [...membershipsByGroup.values()].flatMap(groupMembers => [...groupMembers.values()]);

    const { records: rawPending } = await BvMemberRegistrations.findAll({ filters: { status: 'Pending Approval' }, limit: 500 });
    const pending = scopedUserIds === null
      ? rawPending
      : rawPending.filter((p: any) => {
          const uId = String(p.userId || p.id || '').toLowerCase();
          return uId && scopedUserIds.has(uId);
        });

    // One group can carry both the current facilitator ID and a legacy leader
    // alias for the same person. Count one canonical facilitator per group
    // instead of treating those two references as two different RGFs.
    const uniqueRgfs = new Set(groups.map((g: any) =>
      normalizedRefs(g.bvslId)[0] || normalizedRefs(g.bvslLeader)[0] || ''
    ).filter(Boolean));

    const today = getTodayIST();
    const mappedGroups = await Promise.all(groups.map(async (g: any) => {
      const groupRefs = [...new Set([g.id, g.groupId].filter(Boolean))];
      const { records: attendance } = await BvAttendance.findAll({
        filters: { group: groupRefs.length > 1 ? { in: groupRefs } : groupRefs[0] } as any,
        fields: ['id', 'attendanceDate', 'present'],
        limit: 5000,
      }).catch(() => ({ records: [] }));
      const sessionDates = new Set(attendance.map((entry: any) => String(entry.attendanceDate || '').slice(0, 10)).filter(Boolean));
      const groupKey = String(g.id || g.groupId);

      return {
        id: g.id || g.groupId,
        groupId: g.groupId || g.id,
        groupName: g.groupName || 'Unnamed Group',
        description: g.description || '',
        bvslId: g.bvslId || g.bvslLeader || '',
        bvslName: g.bvslName || 'Unassigned',
        guideName: g.guideName || null,
        meetingTime: g.meetingTime || g.preferredTimeSlot || null,
        memberCount: membershipsByGroup.get(groupKey)?.size || 0,
        totalSessions: sessionDates.size,
        presentToday: attendance.filter((entry: any) =>
          String(entry.attendanceDate || '').slice(0, 10) === today && entry.present === true
        ).length,
        joinToken: g.joinToken || null,
        segment: g.segment || userSegment,
        isActive: g.isActive ?? true,
      };
    }));

    return {
      rgfCount: uniqueRgfs.size,
      groupCount: groups.length,
      totalMembers: members.length,
      pendingRegistrations: pending.length,
      groups: mappedGroups,
    };
  },
});
