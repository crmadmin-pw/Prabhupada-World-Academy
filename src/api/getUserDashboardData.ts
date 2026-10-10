import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries } from '@/lib/backend-sdk';
import { computeStreak, daysAgo } from '../lib/streakUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwScoreFromFieldValues } from '@/lib/pwSadhana';
import { DASHBOARD_HISTORY_MAX_DAYS, DASHBOARD_RECENT_DAYS } from '@/lib/sadhanaHistoryWindow';

// Minimal field sets
const USER_FIELDS = ['id', 'userId', 'fullName', 'email', 'ashrayLevel', 'residencyApproved', 'segment', 'isPrabhupadaWorldUser'];
const ENTRY_FIELDS = ['id', 'entryId', 'user', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'flagSick', 'flagOs', 'submittedAt', 'templateMode', 'ashrayLevelUsed', 'fieldValuesJson',
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
    /** Exclusive cursor. Set only when the caller asks for the previous window. */
    before: z.string().max(10).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Use IST (UTC+5:30) for "today" — server runs UTC but all users are in India
    const todayStr = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

    const requestedBefore = typeof input.before === 'string' ? input.before.slice(0, 10) : '';
    const before = /^\d{4}-\d{2}-\d{2}$/.test(requestedBefore) && requestedBefore <= todayStr
      ? requestedBefore
      : '';
    const requestedDays = typeof input.days === 'number' && Number.isFinite(input.days) && input.days > 0
      ? Math.floor(input.days)
      : DASHBOARD_RECENT_DAYS;
    // Opening the dashboard always covers the streak window. A larger `days`
    // value, or `before`, is how a caller asks for more — never the full history.
    const windowDays = Math.min(
      DASHBOARD_HISTORY_MAX_DAYS,
      before ? requestedDays : Math.max(DASHBOARD_RECENT_DAYS, requestedDays),
    );
    const windowEnd = before ? daysAgo(before, 1) : todayStr;
    const windowStart = daysAgo(windowEnd, windowDays);
    // One row per day, plus a little room for duplicate same-day writes.
    const entryCap = Math.min(windowDays + 15, DASHBOARD_HISTORY_MAX_DAYS + 15);
    const entryDate = before
      ? { gte: windowStart, lt: before }
      : { gte: windowStart, lte: todayStr };
    const authenticatedUserId = context.user.id;
    const requestedUserId = typeof input.userId === 'string' ? input.userId : '';
    const userRecord = await Users.findOne({ id: authenticatedUserId, fields: USER_FIELDS });
    const requestedUserRecord = requestedUserId
      ? await Users.findOne({ id: requestedUserId, fields: USER_FIELDS })
        || await Users.findOne({ filters: { userId: requestedUserId }, fields: USER_FIELDS })
        || await Users.findOne({ filters: { email: requestedUserId }, fields: USER_FIELDS })
      : null;
    const contextEmail = String(context.user.email || '').toLowerCase();
    const requestedBelongsToCurrentUser = !!requestedUserRecord && (
      requestedUserRecord.id === authenticatedUserId ||
      requestedUserRecord.userId === userRecord?.userId ||
      String(requestedUserRecord.email || '').toLowerCase() === contextEmail
    );
    const requestIdBelongsToCurrentUser = !!requestedUserId && (
      requestedUserId === authenticatedUserId ||
      requestedUserId === context.user.uid ||
      requestedUserId === userRecord?.userId ||
      requestedBelongsToCurrentUser
    );
    const ownerIds = [...new Set([
      authenticatedUserId,
      context.user.uid,
      userRecord?.id,
      userRecord?.userId,
      ...(requestIdBelongsToCurrentUser ? [requestedUserId] : []),
      ...(requestedBelongsToCurrentUser ? [requestedUserRecord?.id, requestedUserRecord?.userId] : []),
    ].filter(Boolean).map(String))];

    // user + entryDate is indexed in firestore.indexes.json. Bound every read
    // so a long-time member does not download their whole history on open.
    const entryResults = await Promise.all(ownerIds.map(ownerId =>
      SadhanaEntries.findAll({
        filters: { user: ownerId, entryDate },
        fields: ENTRY_FIELDS,
        sorts: [{ field: 'entryDate', dir: 'desc' }],
        limit: entryCap,
      })
    ));

    // Prefer records already owned by the authenticated user if a date appears
    // in both locations.  This makes legacy entries visible without double
    // counting them in the calendar, weekly totals, or streak.
    const entriesByDate = new Map<string, any>();
    for (const result of entryResults) {
      for (const entry of result.records) {
        const dateKey = String(entry.entryDate || '').slice(0, 10);
        if (!dateKey || dateKey < windowStart || dateKey > windowEnd) continue;
        const existing = entriesByDate.get(dateKey);
        if (!existing || entry.user === authenticatedUserId) {
          entriesByDate.set(dateKey, entry);
        }
      }
    }
    const entries = Array.from(entriesByDate.values());

    const isPw = isPwSadhanaUser(userRecord || context.user);
    // For residents: apply scorePercent correction immediately so all downstream calcs use it
    const correctedEntries = entries.map(e => {
      if (isPw) {
        return { ...e, scorePercent: pwScoreFromFieldValues(e.fieldValuesJson).scorePercent, totalScore: null };
      }
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

    const oldestReturned = sorted.reduce((oldest, entry) => {
      const date = String(entry.entryDate || '').slice(0, 10);
      return date && date < oldest ? date : oldest;
    }, windowEnd);
    const truncated = entryResults.some(result => result.hasMore);

    return {
      windowStart: truncated ? oldestReturned : windowStart,
      windowEnd,
      hasMore: truncated,
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
      recentEntries: sorted.map(e => {
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
        } else {
          // Non-Resident score percent (max 20 points)
          const dbTotal = Number(e.totalScore) || 0;
          const dbMax = Math.max(Number(e.maxScore) || 20, 1);
          scorePercent = Math.min(100, Math.round((dbTotal / dbMax) * 100));
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
