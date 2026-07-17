import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, Guides } from 'zite-integrations-backend-sdk';

/** ISO week number for a given Date */
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Convert ISO week + year to Mon–Sun date strings */
function isoWeekToDateRange(weekNum: number, year: number): { start: string; end: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (weekNum - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { start: fmt(weekStart), end: fmt(weekEnd) };
}

export default createEndpoint({
  description: 'Get BV stats for Super Guide — aggregate across all active groups with weekly filtering',
  authenticated: true,
  inputSchema: z.object({
    filterGuideId: z.string().optional(),
    weekNumber: z.number().optional(),
    year: z.number().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Fetch guides for the dropdown (always all active guides)
    const { records: allGuides } = await Guides.findAll({
      filters: { isActive: true },
      fields: ['id', 'guideId', 'fullName'],
      limit: 100,
    });

    const guideNameMap = new Map<string, string>();
    for (const g of allGuides) guideNameMap.set(g.id, (g.fullName as string) || '');

    // Fetch all active BV groups
    const { records: allGroups } = await BvGroups.findAll({
      filters: { isActive: true } as any,
      fields: ['id', 'groupId', 'groupName', 'guide'],
      limit: 500,
    });

    // Optionally filter groups by guide (filterGuideId is the guide DB UUID)
    const groups = input.filterGuideId
      ? allGroups.filter((g: any) => {
          const gid = Array.isArray(g.guide) ? g.guide[0] : g.guide;
          return gid === input.filterGuideId;
        })
      : allGroups;

    const emptyResult = {
      summary: { totalUsers: 0, markedCount: 0, presentCount: 0, absentCount: 0, notMarkedCount: 0, serviceFullCount: 0, avgPoints: 0 },
      guideBreakdown: [],
      leaderboard: [],
      guides: allGuides.map((g: any) => ({ guideId: g.id, name: (g.fullName as string) || '' })),
    };

    if (groups.length === 0) return emptyResult;

    const groupIds = groups.map((g: any) => g.id);

    // Map: groupId → guide DB id
    const groupGuideMap = new Map<string, string>();
    for (const g of groups) {
      const gid = Array.isArray((g as any).guide) ? (g as any).guide[0] : (g as any).guide;
      if (gid) groupGuideMap.set(g.id, gid as string);
    }

    // Week date range
    const now = new Date();
    const weekNum = input.weekNumber ?? getISOWeek(now);
    const year = input.year ?? now.getUTCFullYear();
    const { start: weekStart, end: weekEnd } = isoWeekToDateRange(weekNum, year);

    // Parallel: members + week attendance
    const [membersRes, weekAttRes] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { group: { in: groupIds } } as any,
        fields: ['id', 'group', 'user'],
        limit: 2000,
      }),
      BvAttendance.findAll({
        filters: { group: { in: groupIds }, attendanceDate: { gte: weekStart, lte: weekEnd } } as any,
        fields: ['id', 'group', 'user', 'present'],
        limit: 2000,
      }),
    ]);

    // Build unique user set per group from members
    const usersByGroup = new Map<string, Set<string>>();
    for (const m of membersRes.records) {
      const gid = Array.isArray(m.group) ? m.group[0] : m.group as string;
      const uid = Array.isArray(m.user) ? m.user[0] : m.user as string;
      if (!gid || !uid) continue;
      if (!usersByGroup.has(gid)) usersByGroup.set(gid, new Set());
      usersByGroup.get(gid)!.add(uid);
    }

    // All unique users across all groups
    const allUserIds = new Set<string>();
    for (const s of usersByGroup.values()) for (const uid of s) allUserIds.add(uid);

    // Weekly attendance: userId → { present, groupId }
    const attendanceByUser = new Map<string, { present: boolean; groupId: string }>();
    for (const a of weekAttRes.records) {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user as string;
      const gid = Array.isArray(a.group) ? a.group[0] : a.group as string;
      if (!uid) continue;
      // Last record wins if somehow duplicated
      attendanceByUser.set(uid, { present: !!(a.present), groupId: gid });
    }

    // All-time attendance for leaderboard (paginated)
    let allTimeAttendance: any[] = [];
    {
      let offset = 0;
      while (true) {
        const { records, hasMore } = await BvAttendance.findAll({
          filters: { group: { in: groupIds } } as any,
          fields: ['id', 'user', 'present'],
          limit: 2000,
          offset,
        });
        allTimeAttendance = allTimeAttendance.concat(records);
        if (!hasMore) break;
        offset += 2000;
      }
    }

    // Aggregate all-time points per user
    const userTotalPoints = new Map<string, number>(); // attended (present)
    const userTotalSessions = new Map<string, number>(); // any attendance record
    for (const a of allTimeAttendance) {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user as string;
      if (!uid) continue;
      userTotalSessions.set(uid, (userTotalSessions.get(uid) || 0) + 1);
      if (a.present) userTotalPoints.set(uid, (userTotalPoints.get(uid) || 0) + 1);
    }

    // Fetch user info for members (display name, ashray, guide)
    const { records: userRecs } = await Users.findAll({
      fields: ['id', 'fullName', 'ashrayLevel', 'guide'],
      limit: 2000,
    });
    const userInfoMap = new Map<string, any>();
    for (const u of userRecs) {
      if (allUserIds.has(u.id)) userInfoMap.set(u.id, u);
    }

    // ── Summary stats ──
    const totalUsers = allUserIds.size;
    const markedCount = attendanceByUser.size;
    const presentCount = [...attendanceByUser.values()].filter(a => a.present).length;
    const absentCount = markedCount - presentCount;
    const notMarkedCount = totalUsers - markedCount;
    const serviceFullCount = presentCount; // present = completed service
    const avgPoints = markedCount > 0
      ? Math.round((presentCount / markedCount) * 3 * 10) / 10
      : 0;

    // ── Guide breakdown ──
    const guideBreakdownMap = new Map<string, {
      guideName: string;
      userIds: Set<string>;
      markedCount: number;
      presentCount: number;
    }>();

    for (const [gid, uids] of usersByGroup) {
      const guideDbId = groupGuideMap.get(gid) || 'unknown';
      if (!guideBreakdownMap.has(guideDbId)) {
        guideBreakdownMap.set(guideDbId, {
          guideName: guideNameMap.get(guideDbId) || 'Unknown',
          userIds: new Set(),
          markedCount: 0,
          presentCount: 0,
        });
      }
      const entry = guideBreakdownMap.get(guideDbId)!;
      for (const uid of uids) entry.userIds.add(uid);
    }

    for (const [uid, att] of attendanceByUser) {
      const guideDbId = groupGuideMap.get(att.groupId) || 'unknown';
      const entry = guideBreakdownMap.get(guideDbId);
      if (!entry) continue;
      entry.markedCount++;
      if (att.present) entry.presentCount++;
    }

    const guideBreakdown = [...guideBreakdownMap.entries()].map(([, d]) => ({
      guideId: [...guideNameMap.entries()].find(([, n]) => n === d.guideName)?.[0] || '',
      guideName: d.guideName,
      totalUsers: d.userIds.size,
      presentCount: d.presentCount,
      serviceFullCount: d.presentCount,
      avgPoints: d.markedCount > 0
        ? Math.round((d.presentCount / d.markedCount) * 3 * 10) / 10
        : 0,
    }));

    // ── Leaderboard (sorted by all-time points) ──
    const leaderboard = [...allUserIds]
      .map(uid => {
        const u = userInfoMap.get(uid);
        const totalPts = userTotalPoints.get(uid) || 0;
        const totalAtt = userTotalSessions.get(uid) || 0;
        const guideId = u ? (Array.isArray(u.guide) ? u.guide[0] : u.guide) : null;
        return {
          userId: uid,
          displayName: u ? ((u.fullName as string) || uid) : uid,
          guideName: guideId ? (guideNameMap.get(guideId as string) || '') : '',
          ashrayLevel: u ? ((u.ashrayLevel as string) || '') : '',
          totalPoints: totalPts,
          attendanceRate: totalAtt > 0 ? Math.round((totalPts / totalAtt) * 100) : 0,
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, 50);

    return {
      summary: { totalUsers, markedCount, presentCount, absentCount, notMarkedCount, serviceFullCount, avgPoints },
      guideBreakdown,
      leaderboard,
      guides: allGuides.map((g: any) => ({ guideId: g.id, name: (g.fullName as string) || '' })),
    };
  },
});
