import { z } from 'zod';
import { createEndpoint, BvslPreachingEntries, BvSessions, BvAttendance, BvGroups, BvGroupMembers } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: "BVSL's own BV preaching + session report (attendance queried by group+date directly)",
  authenticated: true,
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const { startDate, endDate } = input;
    const userId = context.user!.id;

    // Get preaching entries
    const { records: entries } = await BvslPreachingEntries.findAll({
      filters: {
        user: userId,
        entryDate: { gte: startDate, lte: endDate },
      } as any,
      limit: 500,
    });

    // Get groups led by this BVSL
    const { records: groups } = await BvGroups.findAll({
      filters: { bvslLeader: userId, isActive: true } as any,
      fields: ['id', 'groupName'],
      limit: 50,
    });

    const groupIds = groups.map(g => g.id);
    const groupMap = new Map(groups.map(g => [g.id, g.groupName || '']));

    // Get member counts
    let totalMembers = 0;
    if (groupIds.length > 0) {
      const { records: members } = await BvGroupMembers.findAll({
        filters: { group: { in: groupIds } } as any,
        fields: ['id'],
        limit: 2000,
      });
      totalMembers = members.length;
    }

    // Get session topics/notes from BvSessions (for enrichment)
    type SessionMeta = { topic: string; notes: string };
    const sessionMetaMap = new Map<string, SessionMeta>();
    if (groupIds.length > 0) {
      const { records: sessRecs } = await BvSessions.findAll({
        filters: {
          group: { in: groupIds },
          sessionDate: { gte: startDate, lte: endDate },
        } as any,
        fields: ['id', 'group', 'sessionDate', 'topic', 'notes'],
        limit: 500,
      });
      for (const s of sessRecs) {
        const gid = Array.isArray(s.group) ? s.group[0] : s.group as string;
        const date = String(s.sessionDate || '').slice(0, 10);
        if (gid && date) sessionMetaMap.set(`${gid}::${date}`, { topic: s.topic || '', notes: s.notes || '' });
      }
    }

    // Query attendance by group+date range directly (new approach)
    let attendanceRecords: any[] = [];
    if (groupIds.length > 0) {
      const { records } = await BvAttendance.findAll({
        filters: {
          group: { in: groupIds },
          attendanceDate: { gte: startDate, lte: endDate },
        } as any,
        fields: ['id', 'group', 'present', 'attendanceDate'],
        limit: 2000,
      });
      attendanceRecords = records;
    }

    // Group attendance by group+date
    const attByGroupDate = new Map<string, { present: number; total: number }>();
    for (const a of attendanceRecords) {
      const gid = Array.isArray(a.group) ? a.group[0] : a.group as string;
      const date = String(a.attendanceDate || '').slice(0, 10);
      if (!gid || !date) continue;
      const key = `${gid}::${date}`;
      if (!attByGroupDate.has(key)) attByGroupDate.set(key, { present: 0, total: 0 });
      const data = attByGroupDate.get(key)!;
      data.total++;
      if (a.present) data.present++;
    }

    // Build preaching rows
    const preachingRows = entries.map(e => ({
      id: e.id,
      entryDate: e.entryDate || '',
      callingTime: Number(e.prCallingTime) || 0,
      oneOnOneTime: Number(e.prOneOnOneTime) || 0,
      bookDistTime: Number(e.prBookDistTime) || 0,
      rduaTime: Number(e.prRduaTime) || 0,
      planTime: Number(e.prPlanTime) || 0,
      booksDistributed: Number(e.prBooksDistributed) || 0,
      contactsCollected: Number(e.prContactsCollected) || 0,
      uniqueOneOnOnes: Number(e.prUniqueOneOnOnes) || 0,
      totalMinutes: Number(e.totalPreachingMinutes) || 0,
    })).sort((a, b) => b.entryDate.localeCompare(a.entryDate));

    // Build session rows from attendance data (one row per group+date)
    const sessionRows = [...attByGroupDate.entries()].map(([key, stats]) => {
      const [gid, date] = key.split('::');
      const meta = sessionMetaMap.get(key) || { topic: '', notes: '' };
      return {
        sessionId: key,
        sessionDate: date,
        groupName: groupMap.get(gid) || '—',
        topic: meta.topic,
        presentCount: stats.present,
        totalMembers: stats.total,
        attendancePercent: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0,
      };
    }).sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));

    // Summary
    const totalPreachingMins = preachingRows.reduce((s, r) => s + r.totalMinutes, 0);
    const totalBooks = preachingRows.reduce((s, r) => s + r.booksDistributed, 0);
    const totalContacts = preachingRows.reduce((s, r) => s + r.contactsCollected, 0);
    const avgAttendance = sessionRows.length > 0
      ? Math.round(sessionRows.reduce((s, r) => s + r.attendancePercent, 0) / sessionRows.length)
      : 0;

    return {
      preachingEntries: preachingRows,
      sessions: sessionRows,
      summary: {
        totalPreachingMins,
        totalBooks,
        totalContacts,
        sessionsCount: sessionRows.length,
        avgAttendance,
        entriesCount: preachingRows.length,
        totalMembers,
      },
    };
  },
});
