import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries } from 'zite-integrations-backend-sdk';

const ENTRY_FIELDS = [
  'id', 'entryDate', 'scorePercent', 'totalScore', 'maxScore', 'roundsCount', 'spReadingMinutes',
  'preachingMinutes', 'booksDistributed', 'sleepMinutes',
  'sbPoints', 'maNaGvPoints', 'cleanlinessPoints', 'dailyServicePoints',
  'sleepQualityPoints', 'roundsPoints', 'spReadingPoints', 'quotesTulasiPoints', 'japaVisiblePoints',
  'reportSendingPoints', 'templateMode', 'fieldValuesJson', 'submittedAt', 'flagSick', 'flagOs',
];

function parseFieldValues(json: string | null | undefined): Record<string, any> {
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
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

// Compute NR filling-same-day pts from submittedAt vs entryDate
function nrFillingSameDayPts(entryDate: string, submittedAt: string | null | undefined): number {
  if (!submittedAt) return 0;
  try {
    const entryD = new Date(entryDate + 'T00:00:00');
    const subD = new Date(submittedAt);
    subD.setHours(0, 0, 0, 0);
    const dayDelay = Math.max(0, Math.round((subD.getTime() - entryD.getTime()) / 86400000));
    return Math.max(0, 4 - dayDelay * 2);
  } catch { return 0; }
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

function entryToValues(e: any, isNR: boolean): EntryValues {
  const fv = parseFieldValues(e.fieldValuesJson as string);
  const rounds = isNR
    ? Number(fv.chanting ?? fv.rounds ?? e.roundsCount ?? 0)
    : Number(e.roundsCount ?? 0);
  const sleepMins = Number(e.sleepMinutes ?? 0);
  const reading = isNR ? Number(fv.reading ?? 0) : 0;
  const hearing = isNR ? Number(fv.hearing ?? 0) : 0;
  const sevaRaw = isNR ? Number(fv.seva ?? 0) : 0;
  const bvRaw = isNR ? Number(fv.bhaktiVriksha ?? 0) : 0;
  const entryDate = (e.entryDate as string || '').slice(0, 10);
  const submittedAt = e.submittedAt as string | undefined;

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
    fillingSameDay: isNR ? Number(fv.fillingSameDay ?? 0) : 0,
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
  { key: 'spReadingMinutes', label: 'SP Reading', unit: 'min' },
  { key: 'sbPoints', label: 'SB', unit: 'pts' },
  { key: 'maNaGvPoints', label: 'MA/NA/GV', unit: 'pts' },
  { key: 'cleanlinessPoints', label: 'Cleanliness', unit: 'pts' },
  { key: 'dailyServicePoints', label: 'Daily Service', unit: 'pts' },
  { key: 'sleepQualityPoints', label: 'Sleep Quality', unit: 'pts' },
  { key: 'sleepHours', label: 'Sleep Hours', unit: 'hrs' },
];

const RESIDENT_INSIGHT_DEFS = [
  { key: 'maNaGvPoints',      label: 'Mangal Arti (MA/NA/GV)',   maxPts: 3, tip: 'Attend the full 23 min Mangal Arti for 3 pts' },
  { key: 'roundsPoints',      label: 'Chanting Rounds',           maxPts: 4, tip: 'Complete all 16 rounds before 8 AM for 4 pts' },
  { key: 'spReadingPoints',   label: 'SP Book Reading',           maxPts: 3, tip: 'Read 30+ min of Srila Prabhupada books for 3 pts' },
  { key: 'japaVisiblePoints', label: 'Japa Visible',              maxPts: 2, tip: 'Do japa in MTH/Balcony (visible) for 2 pts' },
  { key: 'sbPoints',          label: 'Srimad Bhagavatam',         maxPts: 2, tip: 'Attend 25–30 min in MT Hall for 2 pts' },
  { key: 'dailyServicePoints',label: 'Daily Assigned Service',    maxPts: 2, tip: 'Complete your assigned service fully for 2 pts' },
  { key: 'quotesTulasiPoints',label: 'Quotes + Tulasi Pranama',   maxPts: 1, tip: 'Attend quotes reading and Tulasi pranama for 1 pt' },
  { key: 'cleanlinessPoints', label: 'Cleanliness',               maxPts: 1, tip: 'Clean your room/area before 8 AM for 1 pt' },
  { key: 'sleepQualityPoints',label: 'Sleep Quality',             maxPts: 1, tip: 'Sleep before 10:30 PM for 1 pt' },
  { key: 'reportSendingPoints',label: 'Filling Same Day',         maxPts: 1, tip: 'Submit your sadhana report on the same day for 1 pt' },
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

export default createEndpoint({
  description: 'Field-level progress stats for a single user, with period aggregation and entry-count based insights',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    days: z.number().optional(),
    period: z.enum(['daily', 'weekly', 'monthly']).optional(),
    // When true: use entry-count based insights instead of date-range
    // daily = yesterday's entry, weekly = last 7 entries, monthly = last 30 entries
    insightMode: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const { userId: targetUserId } = input;
    const period = input.period ?? 'daily';
    const insightMode = input.insightMode ?? false;

    let dbUserId: string = context.user.id;
    let isResident = !!(context.user.residencyApproved && (context.user.residency));

    // Detect scholar: NR user temporarily visiting a FOLK residency
    const tempRes = Array.isArray(context.user.temporaryResidency)
      ? context.user.temporaryResidency[0]
      : context.user.temporaryResidency;
    let isScholar = !isResident && !!(context.user.temporaryResidencyEnabled && tempRes);

    if (targetUserId && targetUserId !== context.user.userId && targetUserId !== context.user.id) {
      const found = await Users.findOne({
        filters: { userId: targetUserId } as any,
        fields: ['id', 'residencyApproved', 'residency', 'temporaryResidencyEnabled', 'temporaryResidency'],
      });
      if (found) {
        dbUserId = found.id;
        const rid = Array.isArray(found.residency) ? found.residency[0] : found.residency;
        const foundTempRes = Array.isArray((found as any).temporaryResidency)
          ? (found as any).temporaryResidency[0]
          : (found as any).temporaryResidency;
        const foundIsResident = !!(found.residencyApproved && rid);
        const foundIsScholar = !foundIsResident && !!((found as any).temporaryResidencyEnabled && foundTempRes);
        isResident = foundIsResident;
        isScholar = foundIsScholar;
      } else {
        dbUserId = targetUserId;
      }
    }

    // Scholars use resident scoring template
    const effectiveIsResident = isResident || isScholar;

    // ─── Trend chart: date-range based (unchanged) ───
    const today = new Date();
    const endD = new Date(today);
    if (period === 'daily') {
      endD.setDate(endD.getDate() - 1);
    }
    const endDate = endD.toISOString().split('T')[0];
    const defaultDays = period === 'monthly' ? 30 : period === 'weekly' ? 7 : 1;
    const days = input.days ?? defaultDays;
    const startD = new Date(endD);
    startD.setDate(startD.getDate() - (days - 1));
    const startDate = startD.toISOString().split('T')[0];

    const { records: trendEntries } = await SadhanaEntries.findAll({
      filters: { user: dbUserId, entryDate: { gte: startDate, lte: endDate } } as any,
      fields: ENTRY_FIELDS, limit: 500,
    });

    const trendSorted = [...trendEntries].sort((a, b) =>
      (a.entryDate as string).localeCompare(b.entryDate as string)
    );

    const isNR = !effectiveIsResident;
    const allValues = trendSorted.map(e => {
      const isNREntry = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');
      return {
        ...entryToValues(e, isNREntry || isNR),
        isSickOs: !!(e.flagSick || e.flagOs),
      };
    });

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

    const fieldDefs = effectiveIsResident ? RESIDENT_FIELD_DEFS : NR_FIELD_DEFS;
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
        const { records: yEntries } = await SadhanaEntries.findAll({
          filters: { user: dbUserId, entryDate: yesterdayStr } as any,
          fields: ENTRY_FIELDS, limit: 1,
        });
        insightEntries = yEntries;
        noEntry = yEntries.length === 0;
        insightPeriodLabel = 'yesterday';
        insightEntryCount = yEntries.length;
      } else {
        // Last N entries by count (not date range)
        const n = period === 'weekly' ? 7 : 30;
        insightPeriodLabel = period === 'weekly' ? 'your last 7 entries' : 'your last 30 entries';
        const { records: recentEntries } = await SadhanaEntries.findAll({
          filters: { user: dbUserId } as any,
          fields: ENTRY_FIELDS,
          limit: 200, // fetch enough to find the most recent N entries for active users
        });
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
      const isNREntry = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');
      return {
        ...entryToValues(e, isNREntry || isNR),
        isSickOs: !!(e.flagSick || e.flagOs),
      };
    });

    // Build improvement insights — sick/OS aware
    const insightDefs = effectiveIsResident ? RESIDENT_INSIGHT_DEFS : NR_INSIGHT_DEFS;

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
