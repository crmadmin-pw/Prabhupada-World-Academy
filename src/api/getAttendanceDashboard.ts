import { z } from 'zod';
import {
  createEndpoint, ZiteError, AttendanceEvents, AttendanceSessions,
  AttendanceRecords, AttendanceParticipants, AttendanceVolunteers, Users,
} from 'zite-integrations-backend-sdk';

const ADMIN_ROLES = ['Guide', 'Super Guide', 'BVSL'];

export default createEndpoint({
  authenticated: true,
  description: 'Get attendance dashboard data with filters',
  inputSchema: z.object({
    eventId: z.string().optional(),
    sessionId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    search: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  outputSchema: z.object({
    records: z.array(z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string(),
      sessionName: z.string(),
      date: z.string(),
      source: z.string(),
    })),
    totalCount: z.number(),
    uniqueParticipants: z.number(),
    events: z.array(z.object({ id: z.string(), title: z.string() })),
    sessions: z.array(z.object({ id: z.string(), name: z.string(), eventId: z.string() })),
    hasMore: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const role = context.user.role || '';
    const isAdmin = ADMIN_ROLES.includes(role) || context.user.isBvsl;

    // Get volunteer sessions if not admin
    let allowedSessionIds: string[] | null = null;
    if (!isAdmin) {
      const { records: vols } = await AttendanceVolunteers.findAll({ filters: { user: context.user.id }, limit: 100 });
      if (vols.length === 0) throw new ZiteError({ code: 'FORBIDDEN', message: 'Not authorized' });
      allowedSessionIds = vols.map(v => (Array.isArray(v.session) ? v.session[0] : v.session) as string).filter(Boolean);
    }

    // Fetch all data
    const [eventsRes, sessionsRes] = await Promise.all([
      AttendanceEvents.findAll({ limit: 200 }),
      AttendanceSessions.findAll({ limit: 500 }),
    ]);

    // Build session map
    const sessionMap = new Map(sessionsRes.records.map(s => [s.id, s]));

    // Build record filters
    const filters: any = {};
    if (input.sessionId) filters.session = input.sessionId;
    if (input.startDate) filters.date = { ...(filters.date || {}), gte: input.startDate };
    if (input.endDate) filters.date = { ...(filters.date || {}), lte: input.endDate };

    const { records: allRecords } = await AttendanceRecords.findAll({ filters, limit: 2000 });

    // Gather user/participant IDs
    const userIds = new Set<string>();
    const partIds = new Set<string>();
    for (const r of allRecords) {
      const uid = Array.isArray(r.user) ? r.user[0] : r.user;
      const pid = Array.isArray(r.participant) ? r.participant[0] : r.participant;
      if (uid) userIds.add(uid);
      if (pid) partIds.add(pid);
    }

    // Fetch names
    const userMap = new Map<string, { name: string; phone: string }>();
    if (userIds.size > 0) {
      const { records: users } = await Users.findAll({ filters: { id: { in: Array.from(userIds) } }, limit: 500, fields: ['fullName', 'phone'] });
      for (const u of users) userMap.set(u.id, { name: u.fullName || '', phone: u.phone || '' });
    }
    const partMap = new Map<string, { name: string; phone: string }>();
    if (partIds.size > 0) {
      const { records: parts } = await AttendanceParticipants.findAll({ filters: { id: { in: Array.from(partIds) } }, limit: 500, fields: ['name', 'phone'] });
      for (const p of parts) partMap.set(p.id, { name: p.name || '', phone: p.phone || '' });
    }

    // Filter by event, allowed sessions, search
    let filtered = allRecords.map(r => {
      const sid = (Array.isArray(r.session) ? r.session[0] : r.session) as string;
      const uid = (Array.isArray(r.user) ? r.user[0] : r.user) as string;
      const pid = (Array.isArray(r.participant) ? r.participant[0] : r.participant) as string;
      const userInfo = uid ? userMap.get(uid) : undefined;
      const partInfo = pid ? partMap.get(pid) : undefined;
      const sess = sessionMap.get(sid);
      const eventId = sess ? (Array.isArray(sess.event) ? sess.event[0] : sess.event) as string : '';
      return {
        id: r.id,
        name: userInfo?.name || partInfo?.name || '',
        phone: userInfo?.phone || partInfo?.phone || '',
        sessionName: sess?.name || '',
        sessionId: sid,
        eventId,
        date: r.date || '',
        source: r.source || '',
      };
    });

    if (allowedSessionIds) {
      filtered = filtered.filter(r => allowedSessionIds!.includes(r.sessionId));
    }
    if (input.eventId) {
      filtered = filtered.filter(r => r.eventId === input.eventId);
    }
    if (input.search) {
      const q = input.search.toLowerCase();
      filtered = filtered.filter(r => r.name.toLowerCase().includes(q) || r.phone.includes(q));
    }

    // Sort by date desc
    filtered.sort((a, b) => b.date.localeCompare(a.date));

    const uniquePhones = new Set(filtered.map(r => r.phone).filter(Boolean));
    const total = filtered.length;
    const offset = input.offset || 0;
    const limit = input.limit || 25;
    const page = filtered.slice(offset, offset + limit);

    return {
      records: page.map(r => ({ id: r.id, name: r.name, phone: r.phone, sessionName: r.sessionName, date: r.date, source: r.source })),
      totalCount: total,
      uniqueParticipants: uniquePhones.size,
      events: eventsRes.records.map(e => ({ id: e.id, title: e.title || '' })),
      sessions: sessionsRes.records.map(s => ({ id: s.id, name: s.name || '', eventId: (Array.isArray(s.event) ? s.event[0] : s.event) as string || '' })),
      hasMore: offset + limit < total,
    };
  },
});
