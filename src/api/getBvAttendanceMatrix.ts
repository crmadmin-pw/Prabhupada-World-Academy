import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get attendance matrix for a BV group — dates x members grid (queries attendance directly by group+date)',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    if (!input.groupId) return { sessions: [], members: [], matrix: {}, rows: [], dates: [] };

    // Resolve group
    let group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id', 'groupId', 'groupName'] });
    if (!group) {
      group = await BvGroups.findOne({ id: input.groupId, fields: ['id', 'groupId', 'groupName'] }).catch(() => undefined);
    }
    if (!group) return { sessions: [], members: [], matrix: {}, rows: [], dates: [] };

    // Get group members
    const membersRes = await BvGroupMembers.findAll({
      filters: { group: group.id },
      fields: ['id', 'user'],
      limit: 200,
    });

    const memberUserIds = membersRes.records
      .map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user)
      .filter(Boolean) as string[];

    const userRecords = memberUserIds.length > 0
      ? await Users.findAll({ filters: { id: { in: memberUserIds } }, fields: ['id', 'userId', 'fullName', 'ashrayLevel'], limit: 500 })
      : { records: [] };

    const userMap: Record<string, any> = {};
    userRecords.records.forEach((u: any) => { userMap[u.id] = u; });

    // Build date range filter
    const dateFilter: any = {};
    if (input.startDate || input.endDate) {
      if (input.startDate) dateFilter.gte = input.startDate;
      if (input.endDate) dateFilter.lte = input.endDate;
    }

    // Query attendance directly by group (+ optional date range)
    let attRecords: any[] = [];
    let offset = 0;
    while (true) {
      const filters: any = { group: group.id };
      if (Object.keys(dateFilter).length > 0) filters.attendanceDate = dateFilter;
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

    const rows = membersRes.records.map((m: any) => {
      const uid = Array.isArray(m.user) ? m.user[0] : m.user as string;
      const u = userMap[uid] as any;
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
      members: membersRes.records.map((m: any) => {
        const uid = Array.isArray(m.user) ? m.user[0] : m.user as string;
        const u = userMap[uid] as any;
        return { membershipId: m.id, userId: uid, fullName: u?.fullName || '' };
      }),
      matrix: userDateMap,
      rows,
      dates,
    };
  },
});
