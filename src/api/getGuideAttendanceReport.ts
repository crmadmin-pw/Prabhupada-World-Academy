import { z } from 'zod';
import { createEndpoint, Users, AttendanceRecords, AttendanceSessions, AttendanceEvents, AttendanceVolunteers, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Get attendance report for a guide (scoped to their residency users)',
  authenticated: true,
  inputSchema: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    ashrayLevel: z.string().optional(),
    eventId: z.string().optional(),
    sessionId: z.string().optional(),
    search: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const role = context.user.role || '';
    if (role !== 'Guide' && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only Guides and Super Guides can access this' });
    }

    const scope = await getGuideScope(context.user.email);
    if (!scope && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide scope not found' });
    }

    const limit = Math.min(input.limit || 50, 200);
    const offset = input.offset || 0;

    // Get users in scope
    const userFilters: any = { status: 'Active' };
    if (scope && scope.residencyIds.length > 0) {
      userFilters.residency = { in: scope.residencyIds };
    }
    if (input.ashrayLevel) {
      userFilters.ashrayLevel = input.ashrayLevel;
    }

    const { records: users } = await Users.findAll({
      filters: userFilters,
      fields: ['id', 'fullName', 'phone', 'ashrayLevel', 'guide', 'residency'],
      limit: 2000,
    });

    // Apply search filter
    let filteredUsers = users;
    if (input.search) {
      const q = input.search.toLowerCase();
      filteredUsers = users.filter(u =>
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.phone || '').includes(q)
      );
    }

    const userIds = filteredUsers.map(u => u.id);
    if (userIds.length === 0) {
      return { records: [], stats: { totalCheckins: 0, uniqueParticipants: 0, levelBreakdown: [] }, events: [], sessions: [], pagination: { hasMore: false, totalCount: 0 } };
    }

    // Fetch all events and sessions for filter dropdowns
    const [eventsResult, sessionsResult] = await Promise.all([
      AttendanceEvents.findAll({ filters: {}, limit: 200, fields: ['id', 'title'] }),
      AttendanceSessions.findAll({ filters: {}, limit: 500, fields: ['id', 'name', 'event'] }),
    ]);

    const eventMap = new Map(eventsResult.records.map(e => [e.id, e.title || 'Untitled']));
    const sessionMap = new Map(sessionsResult.records.map(s => [s.id, { name: s.name || 'Untitled', eventId: Array.isArray(s.event) ? s.event[0] : s.event }]));

    // Fetch attendance records
    const recFilters: any = { user: { in: userIds } };
    if (input.startDate) recFilters.date = { ...(recFilters.date || {}), gte: input.startDate };
    if (input.endDate) recFilters.date = { ...(recFilters.date || {}), lte: input.endDate };
    if (input.sessionId) recFilters.session = input.sessionId;

    // If eventId filter, get session IDs for that event
    if (input.eventId && !input.sessionId) {
      const eventSessionIds = sessionsResult.records
        .filter(s => {
          const eid = Array.isArray(s.event) ? s.event[0] : s.event;
          return eid === input.eventId;
        })
        .map(s => s.id);
      if (eventSessionIds.length > 0) {
        recFilters.session = { in: eventSessionIds };
      }
    }

    const { records: allRecords } = await AttendanceRecords.findAll({
      filters: recFilters,
      limit: 2000,
      fields: ['id', 'session', 'date', 'user', 'source'],
    });

    // Sort by date desc
    allRecords.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Compute stats
    const uniqueUserIds = new Set(allRecords.map(r => {
      const uid = Array.isArray(r.user) ? r.user[0] : r.user;
      return uid;
    }));

    const userMap = new Map(filteredUsers.map(u => [u.id, u]));
    const levelCounts: Record<string, number> = {};
    for (const uid of uniqueUserIds) {
      const u = userMap.get(uid as string);
      const level = u?.ashrayLevel || 'Unknown';
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    }

    // Paginate
    const totalCount = allRecords.length;
    const paged = allRecords.slice(offset, offset + limit);

    const records = paged.map(r => {
      const uid = Array.isArray(r.user) ? r.user[0] : r.user;
      const sid = Array.isArray(r.session) ? r.session[0] : r.session;
      const user = userMap.get(uid as string);
      const session = sessionMap.get(sid as string);
      const eventTitle = session?.eventId ? eventMap.get(session.eventId) || '' : '';

      return {
        id: r.id,
        name: user?.fullName || 'Unknown',
        phone: user?.phone || '',
        ashrayLevel: user?.ashrayLevel || '',
        sessionName: session?.name || '',
        eventTitle,
        date: r.date || '',
        source: r.source || '',
      };
    });

    return {
      records,
      stats: {
        totalCheckins: totalCount,
        uniqueParticipants: uniqueUserIds.size,
        levelBreakdown: Object.entries(levelCounts).map(([level, count]) => ({ level, count })),
      },
      events: eventsResult.records.map(e => ({ id: e.id, title: e.title || '' })),
      sessions: sessionsResult.records.map(s => ({
        id: s.id,
        name: s.name || '',
        eventId: Array.isArray(s.event) ? s.event[0] : s.event || '',
      })),
      pagination: { hasMore: offset + limit < totalCount, totalCount },
    };
  },
});
