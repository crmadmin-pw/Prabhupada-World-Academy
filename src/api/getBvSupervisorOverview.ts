import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvMemberRegistrations, BvAttendance, Users, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds } from '../lib/hierarchyUtils';
import { getTodayIST } from '../lib/streakUtils';

function normalizedRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(normalizedRefs);
  return value == null
    ? []
    : String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function departmentOf(value: unknown): 'PW' | 'FOLK' | null {
  const segment = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (segment === 'FOLK') return 'FOLK';
  if (segment === 'PW' || segment === 'PRABHUPADAWORLD') return 'PW';
  return null;
}

/** Missing segment stays FOLK for older FOLK supervisors. An explicit Prabhupada
 * World account is PW even when the segment field was never stored. */
function supervisorDepartment(user: any): 'PW' | 'FOLK' {
  return departmentOf(user?.segment) || (user?.isPrabhupadaWorldUser ? 'PW' : 'FOLK');
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

    const callerFields = ['id', 'userId', 'email', 'fullName', 'segment', 'isPrabhupadaWorldUser', 'isBvFacilitator', 'isBvsl', 'bvGroupId', 'bvGroupName'];
    const storedCaller = await Users.findOne({ id: context.user.id, fields: callerFields })
      || (context.user.userId ? (await Users.findAll({ filters: { userId: context.user.userId }, fields: callerFields, limit: 1 })).records[0] : null)
      || (context.user.email ? (await Users.findAll({ filters: { email: context.user.email }, fields: callerFields, limit: 5 })).records
        .find((row: any) => normalizedRefs(row.email).includes(String(context.user.email).toLowerCase())) : null);
    const caller = { ...context.user, ...storedCaller };
    const scopedUserIds = await getScopedHierarchyUserIds(context.user);
    const userSegment = supervisorDepartment(caller);
    const callerAliases = new Set(normalizedRefs([
      caller.id, caller.userId, caller.uid, caller.email, caller.fullName,
    ]));
    const callerIsRgf = !!(caller.isBvFacilitator || caller.isBvsl);
    const assignedGroupRefs = new Set(normalizedRefs(caller.bvGroupId));

    // Groups without an isActive flag are still running. A Firestore equality
    // filter on true would hide them from the supervisor who facilitates them.
    const { records: rawGroups } = await BvGroups.findAll({ limit: 1000 });
    let groups = rawGroups.filter((g: any) => g.isActive !== false).filter((g: any) => {
      const ownerRefs = normalizedRefs([g.bvslId, g.bvslLeader, g.bvslName]);
      const ledByCaller = ownerRefs.some(owner => callerAliases.has(owner));
      const assignedToCaller = callerIsRgf && (
        normalizedRefs([g.id, g.groupId]).some(ref => assignedGroupRefs.has(ref))
      );
      const groupSegment = departmentOf(g.segment) || (ledByCaller || assignedToCaller ? userSegment : 'PW');
      // A group this supervisor personally facilitates belongs on their
      // dashboard even when its stored segment is missing or was saved earlier
      // under the other department.
      if (!ledByCaller && !assignedToCaller && groupSegment !== userSegment) return false;
      if (ledByCaller || assignedToCaller) return true;
      if (scopedUserIds === null) return true;
      if (ownerRefs.length > 0) return ownerRefs.some(owner => scopedUserIds.has(owner));
      return normalizedRefs(g.guide).some(guide => scopedUserIds.has(guide));
    });

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
      });
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
