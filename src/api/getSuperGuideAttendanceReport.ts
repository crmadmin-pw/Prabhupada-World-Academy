import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy, isHierarchySuperAdmin } from '../lib/hierarchyUtils';
import { createEndpoint, Users, AttendanceRecords, AttendanceSessions, AttendanceEvents, BvAttendance, Guides, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { bvUserAliases, resolveBvDepartmentGroups, resolveBvScopedGroups, resolveBvUsersByAliases } from '@/lib/bvGroupMemberScope';

import getGuides from './getGuides';

export default createEndpoint({
  description: 'Get attendance report for Super Guide (all users, all centers)',
  authenticated: true,
  requiredCapabilities: 'attendance.manage',
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
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    const userRole = (context.user?.role || '').toUpperCase();
    const userEmail = (context.user?.email || '').toLowerCase();
    const isAllowed = userRole === 'GUIDE' || userRole === 'SUPER_GUIDE' || userRole === 'SUPER GUIDE' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'PW_ADMIN' || userRole === 'BVSL' || !!(context.user as any)?.isBvAdmin || !!(context.user as any)?.isBvSuperAdmin || !!(context.user as any)?.isPwAdmin || !!(context.user as any)?.isBvsl;
    if (!isAllowed) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Super Guides and Admins only' });
    }

    const isSuperGuide = userRole === 'SUPER_GUIDE' ||
      userRole === 'SUPER GUIDE' ||
      userRole === 'SUPER_ADMIN' ||
      !!context.user?.isBvSuperAdmin;

    let guideDbId: string | null = input.guideId === 'ALL' ? null : (input.guideId || null);
    if (!isSuperGuide) {
      const guideRecord = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] }).catch(() => null);
      if (guideRecord) {
        guideDbId = (guideRecord as any).id;
      } else {
        guideDbId = context.user.id;
      }
    }

    const hierarchy = await getScopedHierarchyUserIds(context.user);
    // Hierarchical admins include indirect members, not just Users.guide.
    if (!isHierarchySuperAdmin(context.user)) guideDbId = null;
    const limit = Math.min(input.limit || 50, 200);
    const offset = input.offset || 0;

    // Fetch lookup data in parallel
    const [eventsRes, sessionsRes, guidesListRes, centersRes] = await Promise.all([
      AttendanceEvents.findAll({ filters: {}, limit: 200, fields: ['id', 'title'] }),
      AttendanceSessions.findAll({ filters: {}, limit: 500, fields: ['id', 'name', 'event', 'shareToken'] }),
      getGuides.execute({ input: { segment: input.segment }, context }),
      FolkResidencies.findAll({ filters: { isActive: true } as any, limit: 100, fields: ['id', 'residencyName'] }),
    ]);

    const guideOptions = (guidesListRes.guides || []).map((g: any) => ({ id: g.guideId, name: g.name }));

    const eventMap = new Map(eventsRes.records.map(e => [e.id, e.title || '']));
    const sessionMap = new Map(sessionsRes.records.map(s => [s.id, { name: s.name || '', eventId: Array.isArray(s.event) ? s.event[0] : s.event }]));
    const guideMap = new Map((guidesListRes.guides || []).map((g: any) => [g.guideId, g.name]));
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
    if (guideDbId || input.residencyId || input.ashrayLevel || input.search) {
      const userFilters: any = {};
      if (guideDbId) userFilters.guide = guideDbId;
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
      recFilters.user = { in: scopedUserIds };
    }

    // Generic attendance is scoped by the Users.guide relation. BV attendance
    // belongs to a reading group instead, and many historical rows store a
    // public userId/email rather than a Firestore Users document ID. Resolve
    // the permitted groups and member aliases independently.
    const bvSegment = input.segment || 'PW';
    const bvGroups = isSuperGuide
      ? await resolveBvDepartmentGroups(bvSegment)
      : await resolveBvScopedGroups(context.user, { segment: bvSegment });
    const bvGroupAliases = new Set(bvGroups.flatMap(group => [group.id, group.groupId]).map(value => String(value).toLowerCase()));
    const bvAttFilters: any = { present: true };
    if (input.startDate) bvAttFilters.attendanceDate = { ...(bvAttFilters.attendanceDate || {}), gte: input.startDate };
    if (input.endDate) bvAttFilters.attendanceDate = { ...(bvAttFilters.attendanceDate || {}), lte: input.endDate };

    const [stdRes, bvRes] = await Promise.all([
      AttendanceRecords.findAll({
        filters: recFilters,
        limit: 2000,
        fields: ['id', 'session', 'date', 'user', 'source'],
      }),
      // BV rows do not use AttendanceEvents/AttendanceSessions, so an Event
      // or Session filter intentionally limits this report to generic check-ins.
      (input.eventId || input.sessionId || bvGroupAliases.size === 0)
        ? Promise.resolve({ records: [] })
        : BvAttendance.findAll({
        filters: bvAttFilters as any,
        limit: 2000,
        fields: ['id', 'attendanceDate', 'user', 'sessionTopic', 'group', 'groupId'],
      }).catch(() => ({ records: [] })),
    ]);

    const scopedBvRows = (bvRes.records || []).filter((record: any) => {
      const groupReferences = [record.group, record.groupId].flatMap(value => Array.isArray(value) ? value : [value]);
      return groupReferences.some(value => bvGroupAliases.has(String(value || '').trim().toLowerCase()));
    });
    const bvUsers = await resolveBvUsersByAliases(
      scopedBvRows.flatMap((record: any) => Array.isArray(record.user) ? record.user : [record.user]).filter(Boolean).map(String),
      ['id', 'userId', 'email', 'fullName', 'phone', 'ashrayLevel', 'guide', 'residency'],
    );
    const bvUserByAlias = new Map<string, any>();
    for (const user of bvUsers) {
      for (const alias of bvUserAliases(user)) bvUserByAlias.set(alias, user);
    }
    const matchesBvUserFilters = (user: any) => {
      const guide = Array.isArray(user?.guide) ? user.guide[0] : user?.guide;
      const residency = Array.isArray(user?.residency) ? user.residency[0] : user?.residency;
      const name = String(user?.fullName || '').toLowerCase();
      const phone = String(user?.phone || '');
      return (!input.ashrayLevel || user?.ashrayLevel === input.ashrayLevel) &&
        (!input.residencyId || residency === input.residencyId) &&
        // A selected Admin/Guide is an explicit super-admin filter. Regular
        // admins are already restricted by their permitted BV groups above.
        (!isSuperGuide || !guideDbId || guide === guideDbId) &&
        (!input.search || name.includes(String(input.search).toLowerCase()) || phone.includes(String(input.search)));
    };
    const formattedBvRecords = scopedBvRows.flatMap((b: any) => {
      const storedUser = String(Array.isArray(b.user) ? b.user[0] : b.user || '').trim().toLowerCase();
      const user = bvUserByAlias.get(storedUser);
      if (!user || !matchesBvUserFilters(user)) return [];
      return [{
        id: b.id,
        session: '',
        sessionName: b.sessionTopic || 'Bhakti Vriksha Session',
        date: b.attendanceDate,
        user: user.id,
        source: 'Bhakti Vriksha',
        isBv: true,
      }];
    });

    const allRecords = [...stdRes.records, ...formattedBvRecords];

    allRecords.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Need user details for all records
    const recordUserIds = [...new Set(allRecords.map(r => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];

    // Fetch user details in batches
    const userDetails = new Map<string, any>(bvUsers.map((user: any) => [user.id, user]));
    for (let i = 0; i < recordUserIds.length; i += 100) {
      const batch = recordUserIds.slice(i, i + 100);
      const { records: batchUsers } = await Users.findAll({
        filters: { id: { in: batch } } as any,
        fields: ['id', 'fullName', 'phone', 'ashrayLevel', 'guide', 'residency'],
        limit: 100,
      });
      batchUsers.forEach(u => userDetails.set(u.id, u));
    }

    // Filter out unknown/dummy users
    const validRecords = allRecords.filter(r => {
      const uid = (Array.isArray(r.user) ? r.user[0] : r.user) as string;
      const u = userDetails.get(uid);
      // Historical BV attendance is owned by the permitted group. Its member
      // may since have left; this grants access to that attendance row only,
      // not to the member's current profile or other reports.
      if (!u || (!isUserInHierarchy(u, hierarchy) && !(r as any).isBv)) return false;
      const n = (u.fullName || '').toLowerCase();
      if (!n || n === 'null' || n === 'undefined' || n === 'unknown') return false;
      return true;
    });

    // Stats
    const uniqueUsers = new Set(validRecords.map(r => Array.isArray(r.user) ? r.user[0] : r.user));
    const levelCounts: Record<string, number> = {};
    const centerCounts: Record<string, number> = {};
    for (const uid of uniqueUsers) {
      const u = userDetails.get(uid as string);
      if (!u) continue;
      const level = u.ashrayLevel || 'Unknown';
      levelCounts[level] = (levelCounts[level] || 0) + 1;
      const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const cName = rid ? centerMap.get(rid) || 'Unknown' : 'No Center';
      centerCounts[cName] = (centerCounts[cName] || 0) + 1;
    }

    const totalCount = validRecords.length;
    const paged = validRecords.slice(offset, offset + limit);

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
        sessionName: r.isBv ? r.sessionName : session?.name || '',
        eventTitle: r.isBv ? 'Bhakti Vriksha' : session?.eventId ? eventMap.get(session.eventId) || '' : '',
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
        guides: (guidesListRes.guides || []).map((g: any) => ({
          id: g.guideId || g.id,
          name: g.name,
          isPrabhupadaWorldMentor: !!g.isPrabhupadaWorldMentor,
        })),
        centers: centersRes.records.filter(c => hierarchy === null || [...userDetails.values()].some(u => isUserInHierarchy(u, hierarchy) && [u.residency].flat().includes(c.id))).map(c => ({ id: c.id, name: c.residencyName || '' })),
        events: eventsRes.records.map(e => ({ id: e.id, title: e.title || '' })),
        sessions: sessionsRes.records.map(s => ({ id: s.id, name: s.name || '', eventId: (Array.isArray(s.event) ? s.event[0] : s.event) || '', shareToken: s.shareToken || '' })),
      },
      pagination: { hasMore: offset + limit < totalCount, totalCount },
    };
  },
});
