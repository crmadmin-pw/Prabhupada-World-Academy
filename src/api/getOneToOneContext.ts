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

/** Calendar date from a YYYY-MM-DD string. UTC keeps the week bucket on the
 * IST day stored with the entry, instead of shifting it with the server zone. */
function calendarDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getMondayOfWeek(dateStr: string): string {
  const d = calendarDate(dateStr);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return formatCalendarDate(d);
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
    }) || await Users.findOne({
      filters: { userId: input.userId },
      fields: [...USER_IDENTITY_FIELDS, 'fullName', 'currentStreak', 'ashrayLevel', 'residencyApproved', 'residencyGuideVerified', 'segment', 'isPrabhupadaWorldUser'],
    }) || await Users.findOne({
      filters: { email: input.userId },
      fields: [...USER_IDENTITY_FIELDS, 'fullName', 'currentStreak', 'ashrayLevel', 'residencyApproved', 'residencyGuideVerified', 'segment', 'isPrabhupadaWorldUser'],
    });

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
    // Query the stored id and its lowercase form. Matching stays
    // case-insensitive below, and the date index is user + entryDate.
    const queryIds = [...new Set(
      USER_IDENTITY_FIELDS
        .flatMap(field => Array.isArray(user?.[field]) ? user[field] : [user?.[field]])
        .concat(input.userId)
        .filter(Boolean)
        .flatMap(value => {
          const text = String(value).trim();
          return text ? [text, text.toLowerCase()] : [];
        }),
    )];
    const readOwned = async (
      findAll: (query: any) => Promise<{ records: any[]; hasMore: boolean }>,
      filters: Record<string, unknown>,
      fields: string[],
    ) => {
      const pages = await Promise.all(queryIds.map(async id => {
        const records: any[] = [];
        for (let offset = 0; ; offset += 500) {
          const page = await findAll({ filters: { ...filters, user: id }, fields, limit: 500, offset });
          records.push(...page.records);
          if (!page.hasMore || records.length > 5000) break;
        }
        return records;
      }));
      return pages.flat();
    };

    const [allEntries, allAttendance] = await Promise.all([
      readOwned(
        query => SadhanaEntries.findAll(query),
        { entryDate: { gte: startDate, lte: today } },
        ['id', 'entryDate', 'scorePercent', 'totalScore', 'maxScore', 'templateMode', 'fieldValuesJson',
          'roundsCount', 'spReadingMinutes', 'preachingMinutes', 'booksDistributed',
          'nrChantingRounds', 'nrReadingMinutes', 'nrHearingMinutes', 'flagSick', 'flagOs', 'user'],
      ),
      // No user + attendanceDate index is deployed, so this stays a date-window
      // read and the member match below is unchanged.
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

    const entries = [...new Map(allEntries.filter((entry: any) => {
      const owner = Array.isArray(entry.user) ? entry.user[0] : entry.user;
      return userAliases.has(String(owner || '').trim().toLowerCase());
    }).map(entry => [String(entry.id), entry])).values()];
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
      const d = calendarDate(currMonday);
      d.setUTCDate(d.getUTCDate() - (3 - i) * 7);
      return formatCalendarDate(d);
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
      if (avgScore !== null && avgScore < 100) improvementAreas.push('Below the assigned sadhana target');
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
