import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries } from 'zite-integrations-backend-sdk';
import { computeStreak, daysAgo } from '../lib/streakUtils';

// Minimal field sets
const USER_FIELDS = ['id', 'fullName', 'ashrayLevel', 'residencyApproved'];
const ENTRY_FIELDS = ['id', 'entryId', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'flagSick', 'flagOs', 'submittedAt', 'templateMode', 'ashrayLevelUsed',
  'maNaGvPoints', 'quotesTulasiPoints', 'japaVisiblePoints', 'sbPoints',
  'cleanlinessPoints', 'reportSendingPoints', 'dailyServicePoints',
  'roundsPoints', 'spReadingPoints', 'sleepQualityPoints'];

function getISOWeekStartEnd(date: Date): { start: string; end: string; weekNum: number } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  const jan4 = new Date(mon.getFullYear(), 0, 4);
  const startW1 = new Date(jan4);
  const jan4Day = jan4.getDay() === 0 ? 7 : jan4.getDay();
  startW1.setDate(jan4.getDate() - (jan4Day - 1));
  const weekNum = Math.round((mon.getTime() - startW1.getTime()) / (7 * 86400000)) + 1;
  return {
    start: mon.toISOString().split('T')[0],
    end: sun.toISOString().split('T')[0],
    weekNum,
  };
}

export default createEndpoint({
  description: 'Get user dashboard data — metrics and recent entries (optimized)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    days: z.number().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Use IST (UTC+5:30) for "today" — server runs UTC but all users are in India
    const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

    const streakStart = daysAgo(todayStr, 100);
    const [userRecord, { records: entries }] = await Promise.all([
      Users.findOne({ id: context.user.id, fields: USER_FIELDS }),
      SadhanaEntries.findAll({
        filters: { user: context.user.id, entryDate: { gte: streakStart, lte: todayStr } } as any,
        fields: ENTRY_FIELDS,
        limit: 110,
      }),
    ]);

    // For residents: apply scorePercent correction immediately so all downstream calcs use it
    const correctedEntries = entries.map(e => {
      const isNR = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');
      if (isNR) return e;
      const colSum = Number(e.maNaGvPoints ?? 0) + Number(e.quotesTulasiPoints ?? 0) +
        Number(e.japaVisiblePoints ?? 0) + Number(e.sbPoints ?? 0) +
        Number(e.cleanlinessPoints ?? 0) + Number(e.reportSendingPoints ?? 0) +
        Number(e.dailyServicePoints ?? 0) + Number(e.roundsPoints ?? 0) +
        Number(e.spReadingPoints ?? 0) + Number(e.sleepQualityPoints ?? 0);
      const bestTotal = Math.max(colSum, Number(e.totalScore) || 0);
      const eMax = Math.max(Number(e.maxScore) || 20, 1);
      return { ...e, scorePercent: Math.min(100, Math.round((bestTotal / eMax) * 100)) };
    });
    const sorted = [...correctedEntries].sort((a, b) =>
      (b.entryDate || '').localeCompare(a.entryDate || '')
    );
    const todayEntry = sorted.find(e => e.entryDate?.slice(0, 10) === todayStr);

    const currentStreak = computeStreak(correctedEntries, todayStr);

    // Use current ISO week (Mon–Sun)
    const { start: weekStart, end: weekEnd, weekNum } = getISOWeekStartEnd(new Date());
    const weekEntries = sorted.filter(e => {
      const d = (e.entryDate || '').slice(0, 10);
      return d >= weekStart && d <= weekEnd;
    });

    // Weekly average = sum of all scores / 7 (full week denominator, not just submitted days)
    // This shows the true average accounting for missed days
    const pctEntries = weekEntries.filter(e => e.scorePercent != null);
    const weeklyAveragePercent = pctEntries.length > 0
      ? Math.round(pctEntries.reduce((s, e) => s + (e.scorePercent ?? 0), 0) / 7)
      : null;
    const weeklyAverage = weekEntries.length > 0
      ? Math.round(weekEntries.reduce((s, e) => s + (e.totalScore ?? 0), 0) / 7)
      : 0;

    return {
      metrics: {
        todayScore: todayEntry?.totalScore ?? null,
        todayPercent: todayEntry?.scorePercent ?? null,
        todaySubmitted: !!todayEntry,
        todayEntryId: todayEntry?.entryId ?? null,
        todayRowId: todayEntry?.id ?? null,
        currentStreak,
        weeklyAverage,
        weeklyAveragePercent,
        weeklySubmissionRate: weekEntries.length / 7,
        entriesThisWeek: weekEntries.length,
        weekNumber: weekNum,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        streakAtRisk: !todayEntry && currentStreak > 0,
      },
      recentEntries: sorted.slice(0, 45).map(e => {
        // For residents: recalculate scorePercent using MAX(column sum, DB total)
        // so manual edits to individual point columns are reflected correctly
        const isNR = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');
        let scorePercent = e.scorePercent ?? null;
        if (!isNR) {
          const colSum = Number(e.maNaGvPoints ?? 0) + Number(e.quotesTulasiPoints ?? 0) +
            Number(e.japaVisiblePoints ?? 0) + Number(e.sbPoints ?? 0) +
            Number(e.cleanlinessPoints ?? 0) + Number(e.reportSendingPoints ?? 0) +
            Number(e.dailyServicePoints ?? 0) + Number(e.roundsPoints ?? 0) +
            Number(e.spReadingPoints ?? 0) + Number(e.sleepQualityPoints ?? 0);
          const bestTotal = Math.max(colSum, Number(e.totalScore) || 0);
          const dbMax = Math.max(Number(e.maxScore) || 20, 1);
          scorePercent = Math.min(100, Math.round((bestTotal / dbMax) * 100));
        }
        return {
          entryId: e.entryId || e.id,
          rowId: e.id,
          entryDate: (e.entryDate || '').slice(0, 10),
          totalScore: e.totalScore ?? 0,
          maxScore: e.maxScore ?? 0,
          scorePercent,
          flagSick: e.flagSick || false,
          flagOs: e.flagOs || false,
          submittedAt: e.submittedAt || '',
        };
      }),
      user: {
        fullName: userRecord?.fullName || '',
        ashrayLevel: userRecord?.ashrayLevel || '',
        residencyApproved: userRecord?.residencyApproved || false,
      },
    };
  },
});
