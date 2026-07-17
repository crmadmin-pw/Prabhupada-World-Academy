import { z } from 'zod';
import { createEndpoint, SadhanaEntries } from 'zite-integrations-backend-sdk';
import { computeStreak, getTodayIST, daysAgo } from '../lib/streakUtils';

function getISOWeekStartEnd(date: Date): { start: string; end: string } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
  };
}

export default createEndpoint({
  description: 'Get sadhana metrics for the current user (optimized)',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const todayStr = getTodayIST();
    const windowStart = daysAgo(todayStr, 100);

    const { records: entries } = await SadhanaEntries.findAll({
      filters: {
        user: context.user!.id,
        entryDate: { gte: windowStart, lte: todayStr },
      } as any,
      fields: ['id', 'entryDate', 'totalScore', 'maxScore', 'scorePercent', 'entryId'],
      limit: 110,
    });

    const sorted = [...entries].sort((a, b) => (b.entryDate || '').localeCompare(a.entryDate || ''));
    const todayEntry = sorted.find(e => e.entryDate?.slice(0, 10) === todayStr);

    const { start: weekStart, end: weekEnd } = getISOWeekStartEnd(new Date());
    const weekEntries = sorted.filter(e => {
      const d = (e.entryDate || '').slice(0, 10);
      return d >= weekStart && d <= weekEnd;
    });

    const weeklyAveragePercent = weekEntries.length > 0
      ? Math.round(weekEntries.reduce((s, e) => s + (e.scorePercent ?? 0), 0) / 7)
      : null;
    const weeklyAverage = weekEntries.length > 0
      ? Math.round(weekEntries.reduce((s, e) => s + (e.totalScore ?? 0), 0) / 7)
      : 0;

    // Compute streak from actual entries — accurate SSOT, no stale stored values
    const streak = computeStreak(entries as any[], todayStr);

    return {
      todayScore: todayEntry?.totalScore ?? null,
      todayPercent: todayEntry?.scorePercent ?? null,
      todaySubmitted: !!todayEntry,
      todayEntryId: todayEntry?.entryId ?? null,
      currentStreak: streak,
      weeklyAverage,
      weeklyAveragePercent,
      weeklySubmissionRate: weekEntries.length / 7,
      entriesThisWeek: weekEntries.length,
      streakAtRisk: !todayEntry && streak > 0,
    };
  },
});
