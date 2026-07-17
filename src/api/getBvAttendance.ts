import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvAttendance, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get BV attendance history and leaderboard for the current user',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    localDate: z.string().optional(),
    sinceDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    const sinceDate = input.sinceDate || new Date(Date.now() - 90 * 86400_000).toISOString().split('T')[0];

    // Get user's group membership
    const membershipRes = await BvGroupMembers.findAll({ filters: { user: uid }, limit: 5, fields: ['id', 'group'] });
    const membership = membershipRes.records[0];
    if (!membership) return { userHistory: [], leaderboard: [], userTotalPointsThisWeek: 0 };

    const groupId = Array.isArray(membership.group) ? membership.group[0] : membership.group;
    if (!groupId) return { userHistory: [], leaderboard: [], userTotalPointsThisWeek: 0 };

    // Query all attendance for this group since sinceDate (using new fields)
    const filters: any = { group: groupId };
    if (sinceDate) filters.attendanceDate = { gte: sinceDate };

    const allAttRes = await BvAttendance.findAll({
      filters,
      limit: 1000,
      fields: ['id', 'user', 'present', 'attendanceDate'],
    });
    const allAtt = allAttRes.records;

    if (allAtt.length === 0) return { userHistory: [], leaderboard: [], userTotalPointsThisWeek: 0 };

    // User's history
    const myAtt = allAtt.filter((a: any) => {
      const u = Array.isArray(a.user) ? a.user[0] : a.user;
      return u === uid;
    });

    const userHistory = myAtt
      .filter((a: any) => a.attendanceDate)
      .map((a: any) => ({
        attendanceDate: a.attendanceDate || '',
        present: a.present || false,
        sessionTopic: '',
      }))
      .sort((a: any, b: any) => b.attendanceDate.localeCompare(a.attendanceDate));

    // Leaderboard — get all unique member user IDs
    const memberIds = [...new Set(allAtt.map((a: any) => Array.isArray(a.user) ? a.user[0] : a.user).filter(Boolean))] as string[];
    const userRecords = memberIds.length > 0
      ? await Users.findAll({ filters: { id: { in: memberIds } }, fields: ['id', 'fullName', 'userId'] })
      : { records: [] };
    const userNameMap = new Map<string, { name: string; userId: string }>(
      userRecords.records.map((u: any) => [u.id, { name: u.fullName || '', userId: u.userId || u.id }] as [string, { name: string; userId: string }])
    );

    // Count distinct attendance dates = total sessions
    const totalSessionDates = new Set(allAtt.map((a: any) => a.attendanceDate).filter(Boolean)).size;

    const leaderboard = memberIds.map(memberId => {
      const memberAtt = allAtt.filter((a: any) => (Array.isArray(a.user) ? a.user[0] : a.user) === memberId);
      const presentCount = memberAtt.filter((a: any) => a.present).length;
      const info = userNameMap.get(memberId);
      return {
        userId: (info as any)?.userId || memberId,
        userName: (info as any)?.name || memberId,
        presentCount,
        totalSessions: totalSessionDates,
        attendanceRate: totalSessionDates > 0 ? Math.round((presentCount / totalSessionDates) * 100) : 0,
      };
    }).sort((a, b) => b.presentCount - a.presentCount);

    // This week points (1 point per present session this week)
    const weekStart = new Date(); weekStart.setHours(0,0,0,0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const thisWeekPresent = myAtt.filter((a: any) => a.present && a.attendanceDate >= weekStartStr).length;

    return { userHistory, leaderboard, userTotalPointsThisWeek: thisWeekPresent };
  },
});
