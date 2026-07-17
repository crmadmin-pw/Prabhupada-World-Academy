import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, BvAttendance } from 'zite-integrations-backend-sdk';

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split('T')[0];
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

export default createEndpoint({
  description: 'Get sadhana/preaching context for a one-to-one meeting preparation',
  authenticated: true,
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const startDate = daysAgoStr(28);
    const today = new Date().toISOString().split('T')[0];

    const [user, entriesRes, bvRes] = await Promise.all([
      Users.findOne({ id: input.userId, fields: ['id', 'fullName', 'currentStreak', 'ashrayLevel', 'residencyApproved'] }),
      SadhanaEntries.findAll({
        filters: { user: input.userId, entryDate: { gte: startDate, lte: today } } as any,
        fields: ['id', 'entryDate', 'scorePercent', 'totalScore', 'maxScore', 'templateMode',
          'roundsCount', 'spReadingMinutes', 'preachingMinutes', 'booksDistributed',
          'nrChantingRounds', 'nrReadingMinutes', 'nrHearingMinutes', 'flagSick', 'flagOs'],
        limit: 200,
      }),
      BvAttendance.findAll({
        filters: { user: input.userId, present: true, attendanceDate: { gte: startDate, lte: today } } as any,
        fields: ['id', 'present'],
        limit: 100,
      }),
    ]);

    const isResident = user?.residencyApproved || false;

    // Group entries by week
    const weekMap = new Map<string, typeof entriesRes.records>();
    for (const e of entriesRes.records) {
      const monday = getMondayOfWeek(String(e.entryDate || today));
      if (!weekMap.has(monday)) weekMap.set(monday, []);
      weekMap.get(monday)!.push(e);
    }

    // Generate last 4 Mondays (oldest → newest)
    const currMonday = getMondayOfWeek(today);
    const mondays = Array.from({ length: 4 }, (_, i) => {
      const d = new Date(currMonday + 'T00:00:00');
      d.setDate(d.getDate() - (3 - i) * 7);
      return d.toISOString().split('T')[0];
    });

    const weeks = mondays.map(monday => {
      const entries = weekMap.get(monday) || [];
      if (entries.length === 0) return { weekDate: monday, scorePercent: null, entryCount: 0, rounds: null, readingMins: null, hearingMins: null, preachingMins: 0, books: 0 };
      const src = entries.filter(e => !e.flagSick && !e.flagOs);
      const base = src.length > 0 ? src : entries;
      const n = base.length;
      const earned = entries.reduce((s, e) => s + (Number(e.totalScore) || 0), 0);
      const maxTotal = entries.reduce((s, e) => s + (Number(e.maxScore) || 0), 0);
      const scorePercent = maxTotal > 0 ? Math.round((earned / maxTotal) * 100) : null;
      const rounds = isResident ? base.reduce((s, e) => s + (Number(e.roundsCount) || 0), 0) / n : base.reduce((s, e) => s + (Number(e.nrChantingRounds) || 0), 0) / n;
      const readingMins = isResident ? base.reduce((s, e) => s + (Number(e.spReadingMinutes) || 0), 0) / n : base.reduce((s, e) => s + (Number(e.nrReadingMinutes) || 0), 0) / n;
      const hearingMins = !isResident ? base.reduce((s, e) => s + (Number(e.nrHearingMinutes) || 0), 0) / n : null;
      const preachingMins = entries.reduce((s, e) => s + (Number(e.preachingMinutes) || 0), 0);
      const books = entries.reduce((s, e) => s + (Number(e.booksDistributed) || 0), 0);
      return { weekDate: monday, scorePercent, entryCount: entries.length, rounds: Math.round(rounds * 10) / 10, readingMins: Math.round(readingMins), hearingMins: hearingMins !== null ? Math.round(hearingMins) : null, preachingMins, books };
    });

    const filledWeeks = weeks.filter(w => w.scorePercent !== null);
    const avgScore = filledWeeks.length ? filledWeeks.reduce((s, w) => s + (w.scorePercent || 0), 0) / filledWeeks.length : null;
    const avgRounds = weeks.filter(w => w.rounds != null).reduce((s, w) => s + (w.rounds || 0), 0) / (weeks.filter(w => w.rounds != null).length || 1);
    const totalPreachingMins = weeks.reduce((s, w) => s + w.preachingMins, 0);
    const totalBooks = weeks.reduce((s, w) => s + w.books, 0);
    const bvAttendanceCount = bvRes.records.length;

    const improvementAreas: string[] = [];
    if (avgScore !== null && avgScore < 70) improvementAreas.push('Overall Score');
    if (avgRounds < 12) improvementAreas.push('Chanting Rounds');
    if (isResident) { const avgR = weeks.filter(w => w.readingMins != null).reduce((s, w) => s + (w.readingMins || 0), 0) / (weeks.filter(w => w.readingMins != null).length || 1); if (avgR < 15) improvementAreas.push('SP Reading'); }
    if (totalPreachingMins < 60) improvementAreas.push('Preaching');
    if (bvAttendanceCount < 3) improvementAreas.push('BV Attendance');

    return { userName: user?.fullName || '', streak: user?.currentStreak || 0, ashrayLevel: user?.ashrayLevel || null, isResident, weeks, bvAttendanceCount, totalPreachingMins, totalBooks, improvementAreas };
  },
});
