import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, BvAttendance } from '@/lib/backend-sdk';
import { fillingSameDayApplies } from '@/lib/userUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwFieldPercent, pwOverallPercent, pwTarget } from '@/lib/pwSadhana';

const USER_FIELDS = ['id', 'userId', 'email', 'segment', 'isPrabhupadaWorldUser', 'ashrayLevel', 'residencyApproved', 'residencyGuideVerified', 'residency', 'selectedFolkResidency', 'temporaryResidencyEnabled', 'temporaryResidency', 'pwChantingTarget', 'pwReadingTarget', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
const USER_IDENTITY_FIELDS = ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
const ENTRY_FIELDS = [
  'id', 'user', 'entryDate', 'scorePercent', 'totalScore', 'maxScore', 'roundsCount', 'spReadingMinutes',
  'preachingMinutes', 'booksDistributed', 'sleepMinutes',
  'sbPoints', 'maNaGvPoints', 'cleanlinessPoints', 'dailyServicePoints',
  'sleepQualityPoints', 'roundsPoints', 'spReadingPoints', 'quotesTulasiPoints', 'japaVisiblePoints',
  'reportSendingPoints', 'templateMode', 'fieldValuesJson', 'submittedAt', 'flagSick', 'flagOs',
];

function parseFieldValues(json: string | null | undefined): Record<string, any> {
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
}

/** Accept records created before and after NR_TEMPLATE became the canonical
 * non-resident template identifier. */
function isNonResidentEntry(templateMode: unknown): boolean {
  const normalized = String(templateMode || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return normalized.includes('NON_RESIDENT') || normalized === 'NR_TEMPLATE' || normalized === 'NR';
}

function userIdentityAliases(user: any): string[] {
  return [...new Set(USER_IDENTITY_FIELDS
    .map(field => user?.[field])
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean))];
}

function dedupeEntries(entryResults: { records: any[] }[]): any[] {
  const byId = new Map<string, any>();
  entryResults.flatMap(result => result.records).forEach(entry => {
    byId.set(String(entry.id), entry);
  });
  return [...byId.values()];
}

function getISOWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${monthNames[mon.getMonth()]} ${mon.getDate()}`;
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon.toISOString().split('T')[0];
}

function getMonthKey(dateStr: string): string { return dateStr.slice(0, 7); }
function getMonthLabel(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function getDateLabel(dateStr: string): string {
  try { const d = new Date(dateStr + 'T00:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return dateStr; }
}

// Compute approximate NR chanting points from raw round count
function nrChantingPts(rounds: number): number {
  return Math.min(Math.round(rounds / 2), 8);
}

// Compute approximate NR reading/hearing pts from minutes
function nrMinutePts(minutes: number): number {
  if (minutes >= 60) return 4;
  if (minutes >= 45) return 3;
  if (minutes >= 30) return 2;
  if (minutes >= 15) return 1;
  return 0;
}

// Return the calendar date in India for a timestamp. Sadhana dates are user
// calendar dates, so comparing UTC dates can incorrectly mark late-night IST
// submissions as backdated.
function istDateOnly(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Compute NR filling-same-day pts from submittedAt vs entryDate
function nrFillingSameDayPts(entryDate: string, submittedAt: string | null | undefined): number {
  if (!submittedAt) return 0;
  try {
    const entryDateOnly = entryDate.slice(0, 10);
    const submittedDateOnly = istDateOnly(submittedAt);
    if (!entryDateOnly || !submittedDateOnly) return 0;
    const entryD = new Date(`${entryDateOnly}T00:00:00Z`);
    const submittedD = new Date(`${submittedDateOnly}T00:00:00Z`);
    const dayDelay = Math.max(0, Math.round((submittedD.getTime() - entryD.getTime()) / 86400000));
    return Math.max(0, 4 - dayDelay * 2);
  } catch { return 0; }
}

/** Form values may be stored as booleans, 0/1, or legacy Yes/No text. */
function toBinaryValue(value: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value > 0 ? 1 : 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'present', 'attended'].includes(normalized) ? 1 : 0;
}

function resolvedFillingSameDayPoints(
  fieldValues: Record<string, any>,
  entryDate: string,
  submittedAt: string | null | undefined,
  ashrayLevel: string | null | undefined,
): number {
  if (!fillingSameDayApplies(ashrayLevel)) return 0;
  // The actual save timestamp is authoritative. In particular, do not let a
  // stale persisted 0 mask a same-day submission after an entry was edited or
  // migrated from the older schema.
  if (submittedAt) return nrFillingSameDayPts(entryDate, submittedAt);

  // Older records may not have submittedAt. Fall back to persisted points for
  // those records because there is no timestamp from which to recalculate.
  const stored = fieldValues._pts_fillingSameDay ??
    fieldValues._nr_pts_fillingSameDay ??
    fieldValues._per_field?.fillingSameDay;
  return stored != null && stored !== '' ? Math.max(0, Number(stored) || 0) : 0;
}

interface EntryValues {
  label: string;
  date: string;
  scorePercent: number | null;
  rounds: number;
  roundsCount: number;
  spReadingMinutes: number;
  sbPoints: number;
  maNaGvPoints: number;
  quotesTulasi: number;
  bath: number;
  japaVisible: number;
  cleanlinessPoints: number;
  reportSending: number;
  dailyServicePoints: number;
  sleepQualityPoints: number;
  sleepHours: number;
  studyMinutes: number;
  reading: number;
  hearing: number;
  fillingSameDay: number;
  seva: number;
  bhaktiVriksha: number;
  booksDistributed: number;
  preachingMinutes: number;
  roundsPoints: number;
  spReadingPoints: number;
  quotesTulasiPoints: number;
  japaVisiblePoints: number;
  reportSendingPoints: number;
  nrChantingPts: number;
  nrReadingPts: number;
  nrHearingPts: number;
  nrFillingSameDayPts: number;
  nrSevaPts: number;
  nrBhaktiVrikshaPts: number;
}

function entryToValues(
  e: any,
  isNR: boolean,
  attendanceByDate: ReadonlyMap<string, boolean> = new Map(),
  ashrayLevel?: string | null,
): EntryValues {
  const fv = parseFieldValues(e.fieldValuesJson as string);
  const rounds = isNR
    ? Number(fv.chanting ?? fv.rounds ?? e.roundsCount ?? 0)
    : Number(e.roundsCount ?? 0);
  const sleepMins = Number(e.sleepMinutes ?? 0);
  const reading = isNR ? Number(fv.reading ?? 0) : 0;
  const hearing = isNR ? Number(fv.hearing ?? 0) : 0;
  const entryDate = (e.entryDate as string || '').slice(0, 10);
  const submittedAt = e.submittedAt as string | undefined;
  const sevaRaw = isNR ? toBinaryValue(fv.seva) : 0;
  // Attendance is authoritative for this value. Preserve a legacy/form value
  // as a fallback, but never show zero when the group marked the user present.
  const bvRaw = isNR ? Math.max(
    toBinaryValue(fv.bhaktiVriksha),
    attendanceByDate.get(entryDate) ? 1 : 0,
  ) : 0;
  const fillingSameDay = isNR
    ? resolvedFillingSameDayPoints(fv, entryDate, submittedAt, e.ashrayLevelUsed || ashrayLevel)
    : 0;

  let adjustedScorePercent = e.scorePercent ?? null;
  if (!isNR) {
    const colSum = Number(e.maNaGvPoints ?? 0) + Number(e.quotesTulasiPoints ?? 0) +
      Number(e.japaVisiblePoints ?? 0) + Number(e.sbPoints ?? 0) +
      Number(e.cleanlinessPoints ?? 0) + Number(e.reportSendingPoints ?? 0) +
      Number(e.dailyServicePoints ?? 0) + Number(e.roundsPoints ?? 0) +
      Number(e.spReadingPoints ?? 0) + Number(e.sleepQualityPoints ?? 0);
    const dbTotal = Number(e.totalScore) || 0;
    const bestTotal = Math.max(colSum, dbTotal);
    const dbMax = Math.max(Number(e.maxScore) || 20, 1);
    adjustedScorePercent = Math.min(100, Math.round((bestTotal / dbMax) * 100));
  } else {
    const dbTotal = Number(e.totalScore) || 0;
    const dbMax = Math.max(Number(e.maxScore) || 20, 1);
    adjustedScorePercent = Math.min(100, Math.round((dbTotal / dbMax) * 100));
  }

  return {
    label: getDateLabel(entryDate),
    date: entryDate,
    scorePercent: adjustedScorePercent,
    rounds,
    roundsCount: rounds,
    spReadingMinutes: isNR ? 0 : Number(e.spReadingMinutes ?? 0),
    sbPoints: isNR ? 0 : Number(e.sbPoints ?? 0),
    maNaGvPoints: isNR ? 0 : Number(e.maNaGvPoints ?? 0),
    quotesTulasi: isNR ? 0 : Number(fv.quotes_tulasi ?? 0),
    bath: isNR ? 0 : Number(fv.bath ?? 0),
    japaVisible: isNR ? 0 : Number(fv.japa_visible ?? 0),
    cleanlinessPoints: isNR ? 0 : Number(e.cleanlinessPoints ?? 0),
    reportSending: isNR ? 0 : Number(e.reportSendingPoints ?? 0),
    dailyServicePoints: isNR ? 0 : Number(e.dailyServicePoints ?? 0),
    sleepQualityPoints: isNR ? 0 : Number(e.sleepQualityPoints ?? 0),
    roundsPoints: isNR ? 0 : Number(e.roundsPoints ?? 0),
    spReadingPoints: isNR ? 0 : Number(e.spReadingPoints ?? 0),
    quotesTulasiPoints: isNR ? 0 : Number(e.quotesTulasiPoints ?? fv.quotes_tulasi ?? 0),
    japaVisiblePoints: isNR ? 0 : Number(e.japaVisiblePoints ?? fv.japa_visible ?? 0),
    reportSendingPoints: isNR ? 0 : Number(e.reportSendingPoints ?? 0),
    sleepHours: (!isNR && sleepMins > 0) ? Math.round(sleepMins / 60 * 10) / 10 : 0,
    studyMinutes: isNR ? 0 : Number(fv.study_minutes ?? 0),
    reading,
    hearing,
    fillingSameDay,
    seva: sevaRaw,
    bhaktiVriksha: bvRaw,
    booksDistributed: Number(e.booksDistributed ?? 0),
    preachingMinutes: Number(e.preachingMinutes ?? 0),
    nrChantingPts: isNR ? nrChantingPts(rounds) : 0,
    nrReadingPts: isNR ? nrMinutePts(reading) : 0,
    nrHearingPts: isNR ? nrMinutePts(hearing) : 0,
    nrFillingSameDayPts: isNR ? nrFillingSameDayPts(entryDate, submittedAt) : 0,
    nrSevaPts: isNR ? (sevaRaw > 0 ? 4 : 0) : 0,
    nrBhaktiVrikshaPts: isNR ? (bvRaw > 0 ? 4 : 0) : 0,
  };
}

function avgValues(vals: EntryValues[]): Omit<EntryValues, 'label' | 'date'> {
  const n = vals.length || 1;
  const sum = (key: keyof EntryValues) => (vals as any[]).reduce((s, v) => s + (Number(v[key]) || 0), 0);
  const scoredVals = vals.filter(v => v.scorePercent != null);
  const sp = scoredVals.length > 0 ? Math.round(scoredVals.reduce((s, v) => s + v.scorePercent!, 0) / scoredVals.length) : null;
  const r = (k: keyof EntryValues) => Math.round(sum(k) / n * 10) / 10;
  return {
    scorePercent: sp,
    rounds: r('rounds'), roundsCount: r('rounds'),
    spReadingMinutes: r('spReadingMinutes'),
    sbPoints: r('sbPoints'), maNaGvPoints: r('maNaGvPoints'),
    quotesTulasi: r('quotesTulasi'), bath: r('bath'), japaVisible: r('japaVisible'),
    cleanlinessPoints: r('cleanlinessPoints'), reportSending: r('reportSending'),
    dailyServicePoints: r('dailyServicePoints'), sleepQualityPoints: r('sleepQualityPoints'),
    sleepHours: r('sleepHours'), studyMinutes: r('studyMinutes'),
    reading: r('reading'), hearing: r('hearing'),
    fillingSameDay: r('fillingSameDay'), seva: r('seva'), bhaktiVriksha: r('bhaktiVriksha'),
    booksDistributed: r('booksDistributed'), preachingMinutes: r('preachingMinutes'),
    roundsPoints: r('roundsPoints'), spReadingPoints: r('spReadingPoints'),
    quotesTulasiPoints: r('quotesTulasiPoints'), japaVisiblePoints: r('japaVisiblePoints'),
    reportSendingPoints: r('reportSendingPoints'),
    nrChantingPts: r('nrChantingPts'),
    nrReadingPts: r('nrReadingPts'),
    nrHearingPts: r('nrHearingPts'),
    nrFillingSameDayPts: r('nrFillingSameDayPts'),
    nrSevaPts: r('nrSevaPts'),
    nrBhaktiVrikshaPts: r('nrBhaktiVrikshaPts'),
  };
}

const RESIDENT_FIELD_DEFS = [
  { key: 'rounds', label: 'Rounds', unit: '' },
  { key: 'spReadingMinutes', label: 'Book Reading', unit: 'min' },
  { key: 'sbPoints', label: 'SB Class', unit: 'pts' },
  { key: 'maNaGvPoints', label: 'DA+NA+GP+Kirtan', unit: 'pts' },
  { key: 'cleanlinessPoints', label: 'Clean Area', unit: 'pts' },
  { key: 'dailyServicePoints', label: 'Service', unit: 'pts' },
  { key: 'sleepQualityPoints', label: 'Sleep Quality', unit: 'pts' },
  { key: 'sleepHours', label: 'Sleep', unit: 'hrs' },
];

const RESIDENT_INSIGHT_DEFS = [
  { key: 'maNaGvPoints',      label: 'DA+NA+GP+Kirtan',          maxPts: 3, tip: 'Attend the full 30 min morning program for 3 pts' },
  { key: 'roundsPoints',      label: 'Chanting Rounds',           maxPts: 4, tip: 'Complete all 16 rounds before 8 AM for 4 pts' },
  { key: 'spReadingPoints',   label: 'Book Reading',              maxPts: 3, tip: 'Read 30+ min of Srila Prabhupada books for 3 pts' },
  { key: 'japaVisiblePoints', label: 'Japa MTH',                  maxPts: 2, tip: 'Do japa in MTH/Balcony (visible) for 2 pts' },
  { key: 'sbPoints',          label: 'SB Class',                  maxPts: 2, tip: 'Attend 25–30 min in MT Hall for 2 pts' },
  { key: 'dailyServicePoints',label: 'Service',                   maxPts: 2, tip: 'Complete your assigned service fully for 2 pts' },
  { key: 'quotesTulasiPoints',label: 'Quotes/Pranam',             maxPts: 1, tip: 'Attend quotes reading and Vaishnava Pranam for 1 pt' },
  { key: 'cleanlinessPoints', label: 'Clean Area',                maxPts: 1, tip: 'Clean your room/area before 8 AM for 1 pt' },
  { key: 'sleepQualityPoints',label: 'Sleep Quality',             maxPts: 1, tip: 'Sleep before 10:30 PM for 1 pt' },
  { key: 'reportSendingPoints',label: 'SameDay Fill',             maxPts: 1, tip: 'Submit your sadhana report on the same day for 1 pt' },
];

// Resident sick/OS: only these fields are scored (others are 0 and should be excluded from insights)
const RESIDENT_SICK_OS_INSIGHT_KEYS = new Set(['roundsPoints', 'spReadingPoints', 'reportSendingPoints']);

// NR scored fields only: chanting (8), reading (4), hearing (4), fillingSameDay (4)
// Seva and BhaktiVriksha are leaderboard-only for NR — they do NOT count toward the score
const NR_INSIGHT_DEFS = [
  { key: 'nrChantingPts',       label: 'Chanting Rounds',  maxPts: 8, tip: 'Chant all 16 rounds every day — 2 rounds = 1 pt, max 8 pts' },
  { key: 'nrReadingPts',        label: 'SP Book Reading',  maxPts: 4, tip: 'Read SP books daily — 15 min = 1 pt, 30 min = 2 pts, 45 min = 3 pts, 60+ min = 4 pts' },
  { key: 'nrHearingPts',        label: 'SB Class Hearing', maxPts: 4, tip: 'Hear SB class daily — 15 min = 1 pt, 30 min = 2 pts, 45 min = 3 pts, 60+ min = 4 pts' },
  { key: 'nrFillingSameDayPts', label: 'Filling Same Day', maxPts: 4, tip: 'Submit on the same day for full 4 pts (2 pts deducted per late day)' },
];

const NR_FIELD_DEFS = [
  { key: 'rounds', label: 'Rounds', unit: '' },
  { key: 'reading', label: 'Reading', unit: 'min' },
  { key: 'hearing', label: 'Hearing', unit: 'min' },
  { key: 'fillingSameDay', label: 'Filled Same Day', unit: 'pts' },
  { key: 'seva', label: 'Seva', unit: 'Yes/No' },
  { key: 'bhaktiVriksha', label: 'BV Attended', unit: 'Yes/No' },
];

const PW_FIELD_DEFS = [
  { key: 'rounds', label: 'Chanting', unit: 'rounds' },
  { key: 'reading', label: 'Reading', unit: 'min' },
];

export default createEndpoint({
  description: 'Field-level progress stats for a single user, with period aggregation and entry-count based insights',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    days: z.number().optional(),
    period: z.enum(['daily', 'weekly', 'monthly']).optional(),
    includeToday: z.boolean().optional(),
    startDate: z.string().max(10).optional(),
    endDate: z.string().max(10).optional(),
    // When true: use entry-count based insights instead of date-range
    // daily = yesterday's entry, weekly = last 7 entries, monthly = last 30 entries
    insightMode: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    const { userId: targetUserId } = input;
    const period = input.period ?? 'daily';
    const includeToday = input.includeToday ?? false;
    const insightMode = input.insightMode ?? false;

    let targetUser: any = context.user;
    let isResident = !!((context.user.residencyApproved || context.user.residencyGuideVerified) && (context.user.residency || context.user.selectedFolkResidency));

    // Detect scholar: NR user temporarily visiting a FOLK residency
    const tempRes = Array.isArray(context.user.temporaryResidency)
      ? context.user.temporaryResidency[0]
      : context.user.temporaryResidency;
    let isScholar = !isResident && !!(context.user.temporaryResidencyEnabled && tempRes);

      let found = null;
      if (/^USER-\d+$/i.test(targetUserId)) {
        const { records } = await Users.findAll({ filters: { userId: targetUserId } as any, fields: USER_FIELDS });
        found = records.find(r => r.id !== r.userId) || records[0];
      }
      if (!found) {
        const byId = await Users.findOne({ id: targetUserId, fields: USER_FIELDS }).catch(() => undefined);
        if (byId) {
          if (byId.id === byId.userId) {
            const { records } = await Users.findAll({ filters: { userId: byId.userId } as any, fields: USER_FIELDS });
            found = records.find(r => r.id !== r.userId) || byId;
          } else {
            found = byId;
          }
        }
      }
      if (!found) {
        const { records } = await Users.findAll({ filters: { userId: targetUserId } as any, fields: USER_FIELDS });
        found = records.find(r => r.id !== r.userId) || records[0] || null;
      }

      if (found) {
        targetUser = found;
        const rid = Array.isArray(found.residency) ? found.residency[0] : found.residency;
        const foundTempRes = Array.isArray((found as any).temporaryResidency)
          ? (found as any).temporaryResidency[0]
          : (found as any).temporaryResidency;
        const foundIsResident = !!((found.residencyApproved || (found as any).residencyGuideVerified) && (rid || (found as any).selectedFolkResidency));
        const foundIsScholar = !foundIsResident && !!((found as any).temporaryResidencyEnabled && foundTempRes);
        isResident = foundIsResident;
        isScholar = foundIsScholar;
      } else targetUser = { id: targetUserId };

    const entryOwnerIds = userIdentityAliases(targetUser);
    if (entryOwnerIds.length === 0 && targetUserId) entryOwnerIds.push(targetUserId);
    const entryOwnerSet = new Set(entryOwnerIds.map(String));
    const loadEntries = async (filters: Record<string, unknown>, limit = 500) => {
      // A user equality plus entryDate range requires a composite Firestore
      // index. Query the indexed date field first and resolve canonical user
      // aliases in memory, just like the aggregate Stats endpoint does.
      if (filters.entryDate !== undefined) {
        const records: any[] = [];
        const pageSize = 2000;
        for (let offset = 0; ; offset += pageSize) {
          const result = await SadhanaEntries.findAll({
            filters: { entryDate: filters.entryDate } as any,
            fields: ENTRY_FIELDS,
            limit: pageSize,
            offset,
          });
          records.push(...result.records);
          if (!result.hasMore) break;
        }
        return dedupeEntries([{ records: records.filter(entry => {
          const owner = String(Array.isArray(entry.user) ? entry.user[0] : entry.user || '').trim();
          return entryOwnerSet.has(owner);
        }) }]);
      }
      const results = await Promise.all(entryOwnerIds.map(user => SadhanaEntries.findAll({
        filters: { ...filters, user } as any,
        fields: ENTRY_FIELDS,
        limit,
      })));
      return dedupeEntries(results);
    };

    const loadAttendanceByDate = async (): Promise<Map<string, boolean>> => {
      const results = await Promise.all(entryOwnerIds.map(user =>
        BvAttendance.findAll({
          filters: { user },
          fields: ['id', 'attendanceDate', 'present', 'status'],
          limit: 500,
        }).catch(() => ({ records: [] }))
      ));
      const byDate = new Map<string, boolean>();
      for (const attendance of results.flatMap(result => result.records)) {
        const date = String(attendance.attendanceDate || '').slice(0, 10);
        if (!date) continue;
        const present = attendance.present === true ||
          ['present', 'p', 'true', '1'].includes(String((attendance as any).status ?? attendance.present ?? '').trim().toLowerCase());
        // A present record takes precedence over any older duplicate record.
        byDate.set(date, byDate.get(date) === true || present);
      }
      return byDate;
    };

    // Scholars use resident scoring template
    const isPw = isPwSadhanaUser(targetUser);
    const effectiveIsResident = !isPw && (isResident || isScholar);

    // ─── Trend chart: date-range based (unchanged) ───
    const today = new Date();
    const endD = new Date(today);
    if (period === 'daily' && !includeToday) {
      endD.setDate(endD.getDate() - 1);
    }
    const endDate = input.endDate || endD.toISOString().split('T')[0];
    const defaultDays = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 1;
    let days = input.days ?? defaultDays;
    let startDate = input.startDate || '';
    if (!startDate) {
      const startD = new Date(`${endDate}T00:00:00Z`);
      startD.setUTCDate(startD.getUTCDate() - (days - 1));
      startDate = startD.toISOString().split('T')[0];
    } else if (input.endDate) {
      const rangeStart = new Date(`${startDate}T00:00:00Z`).getTime();
      const rangeEnd = new Date(`${endDate}T00:00:00Z`).getTime();
      days = Math.max(1, Math.floor((rangeEnd - rangeStart) / 86400000) + 1);
    }

    const trendEntries = await loadEntries({ entryDate: { gte: startDate, lte: endDate } });
    const attendanceByDate = await loadAttendanceByDate();

    const trendSorted = [...trendEntries].sort((a, b) =>
      (a.entryDate as string).localeCompare(b.entryDate as string)
    );

    const isNR = !effectiveIsResident;
    const allValues = trendSorted.map(e => {
      const isNREntry = isNonResidentEntry(e.templateMode);
      return {
        ...entryToValues(e, isNREntry || isNR, attendanceByDate, targetUser.ashrayLevel),
        isSickOs: !!(e.flagSick || e.flagOs),
      };
    });

    if (isPw) {
      for (const row of allValues) {
        const source = trendSorted.find(entry => String(entry.entryDate || '').slice(0, 10) === row.date);
        const stored = source ? parseFieldValues(source.fieldValuesJson as string) : {};
        const meta = (stored._meta && typeof stored._meta === 'object') ? stored._meta as Record<string, unknown> : {};
        const chantingTarget = pwTarget('pwChantingTarget' in meta ? meta.pwChantingTarget : targetUser.pwChantingTarget);
        const readingTarget = pwTarget('pwReadingTarget' in meta ? meta.pwReadingTarget : targetUser.pwReadingTarget);
        row.scorePercent = pwOverallPercent([
          pwFieldPercent(row.rounds, chantingTarget),
          pwFieldPercent(row.reading, readingTarget),
        ]);
      }
    }

    // Trend chart aggregation
    let aggregated: EntryValues[] = [];
    if (period === 'daily') {
      aggregated = allValues;
    } else if (period === 'weekly') {
      const weekMap = new Map<string, EntryValues[]>();
      for (const v of allValues) {
        const wk = getWeekKey(v.date);
        if (!weekMap.has(wk)) weekMap.set(wk, []);
        weekMap.get(wk)!.push(v);
      }
      aggregated = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([wk, vals]) => ({ label: getISOWeekLabel(wk), date: wk, ...avgValues(vals) }));
    } else if (period === 'monthly') {
      const monthMap = new Map<string, EntryValues[]>();
      for (const v of allValues) {
        const mk = getMonthKey(v.date);
        if (!monthMap.has(mk)) monthMap.set(mk, []);
        monthMap.get(mk)!.push(v);
      }
      aggregated = Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mk, vals]) => ({ label: getMonthLabel(mk), date: mk, ...avgValues(vals) }));
    }

    const fieldDefs = isPw ? PW_FIELD_DEFS : effectiveIsResident ? RESIDENT_FIELD_DEFS : NR_FIELD_DEFS;
    const mid = Math.floor(allValues.length / 2);

    // Sick/OS scored keys: only these fields are valid for sick/OS resident entries
    const SICK_OS_RESIDENT_TREND_KEYS = new Set(['rounds', 'roundsCount', 'spReadingMinutes', 'roundsPoints', 'spReadingPoints', 'reportSendingPoints']);
    // NR sick/OS: only chanting + reading
    const SICK_OS_NR_TREND_KEYS = new Set(['rounds', 'roundsCount', 'reading', 'nrChantingPts', 'nrReadingPts', 'nrFillingSameDayPts']);

    const fieldTrends = fieldDefs.map(f => {
      // For each entry, only include sick/OS entries if this field is scored during sick/OS
      const applicableVals = allValues.filter(v => {
        if (!v.isSickOs) return true;
        const sickOsKeys = isNR ? SICK_OS_NR_TREND_KEYS : SICK_OS_RESIDENT_TREND_KEYS;
        return sickOsKeys.has(f.key);
      });
      const vals = applicableVals.map(v => (v as any)[f.key] as number ?? 0);
      const total = vals.reduce((a, b) => a + b, 0);
      const avg = vals.length > 0 ? Math.round(total / vals.length * 10) / 10 : 0;
      const midIdx = Math.floor(applicableVals.length / 2);
      const fh = vals.slice(0, midIdx);
      const sh = vals.slice(midIdx);
      const fhAvg = fh.length ? fh.reduce((a, b) => a + b, 0) / fh.length : 0;
      const shAvg = sh.length ? sh.reduce((a, b) => a + b, 0) / sh.length : 0;
      const trend = applicableVals.length < 4 ? 'flat' : shAvg > fhAvg * 1.1 ? 'up' : shAvg < fhAvg * 0.9 ? 'down' : 'flat';
      return { field: f.key, label: f.label, unit: f.unit, avg, trend };
    });

    // ─── Insight section: entry-count based when insightMode=true ───
    let insightEntries: any[] = trendSorted; // default: use trend entries
    let noEntry = period === 'daily' && allValues.length === 0;
    let insightEntryCount = allValues.length;
    let insightPeriodLabel = period === 'daily' ? 'yesterday' : period === 'weekly' ? 'last 7 days' : 'last 30 days';

    if (insightMode) {
      // Use IST (UTC+5:30) — all users are in India, server runs UTC
      const yesterdayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      yesterdayIST.setDate(yesterdayIST.getDate() - 1);
      const yesterdayStr = yesterdayIST.toISOString().split('T')[0];

      if (period === 'daily') {
        // Yesterday's entry specifically
        const yEntries = await loadEntries({ entryDate: yesterdayStr }, 1);
        insightEntries = yEntries;
        noEntry = yEntries.length === 0;
        insightPeriodLabel = 'yesterday';
        insightEntryCount = yEntries.length;
      } else {
        // Last N entries by count (not date range)
        const n = period === 'weekly' ? 7 : 30;
        insightPeriodLabel = period === 'weekly' ? 'your last 7 entries' : 'your last 30 entries';
        const recentEntries = await loadEntries({}, 200);
        // Sort desc by entryDate, take top N
        insightEntries = [...recentEntries]
          .sort((a, b) => (b.entryDate as string).localeCompare(a.entryDate as string))
          .slice(0, n)
          .reverse(); // restore ascending order for consistency
        insightEntryCount = insightEntries.length;
        noEntry = insightEntries.length === 0;
      }
    }

    // Map insight entries to values with sick/OS flag
    const insightValues = insightEntries.map(e => {
      const isNREntry = isNonResidentEntry(e.templateMode);
      return {
        ...entryToValues(e, isNREntry || isNR, attendanceByDate, targetUser.ashrayLevel),
        isSickOs: !!(e.flagSick || e.flagOs),
      };
    });

    // Build improvement insights — sick/OS aware
    const insightDefs = isPw
      ? []
      : effectiveIsResident ? RESIDENT_INSIGHT_DEFS : NR_INSIGHT_DEFS;

    const insightFields = noEntry ? [] : insightDefs.map(def => {
      // Filter entries applicable for this field
      // Sick/OS entries: only rounds, spReading, reportSending are scored for residents
      // NR sick/OS: only chanting and reading are scored — exclude other fields for sick/OS NR entries
      const NR_SICK_OS_INSIGHT_KEYS = new Set(['nrChantingPts', 'nrReadingPts']);
      const applicableVals = effectiveIsResident
        ? insightValues.filter(v => !v.isSickOs || RESIDENT_SICK_OS_INSIGHT_KEYS.has(def.key))
        : insightValues.filter(v => !v.isSickOs || NR_SICK_OS_INSIGHT_KEYS.has(def.key));

      if (applicableVals.length === 0) return null;

      const pts = applicableVals.map(v => Math.max(0, (v as any)[def.key] as number ?? 0));
      const avg = pts.reduce((a, b) => a + b, 0) / pts.length;
      const avgRounded = Math.round(avg * 10) / 10;
      const gain = Math.max(0, Math.round((def.maxPts - avg) * 10) / 10);

      return {
        key: def.key,
        label: def.label,
        maxPts: def.maxPts,
        tip: def.tip,
        avgPts: avgRounded,
        potentialGain: gain,
        entriesUsed: applicableVals.length,
      };
    })
      .filter((f): f is NonNullable<typeof f> => f !== null && f.potentialGain > 0.05)
      .sort((a, b) => b.potentialGain - a.potentialGain);

    return {
      entries: aggregated,
      fieldTrends,
      fieldDefs,
      isPw,
      insightFields,
      isResident: effectiveIsResident,
      isScholar,
      period,
      totalDays: days,
      submittedCount: trendSorted.length,
      noEntry,
      insightEntryCount,
      insightPeriodLabel,
    };
  },
});
