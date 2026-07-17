import { z } from 'zod';
import {
  createEndpoint, ZiteError, AttendanceEvents, AttendanceSessions, AttendanceRecords,
} from 'zite-integrations-backend-sdk';

const ADMIN_ROLES = ['Guide', 'Super Guide', 'BVSL'];

export default createEndpoint({
  authenticated: true,
  description: 'Get all attendance events with session counts for admin',
  inputSchema: z.object({}),
  outputSchema: z.object({
    events: z.array(z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      customFields: z.string(),
      createdAt: z.string(),
      sessions: z.array(z.object({
        id: z.string(),
        name: z.string(),
        shareToken: z.string(),
        challengeEnabled: z.boolean(),
        challengeTitle: z.string(),
        challengeDays: z.number(),
        attendeeCount: z.number(),
      })),
    })),
  }),
  execute: async ({ context }) => {
    const role = context.user.role || '';
    const isBvsl = context.user.isBvsl;
    if (!ADMIN_ROLES.includes(role) && !isBvsl) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Not authorized' });
    }

    const { records: events } = await AttendanceEvents.findAll({ limit: 100 });
    const { records: sessions } = await AttendanceSessions.findAll({ limit: 500 });
    const { records: records } = await AttendanceRecords.findAll({ limit: 2000 });

    const sessionsByEvent = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const eId = Array.isArray(s.event) ? s.event[0] : s.event;
      if (!eId) continue;
      if (!sessionsByEvent.has(eId)) sessionsByEvent.set(eId, []);
      sessionsByEvent.get(eId)!.push(s);
    }

    const countBySession = new Map<string, number>();
    for (const r of records) {
      const sId = Array.isArray(r.session) ? r.session[0] : r.session;
      if (!sId) continue;
      countBySession.set(sId, (countBySession.get(sId) || 0) + 1);
    }

    return {
      events: events.map(e => ({
        id: e.id,
        title: e.title || '',
        description: e.description || '',
        startDate: e.startDate || '',
        endDate: e.endDate || '',
        customFields: e.customFields || '[]',
        createdAt: e.createdAt || '',
        sessions: (sessionsByEvent.get(e.id) || []).map(s => ({
          id: s.id,
          name: s.name || '',
          shareToken: s.shareToken || '',
          challengeEnabled: s.challengeEnabled || false,
          challengeTitle: s.challengeTitle || '',
          challengeDays: s.challengeDays || 7,
          attendeeCount: countBySession.get(s.id) || 0,
        })),
      })),
    };
  },
});
