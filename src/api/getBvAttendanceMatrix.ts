import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, AppError } from '@/lib/backend-sdk';
import { resolveBvScopedGroups } from '@/lib/bvGroupMemberScope';

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

export default createEndpoint({
  description: 'Get attendance matrix for a BV group — dates x members grid (queries attendance by group and filters the requested date range)',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    groupId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!input.groupId) return { sessions: [], members: [], matrix: {}, rows: [], dates: [] };
    if (!context?.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    await resolveBvScopedGroups(context.user, { groupId: input.groupId });

    // Resolve group
    let group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id', 'groupId', 'groupName'] });
    if (!group) {
      group = await BvGroups.findOne({ id: input.groupId, fields: ['id', 'groupId', 'groupName'] });
    }
    if (!group) return { sessions: [], members: [], matrix: {}, rows: [], dates: [] };

    // Get group members
    const membersByGroupRes = await BvGroupMembers.findAll({
      filters: { group: group.id },
      fields: ['id', 'user', 'userId'],
      limit: 200,
    });
    const membersByGroupIdRes = group.groupId
      ? await BvGroupMembers.findAll({ filters: { groupId: group.groupId } as any, fields: ['id', 'user', 'userId', 'group', 'groupId'], limit: 200 })
      : { records: [] };
    const membershipMap = new Map<string, any>();
    [...membersByGroupRes.records, ...membersByGroupIdRes.records].forEach((membership: any) => membershipMap.set(String(membership.id), membership));
    const membersRes = { records: [...membershipMap.values()] };

    const memberUserIds = membersRes.records
      .flatMap((m: any) => [firstValue(m.user), firstValue(m.userId)])
      .filter(Boolean) as string[];

    const [userRecordsById, userRecordsByUserId] = await Promise.all([
      memberUserIds.length > 0
        ? Users.findAll({ filters: { id: { in: memberUserIds } }, fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'status', 'isBvMember', 'bvGroupId'], limit: 500 })
        : { records: [] },
      memberUserIds.length > 0
        ? Users.findAll({ filters: { userId: { in: memberUserIds } }, fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'status', 'isBvMember', 'bvGroupId'], limit: 500 })
        : { records: [] },
    ]);

    const userMap: Record<string, any> = {};
    const addRecord = (u: any) => {
      userMap[u.id] = u;
      if (u.userId) {
        userMap[u.userId] = u;
      }
    };
    userRecordsById.records.forEach(addRecord);
    userRecordsByUserId.records.forEach(addRecord);

    const groupAliases = new Set([group.id, group.groupId].filter(Boolean).map(value => String(value).toLowerCase()));
    const activeMembers = membersRes.records.filter((m: any) => {
      const uid = firstValue(m.user);
      const altUid = firstValue(m.userId);
      const u = userMap[uid] || userMap[uid.toLowerCase()] || userMap[altUid] || userMap[altUid.toLowerCase()];
      const profileGroupId = firstValue(u?.bvGroupId).toLowerCase();
      const isCurrentGroup = profileGroupId ? groupAliases.has(profileGroupId) : true;
      const isActiveUser = !u?.status || String(u.status).toLowerCase() === 'active';
      return !!u && isCurrentGroup && isActiveUser;
    });

    // Query by group only. Combining group with an attendanceDate range needs
    // a Firestore composite index; filtering the small per-group result here
    // keeps the matrix reliable even before that index is deployed.
    let attRecords: any[] = [];
    let offset = 0;
    while (true) {
      const groupRefs = [...new Set([group.id, group.groupId].filter(Boolean))];
      const filters: any = { group: groupRefs.length > 1 ? { in: groupRefs } : group.id };
      const { records, hasMore } = await BvAttendance.findAll({
        filters,
        fields: ['id', 'user', 'present', 'attendanceDate'],
        limit: 2000,
        offset,
      });
      attRecords = attRecords.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }
    attRecords = attRecords.filter((attendance: any) => {
      const date = String(attendance.attendanceDate || '').slice(0, 10);
      return !!date &&
        (!input.startDate || date >= input.startDate) &&
        (!input.endDate || date <= input.endDate);
    });

    // Build date list from attendance records
    const dates = [...new Set(
      attRecords.map((a: any) => a.attendanceDate).filter(Boolean)
    )].sort() as string[];

    // Build userId → date → present map
    const userDateMap: Record<string, Record<string, number>> = {};
    for (const a of attRecords) {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user as string;
      const date = a.attendanceDate as string;
      if (!uid || !date) continue;
      if (!userDateMap[uid]) userDateMap[uid] = {};
      userDateMap[uid][date] = a.present ? 1 : 0;
    }

    const rows = activeMembers.map((m: any) => {
      const uid = firstValue(m.user);
      const altUid = firstValue(m.userId);
      const u = (userMap[uid] || userMap[uid.toLowerCase()] || userMap[altUid] || userMap[altUid.toLowerCase()]) as any;
      const attendance: Record<string, number> = {};
      dates.forEach(d => { attendance[d] = userDateMap[uid]?.[d] ?? 0; });
      const weekTotal = Object.values(attendance).reduce((s, v) => s + v, 0);
      return {
        userId: u?.userId || uid || '',
        name: u?.fullName || '',
        ashrayLevel: u?.ashrayLevel || null,
        attendance,
        weekTotal,
      };
    });

    return {
      sessions: dates.map(d => ({ sessionId: d, sessionDate: d, topic: '' })),
      members: activeMembers.map((m: any) => {
        const uid = firstValue(m.user);
        const altUid = firstValue(m.userId);
        const u = (userMap[uid] || userMap[uid.toLowerCase()] || userMap[altUid] || userMap[altUid.toLowerCase()]) as any;
        return { membershipId: m.id, userId: u?.userId || u?.id || uid, fullName: u?.fullName || '' };
      }),
      matrix: userDateMap,
      rows,
      dates,
    };
  },
});
