import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '../lib/hierarchyUtils';
import { createEndpoint, Users, SadhanaEntries, BvAttendance } from '@/lib/backend-sdk';
import { getTodayIST, daysAgo } from '../lib/streakUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwScoreFromFieldValues } from '@/lib/pwSadhana';

const USER_IDENTITY_FIELDS = [
  'id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId',
  'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];

function identityAliases(user: any): string[] {
  return [...new Set(USER_IDENTITY_FIELDS
    .flatMap(field => Array.isArray(user?.[field]) ? user[field] : [user?.[field]])
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase())
    .filter(Boolean))];
}

function parseFieldValues(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try { return JSON.parse(String(value)); } catch { return {}; }
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr.split('T')[0] + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split('T')[0];
}

export default createEndpoint({
  description: 'Get sadhana/preaching context for a one-to-one meeting preparation',
  authenticated: true,
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const today = getTodayIST();
    const startDate = daysAgo(today, 28);

    // One-to-one records normally pass the Users document id, but older
    // records can contain the app user id. Resolve it before querying Sadhana
    // and BV attendance so the context never silently shows empty values.
    const user = await Users.findOne({
      id: input.userId,
      fields: [...USER_IDENTITY_FIELDS, 'fullName', 'currentStreak', 'ashrayLevel', 'residencyApproved', 'residencyGuideVerified', 'segment', 'isPrabhupadaWorldUser'],
    }).catch(() => undefined) || await Users.findOne({
      filters: { userId: input.userId },
      fields: [...USER_IDENTITY_FIELDS, 'fullName', 'currentStreak', 'ashrayLevel', 'residencyApproved', 'residencyGuideVerified', 'segment', 'isPrabhupadaWorldUser'],
    }).catch(() => undefined) || await Users.findOne({
      filters: { email: input.userId },
      fields: [...USER_IDENTITY_FIELDS, 'fullName', 'currentStreak', 'ashrayLevel', 'residencyApproved', 'residencyGuideVerified', 'segment', 'isPrabhupadaWorldUser'],
    }).catch(() => undefined);

    if (!user?.id) {
      return {
        userName: '', streak: 0, ashrayLevel: null, isResident: false,
        weeks: [], bvAttendanceCount: 0, totalPreachingMins: 0,
        totalBooks: 0, improvementAreas: [],
      };
    }
    if (!isUserInHierarchy(user, await getScopedHierarchyUserIds(context.user))) throw new Error('This user is not assigned to your hierarchy');
    const userAliases = new Set(identityAliases(user));
    userAliases.add(String(input.userId).trim().toLowerCase());

    const [allEntries, allAttendance] = await Promise.all([
      (async () => {
        const records: any[] = [];
        for (let offset = 0; ; offset += 2000) {
          const page = await SadhanaEntries.findAll({
            // Query by date first to avoid a composite index and then match
            // every supported identity alias in memory.
            filters: { entryDate: { gte: startDate, lte: today } } as any,
            fields: ['id', 'entryDate', 'scorePercent', 'totalScore', 'maxScore', 'templateMode', 'fieldValuesJson',
              'roundsCount', 'spReadingMinutes', 'preachingMinutes', 'booksDistributed',
              'nrChantingRounds', 'nrReadingMinutes', 'nrHearingMinutes', 'flagSick', 'flagOs', 'user'],
            limit: 2000,
            offset,
          });
          records.push(...page.records);
          if (!page.hasMore) return records;
        }
      })(),
      (async () => {
        const records: any[] = [];
        for (let offset = 0; ; offset += 2000) {
          const page = await BvAttendance.findAll({
            filters: { attendanceDate: { gte: startDate, lte: today } } as any,
            fields: ['id', 'user', 'present', 'status', 'attendanceDate'],
            limit: 2000,
            offset,
          });
          records.push(...page.records);
          if (!page.hasMore) return records;
        }
      })(),
    ]);

    const entries = allEntries.filter((entry: any) => {
      const owner = Array.isArray(entry.user) ? entry.user[0] : entry.user;
      return userAliases.has(String(owner || '').trim().toLowerCase());
    });
    const attendance = allAttendance.filter((record: any) => {
      const owner = Array.isArray(record.user) ? record.user[0] : record.user;
      const isPresent = record.present === true || ['present', 'p', 'true', '1'].includes(String(record.status || '').trim().toLowerCase());
      return isPresent && userAliases.has(String(owner || '').trim().toLowerCase());
    });

    const isResident = !!(user.residencyApproved || user.residencyGuideVerified);
    const isPw = isPwSadhanaUser(user);

    // Group entries by week
    const weekMap = new Map<string, typeof entries>();
    for (const e of entries) {
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
      const storedScores = isPw
        ? base.map(entry => pwScoreFromFieldValues(entry.fieldValuesJson).scorePercent).filter((value): value is number => value != null)
        : base.map(e => Number(e.scorePercent)).filter(Number.isFinite);
      const earned = base.reduce((s, e) => s + (Number(e.totalScore) || 0), 0);
      const maxTotal = base.reduce((s, e) => s + (Number(e.maxScore) || 0), 0);
      const scorePercent = storedScores.length > 0
        ? Math.round(storedScores.reduce((sum, score) => sum + score, 0) / storedScores.length)
        : (!isPw && maxTotal > 0 ? Math.round((earned / maxTotal) * 100) : null);
      const rounds = base.reduce((sum, entry) => {
        const fields = parseFieldValues(entry.fieldValuesJson);
        const raw = isResident
          ? entry.roundsCount ?? fields.rounds ?? fields.rounds_count
          : entry.nrChantingRounds ?? fields.chanting ?? fields.rounds ?? entry.roundsCount;
        return sum + (Number(raw) || 0);
      }, 0) / n;
      const readingMins = isPw
        ? base.reduce((s, e) => s + pwScoreFromFieldValues(e.fieldValuesJson).reading, 0) / n
        : isResident ? base.reduce((s, e) => s + (Number(e.spReadingMinutes) || 0), 0) / n : base.reduce((s, e) => s + (Number(e.nrReadingMinutes) || 0), 0) / n;
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
    const bvAttendanceCount = attendance.length;

    const improvementAreas: string[] = [];
    if (isPw) {
      if (avgScore !== null && avgScore < 100) improvementAreas.push('Below the assigned chanting or reading');
    } else {
      if (avgScore !== null && avgScore < 70) improvementAreas.push('Overall Score');
      if (avgRounds < 12) improvementAreas.push('Chanting Rounds');
      if (isResident) { const avgR = weeks.filter(w => w.readingMins != null).reduce((s, w) => s + (w.readingMins || 0), 0) / (weeks.filter(w => w.readingMins != null).length || 1); if (avgR < 15) improvementAreas.push('SP Reading'); }
      if (totalPreachingMins < 60) improvementAreas.push('Preaching');
      if (bvAttendanceCount < 3) improvementAreas.push('BV Attendance');
    }

    return { userName: user?.fullName || '', streak: user?.currentStreak || 0, ashrayLevel: user?.ashrayLevel || null, isResident, isPw, weeks, bvAttendanceCount, totalPreachingMins, totalBooks, improvementAreas };
  },
});
