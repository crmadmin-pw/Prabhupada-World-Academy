import { z } from 'zod';
import { createEndpoint, Users, AttendanceRecords, AttendanceSessions, AttendanceEvents, Guides, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get attendance report for Super Guide (all users, all centers)',
  authenticated: true,
  inputSchema: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    ashrayLevel: z.string().optional(),
    guideId: z.string().optional(),
    residencyId: z.string().optional(),
    eventId: z.string().optional(),
    sessionId: z.string().optional(),
    search: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (context.user.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guides only' });
    }

    const limit = Math.min(input.limit || 50, 200);
    const offset = input.offset || 0;

    // Fetch lookup data in parallel
    const [eventsRes, sessionsRes, guidesRes, centersRes] = await Promise.all([
      AttendanceEvents.findAll({ filters: {}, limit: 200, fields: ['id', 'title'] }),
      AttendanceSessions.findAll({ filters: {}, limit: 500, fields: ['id', 'name', 'event'] }),
      Guides.findAll({ filters: { isActive: true } as any, limit: 200, fields: ['id', 'fullName', 'folkResidencies'] }),
      FolkResidencies.findAll({ filters: { isActive: true } as any, limit: 100, fields: ['id', 'residencyName'] }),
    ]);

    const eventMap = new Map(eventsRes.records.map(e => [e.id, e.title || '']));
    const sessionMap = new Map(sessionsRes.records.map(s => [s.id, { name: s.name || '', eventId: Array.isArray(s.event) ? s.event[0] : s.event }]));
    const guideMap = new Map(guidesRes.records.map(g => [g.id, g.fullName || '']));
    const centerMap = new Map(centersRes.records.map(c => [c.id, c.residencyName || '']));

    // Build record filters
    const recFilters: any = {};
    if (input.startDate) recFilters.date = { ...(recFilters.date || {}), gte: input.startDate };
    if (input.endDate) recFilters.date = { ...(recFilters.date || {}), lte: input.endDate };
    if (input.sessionId) recFilters.session = input.sessionId;

    if (input.eventId && !input.sessionId) {
      const eventSessionIds = sessionsRes.records
        .filter(s => (Array.isArray(s.event) ? s.event[0] : s.event) === input.eventId)
        .map(s => s.id);
      if (eventSessionIds.length > 0) recFilters.session = { in: eventSessionIds };
    }

    // If guideId or residencyId filter, scope user IDs first
    let scopedUserIds: string[] | undefined;
    if (input.guideId || input.residencyId || input.ashrayLevel || input.search) {
      const userFilters: any = { status: 'Active' };
      if (input.guideId) userFilters.guide = input.guideId;
      if (input.residencyId) userFilters.residency = input.residencyId;
      if (input.ashrayLevel) userFilters.ashrayLevel = input.ashrayLevel;

      const { records: scopeUsers } = await Users.findAll({
        filters: userFilters,
        fields: ['id', 'fullName', 'phone', 'ashrayLevel', 'guide', 'residency'],
        limit: 2000,
      });

      let filtered = scopeUsers;
      if (input.search) {
        const q = input.search.toLowerCase();
        filtered = scopeUsers.filter(u =>
          (u.fullName || '').toLowerCase().includes(q) ||
          (u.phone || '').includes(q)
        );
      }
      scopedUserIds = filtered.map(u => u.id);
      if (scopedUserIds.length === 0) {
        return {
          records: [], stats: { totalCheckins: 0, uniqueParticipants: 0, levelBreakdown: [], centerBreakdown: [] },
          filterOptions: {
            guides: guidesRes.records.map(g => ({ id: g.id, name: g.fullName || '' })),
            centers: centersRes.records.map(c => ({ id: c.id, name: c.residencyName || '' })),
            events: eventsRes.records.map(e => ({ id: e.id, title: e.title || '' })),
            sessions: sessionsRes.records.map(s => ({ id: s.id, name: s.name || '', eventId: (Array.isArray(s.event) ? s.event[0] : s.event) || '' })),
          },
          pagination: { hasMore: false, totalCount: 0 },
        };
      }
      recFilters.user = { in: scopedUserIds };
    }

    const { records: allRecords } = await AttendanceRecords.findAll({
      filters: recFilters,
      limit: 2000,
      fields: ['id', 'session', 'date', 'user', 'source'],
    });

    allRecords.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Need user details for all records
    const recordUserIds = [...new Set(allRecords.map(r => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];

    // Fetch user details in batches
    const userDetails = new Map<string, any>();
    for (let i = 0; i < recordUserIds.length; i += 100) {
      const batch = recordUserIds.slice(i, i + 100);
      const { records: batchUsers } = await Users.findAll({
        filters: { id: { in: batch } } as any,
        fields: ['id', 'fullName', 'phone', 'ashrayLevel', 'guide', 'residency'],
        limit: 100,
      });
      batchUsers.forEach(u => userDetails.set(u.id, u));
    }

    // Stats
    const uniqueUsers = new Set(recordUserIds);
    const levelCounts: Record<string, number> = {};
    const centerCounts: Record<string, number> = {};
    for (const uid of uniqueUsers) {
      const u = userDetails.get(uid);
      if (!u) continue;
      const level = u.ashrayLevel || 'Unknown';
      levelCounts[level] = (levelCounts[level] || 0) + 1;
      const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const cName = rid ? centerMap.get(rid) || 'Unknown' : 'No Center';
      centerCounts[cName] = (centerCounts[cName] || 0) + 1;
    }

    const totalCount = allRecords.length;
    const paged = allRecords.slice(offset, offset + limit);

    const records = paged.map(r => {
      const uid = (Array.isArray(r.user) ? r.user[0] : r.user) as string;
      const sid = (Array.isArray(r.session) ? r.session[0] : r.session) as string;
      const user = userDetails.get(uid);
      const session = sessionMap.get(sid);
      const gid = user ? (Array.isArray(user.guide) ? user.guide[0] : user.guide) : undefined;
      const rid = user ? (Array.isArray(user.residency) ? user.residency[0] : user.residency) : undefined;

      return {
        id: r.id,
        name: user?.fullName || 'Unknown',
        phone: user?.phone || '',
        ashrayLevel: user?.ashrayLevel || '',
        guideName: gid ? guideMap.get(gid) || '' : '',
        centerName: rid ? centerMap.get(rid) || '' : '',
        sessionName: session?.name || '',
        eventTitle: session?.eventId ? eventMap.get(session.eventId) || '' : '',
        date: r.date || '',
        source: r.source || '',
      };
    });

    return {
      records,
      stats: {
        totalCheckins: totalCount,
        uniqueParticipants: uniqueUsers.size,
        levelBreakdown: Object.entries(levelCounts).map(([level, count]) => ({ level, count })),
        centerBreakdown: Object.entries(centerCounts).map(([centerName, count]) => ({ centerName, count })),
      },
      filterOptions: {
        guides: guidesRes.records.map(g => ({ id: g.id, name: g.fullName || '' })),
        centers: centersRes.records.map(c => ({ id: c.id, name: c.residencyName || '' })),
        events: eventsRes.records.map(e => ({ id: e.id, title: e.title || '' })),
        sessions: sessionsRes.records.map(s => ({ id: s.id, name: s.name || '', eventId: (Array.isArray(s.event) ? s.event[0] : s.event) || '' })),
      },
      pagination: { hasMore: offset + limit < totalCount, totalCount },
    };
  },
});
