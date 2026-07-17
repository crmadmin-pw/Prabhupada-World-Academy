import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroupRequests, BvGroups, BvAttendance, Users } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';

export default createEndpoint({
  description: 'Get current user BV group status, attendance streak, and available groups',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional(), localDate: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const uid = context.user!.id;
    const today = getTodayIST();

    // Parallel: membership + pending request
    const [membershipRes, pendingRes] = await Promise.all([
      BvGroupMembers.findAll({ filters: { user: uid }, limit: 5, fields: ['id', 'group', 'role', 'joinedAt'] }),
      BvGroupRequests.findAll({ filters: { user: uid, status: 'Pending' }, limit: 5, fields: ['id', 'group', 'requestedAt'] }),
    ]);

    const membership = membershipRes.records[0];
    const pending = pendingRes.records[0];

    // Not in any group — return available groups
    if (!membership) {
      const pendingGroupId = pending
        ? (Array.isArray(pending.group) ? pending.group[0] : pending.group)
        : null;

      const [availGroupsRes, pendingGroup] = await Promise.all([
        pending ? Promise.resolve({ records: [] }) : BvGroups.findAll({
          filters: { isActive: true }, limit: 50,
          fields: ['id', 'groupId', 'groupName', 'description', 'bvslLeader'],
        }),
        pendingGroupId ? BvGroups.findOne({ id: pendingGroupId, fields: ['id', 'groupName', 'groupId'] }) : Promise.resolve(null),
      ]);

      if (pendingGroup) {
        return {
          myGroup: null,
          pendingRequest: { groupId: (pendingGroup as any).groupId || (pendingGroup as any).id, groupName: (pendingGroup as any).groupName || '' },
          availableGroups: [],
          todayStatus: null, streak: 0, presentCount: 0, totalSessions: 0,
        };
      }

      const groups = availGroupsRes.records;
      const memberCountMap: Record<string, number> = {};
      if (groups.length > 0) {
        await Promise.all(groups.map(async (g: any) => {
          const { records: mems } = await BvGroupMembers.findAll({
            filters: { group: g.id }, fields: ['id'], limit: 1000,
          });
          memberCountMap[g.id] = mems.length;
        }));
      }

      const leaderIds = [...new Set(groups.map((g: any) => Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader).filter(Boolean))] as string[];
      const leaderMap: Record<string, string> = {};
      if (leaderIds.length > 0) {
        const leaderRecords = await Users.findAll({ filters: { id: { in: leaderIds } }, fields: ['id', 'fullName'] });
        leaderRecords.records.forEach((u: any) => { leaderMap[u.id] = u.fullName || ''; });
      }

      return {
        myGroup: null,
        pendingRequest: null,
        availableGroups: groups.map((g: any) => {
          const leaderId = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader;
          return {
            groupId: g.groupId || g.id,
            groupName: g.groupName || '',
            description: g.description || '',
            bvslName: leaderMap[leaderId || ''] || '',
            memberCount: memberCountMap[g.id] ?? 0,
          };
        }),
        todayStatus: null, streak: 0, presentCount: 0, totalSessions: 0,
      };
    }

    // In a group — get group details + attendance
    const groupId = Array.isArray(membership.group) ? membership.group[0] : membership.group;
    if (!groupId) return { myGroup: null, pendingRequest: null, availableGroups: [], todayStatus: null, streak: 0, presentCount: 0, totalSessions: 0 };

    const [groupRecord, groupMembersRes] = await Promise.all([
      BvGroups.findOne({ id: groupId, fields: ['id', 'groupId', 'groupName', 'bvslLeader'] }),
      BvGroupMembers.findAll({ filters: { group: groupId }, fields: ['id'], limit: 1000 }),
    ]);

    const group = groupRecord as any;
    const memberCount = groupMembersRes.records.length;

    // Get all attendance for this group (to find session dates)
    const { records: allGroupAtt } = await BvAttendance.findAll({
      filters: { group: groupId },
      fields: ['id', 'user', 'present', 'attendanceDate'],
      limit: 1000,
    });

    // Get this user's attendance
    const myAtt = allGroupAtt.filter((a: any) => {
      const u = Array.isArray(a.user) ? a.user[0] : a.user;
      return u === uid;
    });

    // Build maps
    const myAttByDate = new Map<string, boolean>();
    for (const a of myAtt) {
      const date = a.attendanceDate as string;
      if (date) myAttByDate.set(date, !!a.present);
    }

    // All distinct session dates for this group (sorted desc)
    const sessionDates = [...new Set(
      allGroupAtt.map((a: any) => a.attendanceDate).filter(Boolean)
    )].sort((a: any, b: any) => b.localeCompare(a)) as string[];

    // Today status
    const todayStatus = myAttByDate.has(today) ? (myAttByDate.get(today) ? 'P' : 'A') : null;

    // Streak: consecutive sessions (most recent first) where user was present
    let streak = 0;
    for (const date of sessionDates) {
      const wasPresent = myAttByDate.get(date);
      if (wasPresent) streak++;
      else break;
    }

    const presentCount = myAtt.filter((a: any) => a.present).length;

    const leaderId = Array.isArray(group?.bvslLeader) ? group.bvslLeader[0] : group?.bvslLeader;
    let bvslName = '';
    if (leaderId) {
      const leaderRec = await Users.findOne({ id: leaderId, fields: ['id', 'fullName'] });
      bvslName = (leaderRec as any)?.fullName || '';
    }

    return {
      myGroup: {
        groupId: group?.groupId || groupId,
        groupName: group?.groupName || '',
        bvslName,
        memberCount,
      },
      pendingRequest: null,
      availableGroups: [],
      todayStatus,
      streak,
      presentCount,
      totalSessions: sessionDates.length,
    };
  },
});
