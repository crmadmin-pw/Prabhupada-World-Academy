/**
 * Stored report periods.
 *
 * A day, week, month, or requested range is aggregated once. Later report
 * views read that summary. Writes that change the underlying rows refresh the
 * affected periods, so a report does not scan those tables again.
 */
import {
  AttendanceRecords,
  BvAttendance,
  BvGroups,
  BvslPreachingEntries,
  OneToOneMeetings,
  ReportPeriodSummaries,
  SadhanaEntries,
  Users,
} from '@/lib/backend-sdk';
import { classifyLeaderboardPeriod } from './sadhanaPeriodSummary';

const MAX_DOC_CHARS = 700_000;
const SADHANA_FIELDS = [
  'id', 'user', 'entryDate', 'submittedAt', 'scorePercent', 'totalScore', 'maxScore', 'flagSick', 'flagOs',
  'roundsPoints', 'roundsCount', 'sbPoints', 'spReadingPoints', 'spReadingMinutes', 'maNaGvPoints',
  'quotesTulasiPoints', 'japaVisiblePoints', 'cleanlinessPoints', 'reportSendingPoints', 'dailyServicePoints',
  'sleepQualityPoints', 'japaFinishTime', 'sleepMinutes', 'studyMinutes', 'preachingMinutes', 'booksDistributed',
  'fieldValuesJson', 'templateMode', 'nrChantingRounds', 'nrReadingMinutes', 'nrHearingMinutes',
];
const PREACHING_FIELDS = [
  'id', 'user', 'entryDate', 'prCallingTime', 'prOneOnOneTime', 'prBookDistTime', 'prRduaTime', 'prPlanTime',
  'prBooksDistributed', 'prUniqueOneOnOnes',
];

type CountSum = { sum: number; count: number };
type ReportWrite = {
  table: string;
  op: 'create' | 'update' | 'delete';
  id: string;
  before?: any;
  after?: any;
  changed?: Record<string, unknown>;
};
type SummaryDesc = { report: string; periodType: string; periodKey: string; start: string; end: string };
type IndexedPeriod = SummaryDesc & { id: string };
export type FolkTotals = {
  user: string;
  entryCount: number;
  flagSick: boolean;
  flagOs: boolean;
  normalCount: number;
  roundsCount: CountSum;
  spReadingMinutes: CountSum;
  roundsPoints: CountSum;
  spReadingPoints: CountSum;
  reportSendingPoints: CountSum;
  sbAll: CountSum;
  sbNormal: CountSum;
  maAll: CountSum;
  maNormal: CountSum;
  quotesAll: CountSum;
  quotesNormal: CountSum;
  japaAll: CountSum;
  japaNormal: CountSum;
  cleanAll: CountSum;
  cleanNormal: CountSum;
  serviceAll: CountSum;
  serviceNormal: CountSum;
  sleepQualityAll: CountSum;
  sleepQualityNormal: CountSum;
  bathAll: CountSum;
  bathNormal: CountSum;
  japaTimeAll: CountSum;
  japaTimeNormal: CountSum;
  sleepAll: CountSum;
  sleepNormal: CountSum;
  study: CountSum;
  preachingTotal: number;
  booksTotal: number;
  totalScore: number;
  totalMaxScore: number;
  scorePercent: CountSum;
  singleScore: number | null;
};
export type PreachingDayFact = {
  sadhana: Record<string, { roundsSum: number; roundsCount: number }>;
  preaching: Record<string, { minutes: number; oneOnOnes: number; books: number }>;
  attendance: Record<string, number>;
};
export type PreachingRosterUser = {
  id: string;
  residency: string | null;
  residencyApproved: boolean;
  isB: boolean;
  isOtherCenter: boolean;
};
export type PreachingRosterGroup = { id: string; bvslLeader: string | null };
export type PipelineBucket = {
  chantingSum: number;
  chantingCount: number;
  readingSum: number;
  readingCount: number;
  hearingSum: number;
  hearingCount: number;
  books: number;
  preachMins: number;
};

const inflight = new Map<string, Promise<unknown>>();
const indexCache = new Map<string, IndexedPeriod[]>();
const indexLocks = new Map<string, Promise<void>>();
const ROSTER_ID = 'preaching__roster__current';

export async function loadMissingSubmissions(startDate: string, endDate: string): Promise<Map<string, 'filled' | 'late'>> {
  const payload = await loadSpan('missing', startDate, endDate, materializeMissing, mergeMissingPayloads);
  return flattenMissing(payload);
}

export async function loadFolkTotals(startDate: string, endDate: string): Promise<Map<string, FolkTotals>> {
  const payload = await loadSpan('folk', startDate, endDate, materializeFolk, mergeFolkPayloads);
  return new Map(Object.entries(payload?.users || {}) as [string, FolkTotals][]);
}

export function mergeFolkTotals(left: FolkTotals, right: FolkTotals): FolkTotals {
  const entryCount = left.entryCount + right.entryCount;
  return {
    user: left.user || right.user,
    entryCount,
    flagSick: left.flagSick || right.flagSick,
    flagOs: left.flagOs || right.flagOs,
    normalCount: left.normalCount + right.normalCount,
    roundsCount: addCounts(left.roundsCount, right.roundsCount),
    spReadingMinutes: addCounts(left.spReadingMinutes, right.spReadingMinutes),
    roundsPoints: addCounts(left.roundsPoints, right.roundsPoints),
    spReadingPoints: addCounts(left.spReadingPoints, right.spReadingPoints),
    reportSendingPoints: addCounts(left.reportSendingPoints, right.reportSendingPoints),
    sbAll: addCounts(left.sbAll, right.sbAll),
    sbNormal: addCounts(left.sbNormal, right.sbNormal),
    maAll: addCounts(left.maAll, right.maAll),
    maNormal: addCounts(left.maNormal, right.maNormal),
    quotesAll: addCounts(left.quotesAll, right.quotesAll),
    quotesNormal: addCounts(left.quotesNormal, right.quotesNormal),
    japaAll: addCounts(left.japaAll, right.japaAll),
    japaNormal: addCounts(left.japaNormal, right.japaNormal),
    cleanAll: addCounts(left.cleanAll, right.cleanAll),
    cleanNormal: addCounts(left.cleanNormal, right.cleanNormal),
    serviceAll: addCounts(left.serviceAll, right.serviceAll),
    serviceNormal: addCounts(left.serviceNormal, right.serviceNormal),
    sleepQualityAll: addCounts(left.sleepQualityAll, right.sleepQualityAll),
    sleepQualityNormal: addCounts(left.sleepQualityNormal, right.sleepQualityNormal),
    bathAll: addCounts(left.bathAll, right.bathAll),
    bathNormal: addCounts(left.bathNormal, right.bathNormal),
    japaTimeAll: addCounts(left.japaTimeAll, right.japaTimeAll),
    japaTimeNormal: addCounts(left.japaTimeNormal, right.japaTimeNormal),
    sleepAll: addCounts(left.sleepAll, right.sleepAll),
    sleepNormal: addCounts(left.sleepNormal, right.sleepNormal),
    study: addCounts(left.study, right.study),
    preachingTotal: left.preachingTotal + right.preachingTotal,
    booksTotal: left.booksTotal + right.booksTotal,
    totalScore: left.totalScore + right.totalScore,
    totalMaxScore: left.totalMaxScore + right.totalMaxScore,
    scorePercent: addCounts(left.scorePercent, right.scorePercent),
    singleScore: entryCount === 1 ? (left.entryCount === 1 ? left.singleScore : right.singleScore) : null,
  };
}

export function folkScoreFromTotals(totals: FolkTotals) {
  const normal = totals.normalCount > 0;
  const choose = (all: CountSum, norm: CountSum) => average(normal ? norm : all);
  const scorePercent = totals.entryCount === 1
    ? totals.singleScore
    : (totals.totalMaxScore > 0
      ? Math.min(100, Math.round((totals.totalScore / totals.totalMaxScore) * 100))
      : average(totals.scorePercent));
  return {
    flagSick: totals.flagSick,
    flagOs: totals.flagOs,
    roundsCount: average(totals.roundsCount),
    spReadingMinutes: average(totals.spReadingMinutes),
    roundsPoints: average(totals.roundsPoints),
    spReadingPoints: average(totals.spReadingPoints),
    reportSendingPoints: average(totals.reportSendingPoints),
    sbPoints: choose(totals.sbAll, totals.sbNormal),
    maNaGvPoints: choose(totals.maAll, totals.maNormal),
    quotesTulasiPoints: choose(totals.quotesAll, totals.quotesNormal),
    japaVisiblePoints: choose(totals.japaAll, totals.japaNormal),
    cleanlinessPoints: choose(totals.cleanAll, totals.cleanNormal),
    dailyServicePoints: choose(totals.serviceAll, totals.serviceNormal),
    sleepQualityPoints: choose(totals.sleepQualityAll, totals.sleepQualityNormal),
    bathPoints: choose(totals.bathAll, totals.bathNormal),
    japaTimeMins: choose(totals.japaTimeAll, totals.japaTimeNormal),
    sleepMins: choose(totals.sleepAll, totals.sleepNormal),
    studyMins: average(totals.study),
    preachingTotal: totals.preachingTotal || null,
    booksTotal: totals.booksTotal || null,
    scorePercent,
  };
}

export async function loadPreachingDays(startDate: string, endDate: string): Promise<Map<string, PreachingDayFact>> {
  const payload = await loadSpan('preaching', startDate, endDate, materializePreaching, mergePreachingPayloads);
  const days = new Map<string, PreachingDayFact>();
  for (const [day, fact] of Object.entries(payload?.days || {})) days.set(day, normalizePreachingDay(fact));
  return days;
}

export async function loadPreachingRoster(): Promise<{ users: PreachingRosterUser[]; groups: PreachingRosterGroup[] }> {
  const ready = await readReady(ROSTER_ID);
  if (ready) return { users: ready.users || [], groups: ready.groups || [] };
  return once(ROSTER_ID, async () => {
    const again = await readReady(ROSTER_ID);
    if (again) return { users: again.users || [], groups: again.groups || [] };
    const [users, groups] = await Promise.all([
      pageAll(Users, { filters: { status: 'Active' }, fields: ['id', 'residency', 'residencyApproved', 'isB', 'isOtherCenter'] }),
      BvGroups.findAll({ filters: { isActive: true }, fields: ['id', 'bvslLeader'], limit: 2000 }).then(result => result.records),
    ]);
    const payload = {
      users: users.filter(user => user?.id).map(rosterUser),
      groups: groups.filter(group => group?.id).map(rosterGroup),
    };
    await writeReady(ROSTER_ID, payload, { report: 'preaching', periodType: 'roster', periodKey: 'current', start: '', end: '' }).catch(warnWrite);
    return payload;
  });
}

export async function loadPipelineIndexes(months: string[]): Promise<{
  sadhanaIdx: Map<string, Map<string, PipelineBucket>>;
  meetingsIdx: Map<string, Map<string, number>>;
  bvslMeetingsIdx: Map<string, Map<string, number>>;
}> {
  const specs = months.map(monthSpec);
  const ready = await Promise.all(specs.map(async spec => ({ ...spec, payload: await readReady(spec.id) })));
  if (ready.every(item => item.payload)) return pipelineIndexes(ready);
  const key = `pipeline__${[...months].sort().join('_')}`;
  return once(key, async () => {
    const again = await Promise.all(specs.map(async spec => ({ ...spec, payload: await readReady(spec.id) })));
    if (again.every(item => item.payload)) return pipelineIndexes(again);
    const payloads = await materializePipeline(specs);
    return pipelineIndexes(specs.map(spec => ({ ...spec, payload: payloads.get(spec.month) || emptyPipeline() })));
  });
}

export async function loadStandardAttendance(startDate?: string, endDate?: string): Promise<any[]> {
  return loadAttendanceWindow('std-attendance', startDate, endDate, async () => {
    const filters: any = {};
    if (startDate) filters.date = { ...(filters.date || {}), gte: startDate };
    if (endDate) filters.date = { ...(filters.date || {}), lte: endDate };
    const { records } = await AttendanceRecords.findAll({ filters, limit: 2000, fields: ['id', 'session', 'date', 'user', 'source'] });
    return records;
  });
}

export async function loadBvAttendance(startDate?: string, endDate?: string): Promise<any[]> {
  return loadAttendanceWindow('bv-attendance', startDate, endDate, async () => {
    const filters: any = { present: true };
    if (startDate) filters.attendanceDate = { ...(filters.attendanceDate || {}), gte: startDate };
    if (endDate) filters.attendanceDate = { ...(filters.attendanceDate || {}), lte: endDate };
    const { records } = await BvAttendance.findAll({
      filters, limit: 2000, fields: ['id', 'attendanceDate', 'user', 'sessionTopic', 'group', 'groupId', 'present'],
    });
    return records;
  });
}

export async function deleteAllReportSummaries(): Promise<void> {
  indexCache.clear();
  inflight.clear();
  let offset = 0;
  while (offset < 20000) {
    const { records, hasMore } = await ReportPeriodSummaries.findAll({ limit: 500, offset });
    for (const record of records) await ReportPeriodSummaries.delete({ id: record.id }).catch(() => undefined);
    if (!hasMore || records.length === 0) break;
    offset += records.length;
  }
}

export async function handleReportSourceWrite(event: ReportWrite): Promise<void> {
  try {
    if (event.table === 'SadhanaEntries') await refreshSadhana(event);
    else if (event.table === 'BvslPreachingEntries') await refreshPreachingEntries(event);
    else if (event.table === 'OneToOneMeetings') await refreshMeetings(event);
    else if (event.table === 'AttendanceRecords') await refreshAttendanceRecords(event, 'std-attendance');
    else if (event.table === 'BvAttendance') {
      await refreshAttendanceRecords(event, 'bv-attendance');
      await refreshBvAttendanceCount(event);
    } else if (event.table === 'Users' || event.table === 'BvGroups') await refreshRoster(event);
  } catch (error) {
    warnRefresh(error);
  }
}

async function loadSpan(
  report: string,
  startDate: string,
  endDate: string,
  materialize: (start: string, end: string, exact: SummaryDesc & { id: string }) => Promise<any>,
  combine: (parts: any[]) => any,
): Promise<any> {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (!start || !end || start > end) return combine([]);
  const exact = exactSpec(report, start, end);
  const ready = await readReady(exact.id);
  if (ready) return ready;
  return once(exact.id, async () => {
    const again = await readReady(exact.id);
    if (again) return again;
    const days = listDays(start, end);
    if (days.length > 1 && days[0] === start && days[days.length - 1] === end) {
      const stored: any[] = [];
      let complete = true;
      for (const day of days) {
        const payload = await readReady(summaryId(report, 'day', day));
        if (!payload) { complete = false; break; }
        stored.push(payload);
      }
      if (complete) {
        const combined = combine(stored);
        await writeReady(exact.id, combined, exact).catch(warnWrite);
        await rememberPeriods(`${report}__index`, [exact]);
        return combined;
      }
    }
    return materialize(start, end, exact);
  });
}

async function materializeMissing(start: string, end: string, exact: SummaryDesc & { id: string }): Promise<any> {
  const entries = await pageAll(SadhanaEntries, {
    filters: { entryDate: { gte: start, lte: end } },
    fields: ['id', 'user', 'entryDate', 'submittedAt'],
  });
  const payload = missingPayload(entries.filter(entry => inRange(dayText(entry.entryDate), start, end)));
  await persistDays(exact, payload, entries, missingPayload, 'missing');
  return payload;
}

async function materializeFolk(start: string, end: string, exact: SummaryDesc & { id: string }): Promise<any> {
  const filters = start === end ? { entryDate: start } : { entryDate: { gte: start, lte: end } };
  const entries = await pageAll(SadhanaEntries, { filters, fields: SADHANA_FIELDS });
  const payload = folkPayload(entries.filter(entry => inRange(dayText(entry.entryDate), start, end)));
  await persistDays(exact, payload, entries, folkPayload, 'folk');
  return payload;
}

async function materializePreaching(start: string, end: string, exact: SummaryDesc & { id: string }): Promise<any> {
  const [sadhana, preaching, attendance] = await Promise.all([
    pageAll(SadhanaEntries, { filters: { entryDate: { gte: start, lte: end } }, fields: ['id', 'user', 'entryDate', 'roundsCount'] }),
    pageAll(BvslPreachingEntries, { filters: { entryDate: { gte: start, lte: end } }, fields: PREACHING_FIELDS }),
    pageAll(BvAttendance, { filters: { attendanceDate: { gte: start, lte: end } }, fields: ['id', 'group', 'present', 'attendanceDate'] }),
  ]);
  const days = new Map<string, PreachingDayFact>();
  for (const day of listDays(start, end)) days.set(day, emptyPreachingDay());
  for (const entry of sadhana) addPreachingSadhana(days, entry, start, end);
  for (const entry of preaching) addPreachingActivity(days, entry, start, end);
  for (const entry of attendance) addPreachingAttendance(days, entry, start, end);
  const payload = { days: Object.fromEntries(days) };
  const periods: IndexedPeriod[] = [exact];
  try {
    await writeReady(exact.id, payload, exact);
    for (const [day, fact] of days) {
      const id = summaryId('preaching', 'day', day);
      if (id === exact.id) continue;
      const desc = dayDesc('preaching', day);
      await writeReady(id, { days: { [day]: fact } }, desc);
      periods.push({ ...desc, id });
    }
    await rememberPeriods('preaching__index', periods);
  } catch (error) {
    warnWrite(error);
  }
  return payload;
}

async function materializePipeline(specs: Array<SummaryDesc & { id: string; month: string }>): Promise<Map<string, any>> {
  const oldest = specs[specs.length - 1];
  const latest = specs[0];
  const start = oldest?.start || '';
  const end = latest?.end || '';
  const [sadhana, meetings, preaching] = await Promise.all([
    pageAll(SadhanaEntries, {
      filters: { entryDate: { gte: start, lte: end } },
      fields: ['id', 'user', 'entryDate', 'templateMode', 'roundsCount', 'nrChantingRounds', 'spReadingMinutes', 'nrReadingMinutes', 'studyMinutes', 'nrHearingMinutes', 'booksDistributed', 'preachingMinutes'],
    }, 10000),
    OneToOneMeetings.findAll({
      filters: { meetingDate: { gte: start, lte: end } },
      fields: ['id', 'member', 'meetingDate'],
      limit: 2000,
    }).then(result => result.records),
    BvslPreachingEntries.findAll({
      filters: { entryDate: { gte: start, lte: end } },
      fields: ['id', 'user', 'entryDate', 'prUniqueOneOnOnes'],
      limit: 2000,
    }).then(result => result.records),
  ]);
  const byMonth = new Map<string, any>(specs.map(spec => [spec.month, emptyPipeline()]));
  for (const entry of sadhana) addPipelineSadhana(byMonth, entry);
  for (const meeting of meetings) addPipelineMeeting(byMonth, meeting);
  for (const entry of preaching) addPipelinePreaching(byMonth, entry);
  try {
    for (const spec of specs) await writeReady(spec.id, byMonth.get(spec.month) || emptyPipeline(), spec);
    await rememberPeriods('pipeline__index', specs);
  } catch (error) {
    warnWrite(error);
  }
  return byMonth;
}

async function loadAttendanceWindow(report: string, startDate: string | undefined, endDate: string | undefined, fetchRecords: () => Promise<any[]>): Promise<any[]> {
  const start = (startDate || '').slice(0, 10);
  const end = (endDate || '').slice(0, 10);
  const exact = attendanceSpec(report, start, end);
  const ready = await readReady(exact.id);
  if (ready) return ready.records || [];
  return once(exact.id, async () => {
    const again = await readReady(exact.id);
    if (again) return again.records || [];
    const records = await fetchRecords();
    try {
      await writeReady(exact.id, { records }, exact);
      await rememberPeriods(`${report}__index`, [exact]);
    } catch (error) {
      warnWrite(error);
    }
    return records;
  });
}

async function persistDays(
  exact: SummaryDesc & { id: string },
  payload: any,
  entries: any[],
  toPayload: (rows: any[]) => any,
  report: string,
): Promise<void> {
  const days = listDays(exact.start, exact.end);
  const covered = days[0] === exact.start && days[days.length - 1] === exact.end;
  const periods: IndexedPeriod[] = [exact];
  try {
    await writeReady(exact.id, payload, exact);
    if (covered) {
      const grouped = new Map<string, any[]>(days.map(day => [day, []]));
      for (const entry of entries) {
        const date = dayText(entry.entryDate);
        if (grouped.has(date)) grouped.get(date)!.push(entry);
      }
      for (const day of days) {
        const id = summaryId(report, 'day', day);
        if (id === exact.id) continue;
        const desc = dayDesc(report, day);
        await writeReady(id, toPayload(grouped.get(day) || []), desc);
        periods.push({ ...desc, id });
      }
    }
    await rememberPeriods(`${report}__index`, periods);
  } catch (error) {
    warnWrite(error);
  }
}

async function refreshSadhana(event: ReportWrite): Promise<void> {
  const dates = uniqueDates(event, 'entryDate');
  const [missing, folk, preaching, pipeline] = await Promise.all([
    matchingPeriods('missing__index', dates),
    matchingPeriods('folk__index', dates),
    matchingPeriods('preaching__index', dates),
    matchingPeriods('pipeline__index', dates),
  ]);
  if (!missing.length && !folk.length && !preaching.length && !pipeline.length) return;
  const users = sourceUsers(event);
  const entries = await rowsForUsers(SadhanaEntries, 'user', users, SADHANA_FIELDS, event);
  for (const period of missing) await updatePeriod(period, payload => patchMissing(payload, entries, users, period));
  for (const period of folk) await updatePeriod(period, payload => patchFolk(payload, entries, users, period));
  for (const period of preaching) await updatePeriod(period, payload => patchPreachingSadhana(payload, entries, users));
  for (const period of pipeline) await updatePeriod(period, payload => patchPipelineSadhana(payload, entries, users, period));
}

async function refreshPreachingEntries(event: ReportWrite): Promise<void> {
  const dates = uniqueDates(event, 'entryDate');
  const [preaching, pipeline] = await Promise.all([
    matchingPeriods('preaching__index', dates),
    matchingPeriods('pipeline__index', dates),
  ]);
  if (!preaching.length && !pipeline.length) return;
  const users = sourceUsers(event);
  const entries = await rowsForUsers(BvslPreachingEntries, 'user', users, PREACHING_FIELDS, event);
  for (const period of preaching) await updatePeriod(period, payload => patchPreachingActivity(payload, entries, users));
  for (const period of pipeline) await updatePeriod(period, payload => patchPipelineBvsl(payload, entries, users, period));
}

async function refreshMeetings(event: ReportWrite): Promise<void> {
  const dates = uniqueDates(event, 'meetingDate');
  const periods = await matchingPeriods('pipeline__index', dates);
  if (!periods.length) return;
  const users = [refId(event.after?.member), refId(event.before?.member)].filter(Boolean);
  const entries = await rowsForUsers(OneToOneMeetings, 'member', users, ['id', 'member', 'meetingDate'], event);
  for (const period of periods) await updatePeriod(period, payload => patchPipelineMeetings(payload, entries, users, period));
}

async function refreshAttendanceRecords(event: ReportWrite, report: string): Promise<void> {
  const dates = uniqueDates(event, report === 'bv-attendance' ? 'attendanceDate' : 'date');
  const periods = await readIndex(`${report}__index`);
  const hits = periods.filter(period => !period.start && !period.end || dates.some(date => covers(period, date)));
  if (!hits.length) return;
  for (const period of hits) {
    await updatePeriod(period, payload => patchAttendanceRows(payload, event, period, report === 'bv-attendance' ? 'bv' : 'std'));
  }
}

async function refreshBvAttendanceCount(event: ReportWrite): Promise<void> {
  const periods = await matchingPeriods('preaching__index', uniqueDates(event, 'attendanceDate'));
  if (!periods.length) return;
  for (const period of periods) {
    await updatePeriod(period, payload => {
      adjustAttendanceCount(payload, event.before, -1);
      if (event.op !== 'delete') adjustAttendanceCount(payload, event.after, 1);
    });
  }
}

async function refreshRoster(event: ReportWrite): Promise<void> {
  const ready = await readReady(ROSTER_ID);
  if (!ready) return;
  const next = clone(ready);
  if (event.table === 'Users') {
    const id = String(event.after?.id || event.before?.id || event.id);
    next.users = (next.users || []).filter((user: PreachingRosterUser) => user.id !== id);
    if (event.op !== 'delete' && event.after && String(event.after.status || '').toLowerCase() === 'active') next.users.push(rosterUser(event.after));
  } else {
    const id = String(event.after?.id || event.before?.id || event.id);
    next.groups = (next.groups || []).filter((group: PreachingRosterGroup) => group.id !== id);
    if (event.op !== 'delete' && event.after?.isActive === true) next.groups.push(rosterGroup(event.after));
  }
  if (JSON.stringify(next) === JSON.stringify(ready)) return;
  await writeReady(ROSTER_ID, next, { report: 'preaching', periodType: 'roster', periodKey: 'current', start: '', end: '' });
}

function patchMissing(payload: any, entries: any[], users: string[], period: IndexedPeriod): void {
  payload.users = payload.users || {};
  for (const uid of users) {
    const dates: Record<string, 'filled' | 'late'> = {};
    for (const entry of entries) {
      if (refId(entry.user) !== uid) continue;
      const date = dayText(entry.entryDate);
      if (!inRange(date, period.start, period.end)) continue;
      const status = submissionStatus(entry);
      if (!dates[date] || dates[date] === 'late' || status === 'filled') dates[date] = status;
    }
    if (Object.keys(dates).length) payload.users[uid] = dates;
    else delete payload.users[uid];
  }
}

function patchFolk(payload: any, entries: any[], users: string[], period: IndexedPeriod): void {
  payload.users = payload.users || {};
  const keys = new Set(users.map(user => user.toLowerCase()));
  for (const key of Object.keys(payload.users)) if (keys.has(key)) delete payload.users[key];
  const grouped = new Map<string, any[]>();
  for (const entry of entries) {
    const date = dayText(entry.entryDate);
    if (!inRange(date, period.start, period.end)) continue;
    const key = refId(entry.user).toLowerCase();
    if (!key || !keys.has(key)) continue;
    const list = grouped.get(key) || [];
    list.push(entry);
    grouped.set(key, list);
  }
  for (const [key, list] of grouped) payload.users[key] = summarizeFolkEntries(list);
}

function patchPreachingSadhana(payload: any, entries: any[], users: string[]): void {
  patchPreachingDays(payload, users, 'sadhana', entries, addPreachingSadhana);
}

function patchPreachingActivity(payload: any, entries: any[], users: string[]): void {
  patchPreachingDays(payload, users, 'preaching', entries, addPreachingActivity);
}

function patchPreachingDays(
  payload: any,
  users: string[],
  bucket: 'sadhana' | 'preaching',
  entries: any[],
  add: (days: Map<string, PreachingDayFact>, entry: any, start: string, end: string) => void,
): void {
  const wanted = new Set(users);
  const days = new Map<string, PreachingDayFact>();
  for (const [day, fact] of Object.entries(payload.days || {})) {
    const normalized = normalizePreachingDay(fact);
    for (const uid of wanted) delete normalized[bucket][uid];
    days.set(day, normalized);
  }
  for (const entry of entries) {
    if (!wanted.has(refId(entry.user))) continue;
    const date = dayText(entry.entryDate);
    if (!days.has(date)) continue;
    add(days, entry, date, date);
  }
  payload.days = Object.fromEntries(days);
}

function adjustAttendanceCount(payload: any, record: any, direction: number): void {
  if (!record?.present || !direction) return;
  const date = dayText(record.attendanceDate);
  const group = refId(record.group);
  if (!date || !group || !payload.days?.[date]) return;
  const fact = normalizePreachingDay(payload.days[date]);
  const next = (fact.attendance[group] || 0) + direction;
  if (next > 0) fact.attendance[group] = next;
  else delete fact.attendance[group];
  payload.days[date] = fact;
}

function patchPipelineSadhana(payload: any, entries: any[], users: string[], period: IndexedPeriod): void {
  payload.sadhana = payload.sadhana || {};
  const buckets = new Map<string, any>([[period.periodKey, payload]]);
  for (const uid of users) delete payload.sadhana[uid];
  for (const entry of entries) if (users.includes(refId(entry.user))) addPipelineSadhana(buckets, entry);
}

function patchPipelineMeetings(payload: any, entries: any[], users: string[], period: IndexedPeriod): void {
  payload.oneOnOnes = payload.oneOnOnes || {};
  for (const uid of users) delete payload.oneOnOnes[uid];
  const buckets = new Map<string, any>([[period.periodKey, payload]]);
  for (const entry of entries) if (users.includes(refId(entry.member))) addPipelineMeeting(buckets, entry);
}

function patchPipelineBvsl(payload: any, entries: any[], users: string[], period: IndexedPeriod): void {
  payload.bvslMeetings = payload.bvslMeetings || {};
  for (const uid of users) delete payload.bvslMeetings[uid];
  const buckets = new Map<string, any>([[period.periodKey, payload]]);
  for (const entry of entries) if (users.includes(refId(entry.user))) addPipelinePreaching(buckets, entry);
}

function patchAttendanceRows(payload: any, event: ReportWrite, period: IndexedPeriod, kind: 'std' | 'bv'): void {
  const records = (Array.isArray(payload.records) ? payload.records : []).filter((row: any) => row?.id !== event.id);
  if (event.op !== 'delete' && event.after) {
    const date = dayText(kind === 'bv' ? event.after.attendanceDate : event.after.date);
    const include = kind === 'bv' ? event.after.present === true : true;
    if (include && covers(period, date)) records.push(kind === 'bv' ? compactBv(event.after, event.id) : compactStd(event.after, event.id));
  }
  payload.records = records;
}

function addPreachingSadhana(days: Map<string, PreachingDayFact>, entry: any, start: string, end: string): void {
  const date = dayText(entry.entryDate);
  const uid = refId(entry.user);
  if (!uid || !inRange(date, start, end)) return;
  const fact = days.get(date) || emptyPreachingDay();
  const sample = fact.sadhana[uid] || { roundsSum: 0, roundsCount: 0 };
  if (entry.roundsCount != null && entry.roundsCount !== '') {
    const rounds = Number(entry.roundsCount);
    if (Number.isFinite(rounds)) {
      sample.roundsSum += rounds;
      sample.roundsCount += 1;
    }
  }
  fact.sadhana[uid] = sample;
  days.set(date, fact);
}

function addPreachingActivity(days: Map<string, PreachingDayFact>, entry: any, start: string, end: string): void {
  const date = dayText(entry.entryDate);
  const uid = refId(entry.user);
  if (!uid || !inRange(date, start, end)) return;
  const fact = days.get(date) || emptyPreachingDay();
  const activity = fact.preaching[uid] || { minutes: 0, oneOnOnes: 0, books: 0 };
  activity.minutes += (Number(entry.prCallingTime) || 0) + (Number(entry.prOneOnOneTime) || 0) + (Number(entry.prBookDistTime) || 0) + (Number(entry.prRduaTime) || 0) + (Number(entry.prPlanTime) || 0);
  if (entry.prUniqueOneOnOnes) activity.oneOnOnes += Number(entry.prUniqueOneOnOnes) || 0;
  if (entry.prBooksDistributed) activity.books += Number(entry.prBooksDistributed) || 0;
  fact.preaching[uid] = activity;
  days.set(date, fact);
}

function addPreachingAttendance(days: Map<string, PreachingDayFact>, entry: any, start: string, end: string): void {
  const date = dayText(entry.attendanceDate);
  const group = refId(entry.group);
  if (!entry.present || !group || !inRange(date, start, end)) return;
  const fact = days.get(date) || emptyPreachingDay();
  fact.attendance[group] = (fact.attendance[group] || 0) + 1;
  days.set(date, fact);
}

function addPipelineSadhana(months: Map<string, any>, entry: any): void {
  const uid = refId(entry.user);
  const month = dayText(entry.entryDate).slice(0, 7);
  const payload = months.get(month);
  if (!uid || !payload) return;
  const bucket = payload.sadhana[uid] || emptyBucket();
  const mode = String(entry.templateMode || '').toUpperCase();
  const resident = mode.includes('RESIDENT') && !mode.includes('NON_RESIDENT');
  if (resident) {
    addSample(bucket, 'chanting', entry.roundsCount);
    addSample(bucket, 'reading', entry.spReadingMinutes);
    addSample(bucket, 'hearing', entry.studyMinutes);
  } else {
    addSample(bucket, 'chanting', entry.nrChantingRounds);
    addSample(bucket, 'reading', entry.nrReadingMinutes);
    addSample(bucket, 'hearing', entry.nrHearingMinutes);
  }
  bucket.books += Number(entry.booksDistributed) || 0;
  bucket.preachMins += Number(entry.preachingMinutes) || 0;
  payload.sadhana[uid] = bucket;
}

function addPipelineMeeting(months: Map<string, any>, meeting: any): void {
  const uid = refId(meeting.member);
  const month = dayText(meeting.meetingDate).slice(0, 7);
  const payload = months.get(month);
  if (!uid || !payload) return;
  payload.oneOnOnes[uid] = (payload.oneOnOnes[uid] || 0) + 1;
}

function addPipelinePreaching(months: Map<string, any>, entry: any): void {
  const uid = refId(entry.user);
  const month = dayText(entry.entryDate).slice(0, 7);
  const payload = months.get(month);
  if (!uid || !payload) return;
  payload.bvslMeetings[uid] = (payload.bvslMeetings[uid] || 0) + (Number(entry.prUniqueOneOnOnes) || 0);
}

function addSample(bucket: PipelineBucket, kind: 'chanting' | 'reading' | 'hearing', value: unknown): void {
  if (value == null || value === '') return;
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  if (kind === 'chanting') { bucket.chantingSum += number; bucket.chantingCount += 1; }
  if (kind === 'reading') { bucket.readingSum += number; bucket.readingCount += 1; }
  if (kind === 'hearing') { bucket.hearingSum += number; bucket.hearingCount += 1; }
}

function missingPayload(entries: any[]): { users: Record<string, Record<string, 'filled' | 'late'>> } {
  const users: Record<string, Record<string, 'filled' | 'late'>> = {};
  for (const entry of entries) {
    const uid = refId(entry.user);
    const date = dayText(entry.entryDate);
    if (!uid || !date) continue;
    const status = submissionStatus(entry);
    const dates = users[uid] || (users[uid] = {});
    if (!dates[date] || dates[date] === 'late' || status === 'filled') dates[date] = status;
  }
  return { users };
}

function folkPayload(entries: any[]): { users: Record<string, FolkTotals> } {
  const grouped = new Map<string, any[]>();
  for (const entry of entries) {
    const key = refId(entry.user).toLowerCase();
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(entry);
    grouped.set(key, list);
  }
  const users: Record<string, FolkTotals> = {};
  for (const [key, list] of grouped) users[key] = summarizeFolkEntries(list);
  return { users };
}

function summarizeFolkEntries(entries: any[]): FolkTotals {
  const totals = emptyFolkTotals(refId(entries[0]?.user));
  for (const entry of entries) addFolkEntry(totals, entry);
  return totals;
}

function addFolkEntry(totals: FolkTotals, entry: any): void {
  const sick = !!entry.flagSick;
  const away = !!entry.flagOs;
  const normal = !sick && !away;
  totals.entryCount += 1;
  totals.flagSick = totals.flagSick || sick;
  totals.flagOs = totals.flagOs || away;
  if (normal) totals.normalCount += 1;
  if (totals.entryCount === 1) totals.singleScore = entry.scorePercent ?? null;
  else totals.singleScore = null;
  addNumber(totals.roundsCount, entry.roundsCount);
  addNumber(totals.spReadingMinutes, entry.spReadingMinutes);
  addNumber(totals.roundsPoints, entry.roundsPoints);
  addNumber(totals.spReadingPoints, entry.spReadingPoints);
  addNumber(totals.reportSendingPoints, entry.reportSendingPoints);
  addBoth(totals.sbAll, totals.sbNormal, entry.sbPoints, normal);
  addBoth(totals.maAll, totals.maNormal, entry.maNaGvPoints, normal);
  addBoth(totals.quotesAll, totals.quotesNormal, entry.quotesTulasiPoints, normal);
  addBoth(totals.japaAll, totals.japaNormal, entry.japaVisiblePoints, normal);
  addBoth(totals.cleanAll, totals.cleanNormal, entry.cleanlinessPoints, normal);
  addBoth(totals.serviceAll, totals.serviceNormal, entry.dailyServicePoints, normal);
  addBoth(totals.sleepQualityAll, totals.sleepQualityNormal, entry.sleepQualityPoints, normal);
  const bath = bathPoints(entry);
  addNumber(totals.bathAll, bath);
  if (normal) addNumber(totals.bathNormal, bath);
  const japa = parseHHMM(entry.japaFinishTime);
  addPositive(totals.japaTimeAll, japa);
  if (normal) addPositive(totals.japaTimeNormal, japa);
  addPositive(totals.sleepAll, entry.sleepMinutes);
  if (normal) addPositive(totals.sleepNormal, entry.sleepMinutes);
  addPositive(totals.study, entry.studyMinutes);
  totals.preachingTotal += Number(entry.preachingMinutes) || 0;
  totals.booksTotal += Number(entry.booksDistributed) || 0;
  totals.totalScore += Number(entry.totalScore) || 0;
  totals.totalMaxScore += Number(entry.maxScore) || 0;
  addNumber(totals.scorePercent, entry.scorePercent);
}

function mergeMissingPayloads(parts: any[]): { users: Record<string, Record<string, 'filled' | 'late'>> } {
  const users: Record<string, Record<string, 'filled' | 'late'>> = {};
  for (const part of parts) {
    for (const [uid, dates] of Object.entries(part?.users || {})) {
      users[uid] = { ...(users[uid] || {}), ...(dates as Record<string, 'filled' | 'late'>) };
    }
  }
  return { users };
}

function mergeFolkPayloads(parts: any[]): { users: Record<string, FolkTotals> } {
  const users: Record<string, FolkTotals> = {};
  for (const part of parts) {
    for (const [key, totals] of Object.entries(part?.users || {})) {
      users[key] = users[key] ? mergeFolkTotals(users[key], totals as FolkTotals) : totals as FolkTotals;
    }
  }
  return { users };
}

function mergePreachingPayloads(parts: any[]): { days: Record<string, PreachingDayFact> } {
  const days: Record<string, PreachingDayFact> = {};
  for (const part of parts) Object.assign(days, part?.days || {});
  return { days };
}

function flattenMissing(payload: any): Map<string, 'filled' | 'late'> {
  const submissions = new Map<string, 'filled' | 'late'>();
  for (const [uid, dates] of Object.entries(payload?.users || {})) {
    for (const [date, status] of Object.entries(dates as Record<string, 'filled' | 'late'>)) submissions.set(`${uid}|${date}`, status);
  }
  return submissions;
}

function submissionStatus(entry: any): 'filled' | 'late' {
  const entryDate = dayText(entry.entryDate);
  if (!entry.submittedAt) return 'filled';
  return dayText(entry.submittedAt) > entryDate ? 'late' : 'filled';
}

function pipelineIndexes(items: Array<{ month: string; payload: any }>): {
  sadhanaIdx: Map<string, Map<string, PipelineBucket>>;
  meetingsIdx: Map<string, Map<string, number>>;
  bvslMeetingsIdx: Map<string, Map<string, number>>;
} {
  const sadhanaIdx = new Map<string, Map<string, PipelineBucket>>();
  const meetingsIdx = new Map<string, Map<string, number>>();
  const bvslMeetingsIdx = new Map<string, Map<string, number>>();
  for (const item of items) {
    for (const [uid, bucket] of Object.entries(item.payload?.sadhana || {})) {
      if (!sadhanaIdx.has(uid)) sadhanaIdx.set(uid, new Map());
      sadhanaIdx.get(uid)!.set(item.month, bucket as PipelineBucket);
    }
    for (const [uid, count] of Object.entries(item.payload?.oneOnOnes || {})) {
      if (!count) continue;
      if (!meetingsIdx.has(uid)) meetingsIdx.set(uid, new Map());
      meetingsIdx.get(uid)!.set(item.month, Number(count) || 0);
    }
    for (const [uid, count] of Object.entries(item.payload?.bvslMeetings || {})) {
      if (!count) continue;
      if (!bvslMeetingsIdx.has(uid)) bvslMeetingsIdx.set(uid, new Map());
      bvslMeetingsIdx.get(uid)!.set(item.month, Number(count) || 0);
    }
  }
  return { sadhanaIdx, meetingsIdx, bvslMeetingsIdx };
}

async function matchingPeriods(indexId: string, dates: string[]): Promise<IndexedPeriod[]> {
  if (!dates.length) return [];
  const periods = await readIndex(indexId);
  return periods.filter(period => dates.some(date => covers(period, date)));
}

async function updatePeriod(period: IndexedPeriod, mutate: (payload: any) => void): Promise<void> {
  const payload = await readReady(period.id);
  if (!payload) return;
  const next = clone(payload);
  mutate(next);
  if (JSON.stringify(next) === JSON.stringify(payload)) return;
  await writeReady(period.id, next, period);
}

async function rowsForUsers(table: { findAll: Function }, field: string, users: string[], fields: string[], event: ReportWrite): Promise<any[]> {
  const rows: any[] = [];
  for (const user of users) rows.push(...await pageAll(table, { filters: { [field]: user }, fields }, 20000));
  return mergeWritten(rows, event);
}

function mergeWritten(rows: any[], event: ReportWrite): any[] {
  const kept = rows.filter(row => row?.id !== event.id);
  if (event.op === 'delete' || !event.after) return kept;
  return [...kept, event.after];
}

async function readIndex(indexId: string): Promise<IndexedPeriod[]> {
  const cached = indexCache.get(indexId);
  if (cached) return cached;
  const payload = await readReady(indexId);
  const periods = Array.isArray(payload?.periods) ? payload.periods.filter((period: IndexedPeriod) => period?.id) : [];
  indexCache.set(indexId, periods);
  return periods;
}

async function rememberPeriods(indexId: string, periods: IndexedPeriod[]): Promise<void> {
  if (!periods.length) return;
  await withIndexLock(indexId, async () => {
    const current = [...(indexCache.get(indexId) || await readIndexUncached(indexId))];
    const known = new Set(current.map(period => period.id));
    let changed = false;
    for (const period of periods) {
      if (!period.id || known.has(period.id)) continue;
      current.push(period);
      known.add(period.id);
      changed = true;
    }
    indexCache.set(indexId, current);
    if (!changed) return;
    const report = indexId.replace(/__index$/, '');
    await writeReady(indexId, { periods: current }, { report, periodType: 'index', periodKey: 'index', start: '', end: '' });
  });
}

async function readIndexUncached(indexId: string): Promise<IndexedPeriod[]> {
  const payload = await readReady(indexId);
  return Array.isArray(payload?.periods) ? payload.periods.filter((period: IndexedPeriod) => period?.id) : [];
}

async function withIndexLock<T>(indexId: string, run: () => Promise<T>): Promise<T> {
  const previous = indexLocks.get(indexId) || Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  indexLocks.set(indexId, tail);
  await previous;
  try { return await run(); }
  finally { release(); }
}

async function readReady(id: string): Promise<any | null> {
  try {
    const doc = await ReportPeriodSummaries.findOne({ id });
    if (!doc?.ready) return null;
    if (!doc.partCount) return doc.payload ?? {};
    const parts = [];
    for (let index = 0; index < Number(doc.partCount); index += 1) {
      const part = await ReportPeriodSummaries.findOne({ id: `${id}__part${index}` });
      if (part?.payload) parts.push(part.payload);
    }
    return mergeParts(parts);
  } catch (error) {
    console.warn('[report] stored summary read failed', error instanceof Error ? error.message : error);
    return null;
  }
}

async function writeReady(id: string, payload: unknown, desc: SummaryDesc): Promise<void> {
  const stored = clone(payload ?? {});
  const parts = splitPayload(stored);
  const existing = await ReportPeriodSummaries.findOne({ id, fields: ['partCount'] });
  const record = {
    report: desc.report,
    periodType: desc.periodType,
    periodKey: desc.periodKey,
    periodStart: desc.start,
    periodEnd: desc.end,
    ready: true,
    partCount: parts.length > 1 ? parts.length : 0,
    payload: parts.length > 1 ? null : parts[0],
    updatedAt: new Date().toISOString(),
  };
  if (existing) await ReportPeriodSummaries.update({ id, record });
  else await ReportPeriodSummaries.create({ record: { ...record, id } });
  if (parts.length > 1) {
    for (let index = 0; index < parts.length; index += 1) {
      const partId = `${id}__part${index}`;
      const partRecord = { payload: parts[index], ready: true, parentId: id, updatedAt: record.updatedAt };
      const part = await ReportPeriodSummaries.findOne({ id: partId, fields: ['id'] });
      if (part) await ReportPeriodSummaries.update({ id: partId, record: partRecord });
      else await ReportPeriodSummaries.create({ record: { ...partRecord, id: partId } });
    }
  }
  const previous = Number(existing?.partCount) || 0;
  for (let index = parts.length > 1 ? parts.length : 0; index < previous; index += 1) {
    await ReportPeriodSummaries.delete({ id: `${id}__part${index}` }).catch(() => undefined);
  }
}

function splitPayload(payload: any): any[] {
  if (JSON.stringify(payload ?? {}).length <= MAX_DOC_CHARS) return [payload ?? {}];
  if (Array.isArray(payload?.records) && payload.records.length > 1) {
    const step = Math.max(1, Math.ceil(payload.records.length / 2));
    return [payload.records.slice(0, step), payload.records.slice(step)].flatMap(records => splitPayload({ records }));
  }
  if (payload?.users && typeof payload.users === 'object') {
    const keys = Object.keys(payload.users);
    if (keys.length > 1) {
      const step = Math.max(1, Math.ceil(keys.length / 2));
      return [keys.slice(0, step), keys.slice(step)].flatMap(slice => {
        const users: Record<string, unknown> = {};
        for (const key of slice) users[key] = payload.users[key];
        return splitPayload({ ...payload, users });
      });
    }
  }
  if (payload?.days && typeof payload.days === 'object') {
    const keys = Object.keys(payload.days);
    if (keys.length > 1) {
      const step = Math.max(1, Math.ceil(keys.length / 2));
      return [keys.slice(0, step), keys.slice(step)].flatMap(slice => {
        const days: Record<string, unknown> = {};
        for (const key of slice) days[key] = payload.days[key];
        return splitPayload({ ...payload, days });
      });
    }
  }
  return [payload];
}

function mergeParts(parts: any[]): any {
  const merged: any = {};
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    for (const [key, value] of Object.entries(part)) {
      if (Array.isArray(value)) merged[key] = [...(merged[key] || []), ...value];
      else if (value && typeof value === 'object') merged[key] = { ...(merged[key] || {}), ...(value as object) };
      else if (merged[key] === undefined) merged[key] = value;
    }
  }
  return merged;
}

async function pageAll(table: { findAll: Function }, query: any, maxRecords = 100000): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  while (rows.length < maxRecords) {
    const limit = Math.min(2000, maxRecords - rows.length);
    const { records, hasMore } = await table.findAll({ ...query, limit, offset });
    rows.push(...records);
    if (!hasMore || records.length === 0) break;
    offset += records.length;
  }
  return rows;
}

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = run().finally(() => { inflight.delete(key); });
  inflight.set(key, promise);
  return promise;
}

function exactSpec(report: string, start: string, end: string): SummaryDesc & { id: string } {
  if (report === 'preaching') {
    if (start === end) return { ...dayDesc(report, start), id: summaryId(report, 'day', start) };
    return { id: `${report}__span__${start}__${end}`, report, periodType: 'span', periodKey: `${start}__${end}`, start, end };
  }
  const period = classifyLeaderboardPeriod(start, end);
  const id = period.type === 'range' ? `${report}__range__${start}__${end}` : summaryId(report, period.type, period.key);
  return { id, report, periodType: period.type, periodKey: period.type === 'range' ? `${start}__${end}` : period.key, start, end };
}

function attendanceSpec(report: string, start: string, end: string): SummaryDesc & { id: string } {
  if (!start && !end) return { id: `${report}__open__all`, report, periodType: 'open', periodKey: 'all', start: '', end: '' };
  return { id: `${report}__range__${start}__${end}`, report, periodType: 'range', periodKey: `${start}__${end}`, start, end };
}

function dayDesc(report: string, day: string): SummaryDesc {
  return { report, periodType: 'day', periodKey: day, start: day, end: day };
}

function monthSpec(month: string): SummaryDesc & { id: string; month: string } {
  const start = `${month}-01`;
  const [year, monthNumber] = month.split('-').map(Number);
  const end = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
  return { id: summaryId('pipeline', 'month', month), report: 'pipeline', periodType: 'month', periodKey: month, start, end, month };
}

function summaryId(report: string, type: string, key: string): string {
  return `${report}__${type}__${key}`.replace(/\//g, '_').slice(0, 700);
}

function sourceUsers(event: ReportWrite): string[] {
  return [...new Set([refId(event.after?.user), refId(event.before?.user)].filter(Boolean))];
}

function uniqueDates(event: ReportWrite, field: string): string[] {
  return [...new Set([dayText(event.after?.[field]), dayText(event.before?.[field])].filter(Boolean))];
}

function covers(period: { start?: string; end?: string }, date: string): boolean {
  if (!period.start && !period.end) return true;
  if (!date) return false;
  if (period.start && date < period.start) return false;
  if (period.end && date > period.end) return false;
  return true;
}

function inRange(date: string, start: string, end: string): boolean {
  return !!date && (!start || date >= start) && (!end || date <= end);
}

function listDays(start: string, end: string): string[] {
  const days: string[] = [];
  if (!start || !end || start > end) return days;
  for (let day = start; day <= end && days.length < 366; day = shiftDate(day, 1)) days.push(day);
  return days;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function refId(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function dayText(value: unknown): string {
  const text = String(value || '').split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function compactStd(record: any, id: string) {
  return { id: String(record.id || id), session: record.session ?? '', date: record.date || '', user: record.user ?? '', source: record.source || '' };
}

function compactBv(record: any, id: string) {
  return {
    id: String(record.id || id),
    attendanceDate: record.attendanceDate || '',
    user: record.user ?? '',
    sessionTopic: record.sessionTopic || '',
    group: record.group ?? '',
    groupId: record.groupId ?? '',
    present: record.present === true,
  };
}

function rosterUser(user: any): PreachingRosterUser {
  return {
    id: String(user.id),
    residency: refId(user.residency) || null,
    residencyApproved: !!user.residencyApproved,
    isB: !!user.isB,
    isOtherCenter: !!user.isOtherCenter,
  };
}

function rosterGroup(group: any): PreachingRosterGroup {
  return { id: String(group.id), bvslLeader: refId(group.bvslLeader) || null };
}

function emptyPreachingDay(): PreachingDayFact {
  return { sadhana: {}, preaching: {}, attendance: {} };
}

function normalizePreachingDay(fact: any): PreachingDayFact {
  return {
    sadhana: { ...(fact?.sadhana || {}) },
    preaching: { ...(fact?.preaching || {}) },
    attendance: { ...(fact?.attendance || {}) },
  };
}

function emptyPipeline() {
  return { sadhana: {}, oneOnOnes: {}, bvslMeetings: {} };
}

function emptyBucket(): PipelineBucket {
  return { chantingSum: 0, chantingCount: 0, readingSum: 0, readingCount: 0, hearingSum: 0, hearingCount: 0, books: 0, preachMins: 0 };
}

function emptyCount(): CountSum {
  return { sum: 0, count: 0 };
}

function emptyFolkTotals(user: string): FolkTotals {
  return {
    user,
    entryCount: 0,
    flagSick: false,
    flagOs: false,
    normalCount: 0,
    roundsCount: emptyCount(),
    spReadingMinutes: emptyCount(),
    roundsPoints: emptyCount(),
    spReadingPoints: emptyCount(),
    reportSendingPoints: emptyCount(),
    sbAll: emptyCount(),
    sbNormal: emptyCount(),
    maAll: emptyCount(),
    maNormal: emptyCount(),
    quotesAll: emptyCount(),
    quotesNormal: emptyCount(),
    japaAll: emptyCount(),
    japaNormal: emptyCount(),
    cleanAll: emptyCount(),
    cleanNormal: emptyCount(),
    serviceAll: emptyCount(),
    serviceNormal: emptyCount(),
    sleepQualityAll: emptyCount(),
    sleepQualityNormal: emptyCount(),
    bathAll: emptyCount(),
    bathNormal: emptyCount(),
    japaTimeAll: emptyCount(),
    japaTimeNormal: emptyCount(),
    sleepAll: emptyCount(),
    sleepNormal: emptyCount(),
    study: emptyCount(),
    preachingTotal: 0,
    booksTotal: 0,
    totalScore: 0,
    totalMaxScore: 0,
    scorePercent: emptyCount(),
    singleScore: null,
  };
}

function addCounts(left: CountSum, right: CountSum): CountSum {
  return { sum: left.sum + right.sum, count: left.count + right.count };
}

function addNumber(bucket: CountSum, value: unknown): void {
  if (value == null || value === '') return;
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  bucket.sum += number;
  bucket.count += 1;
}

function addPositive(bucket: CountSum, value: unknown): void {
  if (value == null || value === '') return;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return;
  bucket.sum += number;
  bucket.count += 1;
}

function addBoth(all: CountSum, normal: CountSum, value: unknown, isNormal: boolean): void {
  addNumber(all, value);
  if (isNormal) addNumber(normal, value);
}

function average(bucket: CountSum): number | null {
  if (!bucket.count) return null;
  return Math.round((bucket.sum / bucket.count) * 10) / 10;
}

function bathPoints(entry: any): number {
  let values: Record<string, any> = {};
  try { values = entry.fieldValuesJson ? JSON.parse(entry.fieldValuesJson) : {}; } catch { values = {}; }
  const bath = values.bath === true || values.bath === 'true' || Number(values.bath) === 1;
  return bath ? -1 : 0;
}

function parseHHMM(value: unknown): number | null {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  return minutes > 0 ? minutes : null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function warnWrite(error: unknown): void {
  console.warn('[report] period summary write failed', error instanceof Error ? error.message : error);
}

function warnRefresh(error: unknown): void {
  console.warn('[report] summary refresh failed', error instanceof Error ? error.message : error);
}
