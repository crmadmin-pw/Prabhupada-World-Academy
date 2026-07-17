import { z } from 'zod';
import { createEndpoint, AttendanceRecords, AttendanceSessions, AttendanceEvents } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get attendance calendar data for the current user',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const userId = context.user.id;

    const { records } = await AttendanceRecords.findAll({
      filters: { user: userId },
      limit: 2000,
      fields: ['id', 'session', 'date'],
    });

    // Get unique session IDs
    const sessionIds = [...new Set(records.map(r => Array.isArray(r.session) ? r.session[0] : r.session).filter(Boolean))] as string[];

    // Fetch session and event details
    const sessionMap = new Map<string, { name: string; eventId?: string }>();
    const eventIds = new Set<string>();

    if (sessionIds.length > 0) {
      for (let i = 0; i < sessionIds.length; i += 100) {
        const batch = sessionIds.slice(i, i + 100);
        const { records: sessions } = await AttendanceSessions.findAll({
          filters: { id: { in: batch } } as any,
          fields: ['id', 'name', 'event'],
          limit: 100,
        });
        sessions.forEach(s => {
          const eid = Array.isArray(s.event) ? s.event[0] : s.event;
          sessionMap.set(s.id, { name: s.name || '', eventId: eid });
          if (eid) eventIds.add(eid);
        });
      }
    }

    const eventMap = new Map<string, string>();
    if (eventIds.size > 0) {
      const { records: events } = await AttendanceEvents.findAll({
        filters: { id: { in: [...eventIds] } } as any,
        fields: ['id', 'title'],
        limit: 100,
      });
      events.forEach(e => eventMap.set(e.id, e.title || ''));
    }

    // Sort by date desc
    records.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const entries = records.map(r => {
      const sid = (Array.isArray(r.session) ? r.session[0] : r.session) as string;
      const session = sessionMap.get(sid);
      return {
        date: r.date || '',
        sessionName: session?.name || '',
        eventTitle: session?.eventId ? eventMap.get(session.eventId) || '' : '',
      };
    });

    // Calculate stats
    const uniqueDates = new Set(entries.map(e => e.date));
    const totalDaysAttended = uniqueDates.size;

    // Current streak
    const sortedDates = [...uniqueDates].sort().reverse();
    let currentStreak = 0;
    const today = new Date();
    const checkDate = new Date(today);
    checkDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toISOString().slice(0, 10);
      if (sortedDates.includes(dateStr)) {
        currentStreak++;
      } else if (i > 0) {
        break; // Allow today to be missing (streak from yesterday)
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // This month count
    const thisMonth = today.toISOString().slice(0, 7);
    const thisMonthCount = [...uniqueDates].filter(d => d.startsWith(thisMonth)).length;

    // Longest streak
    const allDates = [...uniqueDates].sort();
    let longestStreak = 0;
    let streak = 0;
    for (let i = 0; i < allDates.length; i++) {
      if (i === 0) { streak = 1; }
      else {
        const prev = new Date(allDates[i - 1]);
        const curr = new Date(allDates[i]);
        const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        streak = diff === 1 ? streak + 1 : 1;
      }
      longestStreak = Math.max(longestStreak, streak);
    }

    return {
      entries,
      stats: { totalDaysAttended, currentStreak, thisMonthCount, longestStreak },
    };
  },
});
