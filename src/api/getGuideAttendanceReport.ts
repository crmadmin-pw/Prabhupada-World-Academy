import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy, isHierarchyAdmin, readScopedUsers } from '../lib/hierarchyUtils';
import { createEndpoint, AttendanceSessions, AttendanceEvents, AttendanceVolunteers, AppError } from '@/lib/backend-sdk';
import { loadStandardAttendance } from '../lib/reportPeriodSummary';

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
    if (!isHierarchyAdmin(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only Guides and Super Guides can access this' });
    }


    const limit = Math.min(input.limit || 50, 200);
    const offset = input.offset || 0;

    // Get users in scope
    const userFilters: any = { status: 'Active' };
    if (input.ashrayLevel) {
      userFilters.ashrayLevel = input.ashrayLevel;
    }

    const { records: users } = await readScopedUsers(context.user, {
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

    const hierarchy = await getScopedHierarchyUserIds(context.user);
    filteredUsers = filteredUsers.filter(user => isUserInHierarchy(user, hierarchy));
    const userIds = filteredUsers.map(u => u.id);
    if (userIds.length === 0) {
      return { records: [], stats: { totalCheckins: 0, uniqueParticipants: 0, levelBreakdown: [] }, events: [], sessions: [], pagination: { hasMore: false, totalCount: 0 } };
    }

    const [eventsResult, sessionsResult, loadedRecords] = await Promise.all([
      AttendanceEvents.findAll({ filters: {}, limit: 200, fields: ['id', 'title'] }),
      AttendanceSessions.findAll({ filters: {}, limit: 500, fields: ['id', 'name', 'event'] }),
      loadStandardAttendance(input.startDate, input.endDate),
    ]);

    const eventMap = new Map(eventsResult.records.map(e => [e.id, e.title || 'Untitled']));
    const sessionMap = new Map(sessionsResult.records.map(s => [s.id, { name: s.name || 'Untitled', eventId: Array.isArray(s.event) ? s.event[0] : s.event }]));

    const userIdSet = new Set(userIds);
    let allRecords = loadedRecords.filter(record => userIdSet.has(String(Array.isArray(record.user) ? record.user[0] : record.user || '')));
    if (input.sessionId) {
      allRecords = allRecords.filter(record => String(Array.isArray(record.session) ? record.session[0] : record.session || '') === input.sessionId);
    } else if (input.eventId) {
      const eventSessionIds = sessionsResult.records
        .filter(s => (Array.isArray(s.event) ? s.event[0] : s.event) === input.eventId)
        .map(s => s.id);
      if (eventSessionIds.length > 0) {
        const allowedSessions = new Set(eventSessionIds);
        allRecords = allRecords.filter(record => allowedSessions.has(String(Array.isArray(record.session) ? record.session[0] : record.session || '')));
      }
    }

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
      events: eventsResult.records.filter(e => hierarchy === null || sessionsResult.records.some(s => [s.event].flat().includes(e.id) && allRecords.some(r => [r.session].flat().includes(s.id)))).map(e => ({ id: e.id, title: e.title || '' })),
      sessions: sessionsResult.records.filter(s => hierarchy === null || allRecords.some(r => [r.session].flat().includes(s.id))).map(s => ({
        id: s.id,
        name: s.name || '',
        eventId: Array.isArray(s.event) ? s.event[0] : s.event || '',
      })),
      pagination: { hasMore: offset + limit < totalCount, totalCount },
    };
  },
});
