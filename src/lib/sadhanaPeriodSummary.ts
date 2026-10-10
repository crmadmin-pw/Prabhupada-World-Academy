/**
 * Stored Sadhana leaderboard summaries.
 *
 * A day, ISO week, or calendar month is aggregated once and saved. Later
 * leaderboard views read those rows. Submissions keep the affected periods
 * up to date, including the streak as of a past period's end.
 */
import { SadhanaEntries, SadhanaMonthlySummaries, SadhanaPeriodSummaries, SadhanaPeriodSummaryMeta, Users } from '@/lib/backend-sdk';
import { DASHBOARD_RECENT_DAYS } from './sadhanaHistoryWindow';
import { pwScoreFromFieldValues } from './pwSadhana';
import { computeStreak, daysAgo, getTodayIST } from './streakUtils';

const ENTRY_FIELDS = ['id', 'user', 'entryDate', 'totalScore', 'scorePercent', 'maxScore', 'flagSick', 'flagOs', 'submittedAt', 'fieldValuesJson'];
const SUMMARY_FIELDS = [
  'user', 'entryCount', 'entryDates', 'totalScore', 'totalMaxScore', 'latestMaxScore', 'latestEntryDate',
  'scorePercentSum', 'scorePercentCount', 'pwPercentSum', 'pwPercentCount', 'flagSick', 'flagOs',
  'latestSubmittedAt', 'streakAtEnd',
];
const STREAK_THRESHOLD = 75;

export type PeriodType = 'day' | 'week' | 'month' | 'range';

export type PeriodSpec = {
  type: PeriodType;
  key: string;
  start: string;
  end: string;
};

export type LeaderboardAggregate = {
  user: string;
  entryCount: number;
  entryDates: string[];
  totalScore: number;
  totalMaxScore: number;
  latestMaxScore: number;
  latestEntryDate: string;
  scorePercentSum: number;
  scorePercentCount: number;
  pwPercentSum: number;
  pwPercentCount: number;
  flagSick: boolean;
  flagOs: boolean;
  latestSubmittedAt: string | null;
  streakAtEnd: number;
};

type StreakFact = { user: string; qualifyingDates: string[]; streakAtEnd: number };
type StreakMap = Map<string, StreakFact>;

export type LeaderboardFacts = {
  aggregates: Map<string, LeaderboardAggregate>;
  streaks: StreakMap;
};

const inflight = new Map<string, Promise<LeaderboardFacts>>();

export function scoreFromAggregate(aggregate: LeaderboardAggregate, isPw: boolean): number | null {
  if (isPw) {
    return aggregate.pwPercentCount > 0
      ? Math.round(aggregate.pwPercentSum / aggregate.pwPercentCount)
      : null;
  }
  if (aggregate.entryCount === 1) {
    return aggregate.scorePercentCount > 0
      ? Math.round(aggregate.scorePercentSum / aggregate.scorePercentCount)
      : null;
  }
  if (aggregate.totalMaxScore > 0) {
    return Math.min(100, Math.round((aggregate.totalScore / aggregate.totalMaxScore) * 100));
  }
  if (aggregate.scorePercentCount > 0) {
    return Math.round(aggregate.scorePercentSum / aggregate.scorePercentCount);
  }
  return null;
}

export function aggregateForAliases(aliases: string[], facts: LeaderboardFacts): {
  aggregate: LeaderboardAggregate | null;
  qualifyingDates: string[];
  streakAtEnd: number;
} {
  const keys = [...new Set(aliases.map(alias => alias.trim().toLowerCase()).filter(Boolean))];
  let aggregate: LeaderboardAggregate | null = null;
  const dates = new Set<string>();
  let streakAtEnd = 0;
  for (const key of keys) {
    const row = facts.aggregates.get(key);
    if (row) aggregate = aggregate ? mergeAggregates(aggregate, row) : { ...row, entryDates: [...row.entryDates] };
    const streak = facts.streaks.get(key);
    streak?.qualifyingDates.forEach(date => dates.add(date));
    if (streak) streakAtEnd = Math.max(streakAtEnd, streak.streakAtEnd);
  }
  if (aggregate) streakAtEnd = Math.max(streakAtEnd, aggregate.streakAtEnd);
  return { aggregate, qualifyingDates: [...dates], streakAtEnd };
}

export function isoWeekOf(date: string): { key: string; start: string; end: string } {
  const start = shiftDate(date, 1 - isoWeekday(date));
  const end = shiftDate(start, 6);
  const thursday = shiftDate(start, 3);
  const isoYear = Number(thursday.slice(0, 4));
  const januaryFirst = `${isoYear}-01-01`;
  const januaryWeekday = isoWeekday(januaryFirst);
  const firstThursday = shiftDate(januaryFirst, januaryWeekday <= 4 ? 4 - januaryWeekday : 11 - januaryWeekday);
  const week = 1 + Math.round((Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${firstThursday}T00:00:00Z`)) / 604800000);
  return { key: `${isoYear}-W${String(week).padStart(2, '0')}`, start, end };
}

export function monthOf(date: string): { key: string; start: string; end: string } {
  const key = date.slice(0, 7);
  const [year, month] = key.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { key, start: `${key}-01`, end };
}

export function classifyLeaderboardPeriod(startDate: string, endDate: string): PeriodSpec {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (start === end) return { type: 'day', key: start, start, end };
  const week = isoWeekOf(start);
  if (week.start === start && week.end === end) return { type: 'week', key: week.key, start, end };
  const month = monthOf(start);
  if (month.start === start && month.end === end) return { type: 'month', key: month.key, start, end };
  return { type: 'range', key: `${start}__${end}`, start, end };
}

export async function loadLeaderboardFacts(startDate: string, endDate: string, today: string): Promise<LeaderboardFacts> {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);
  if (!start || !end || start > end) return emptyFacts();
  const period = classifyLeaderboardPeriod(start, end);
  const key = `${storageId(period)}__${today}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = loadUncached(period, today).finally(() => { inflight.delete(key); });
  inflight.set(key, run);
  return run;
}

export async function refreshUserPeriodSummaries(input: {
  userId: string;
  entryDate: string;
  savedEntry?: Record<string, any>;
  now?: string;
}): Promise<void> {
  try {
    const userId = String(input.userId || '').trim();
    const entryDate = String(input.entryDate || '').slice(0, 10);
    if (!userId || !entryDate) return;
    const today = getTodayIST();
    const now = input.now || new Date().toISOString();
    const { records } = await SadhanaEntries.findAll({
      filters: { user: userId },
      fields: ENTRY_FIELDS,
    });
    const entries = input.savedEntry
      ? [...records.filter((entry: any) => entryDateOf(entry) !== entryDate), input.savedEntry]
      : records;
    for (const period of periodsTouching(entryDate)) {
      const inPeriod = entries.filter((entry: any) => {
        const date = entryDateOf(entry);
        return date >= period.start && date <= period.end;
      });
      const aggregate = aggregateEntries(userId, inPeriod);
      if (!aggregate) continue;
      if (period.end < today) {
        const dates = qualifyingDates(entries, daysAgo(period.end, DASHBOARD_RECENT_DAYS), period.end);
        aggregate.streakAtEnd = computeStreak(dates.map(date => ({ entryDate: date, scorePercent: STREAK_THRESHOLD })), period.end);
        await writeStreak(period.end, userId, dates, aggregate.streakAtEnd, now);
      }
      await writeSummary(period, aggregate, now);
    }
    if (entryDate === today) {
      const lookback = daysAgo(today, DASHBOARD_RECENT_DAYS);
      const recent = entries.filter((entry: any) => {
        const date = entryDateOf(entry);
        return date >= lookback && date <= today;
      });
      await Users.update({
        id: userId,
        record: { currentStreak: computeStreak(recent, today), lastStreakUpdatedAt: now },
      });
    }
  } catch (error) {
    console.warn('[sadhana] period summary refresh failed', error instanceof Error ? error.message : error);
  }
}

export async function deleteStoredLeaderboardPeriod(startDate: string, endDate: string): Promise<void> {
  const period = classifyLeaderboardPeriod(startDate.slice(0, 10), endDate.slice(0, 10));
  await deletePeriodDocs(storageId(period));
  await deletePeriodDocs(streakStorageId(period.end));
  await SadhanaPeriodSummaryMeta.delete({ id: storageId(period) }).catch(() => undefined);
}

function emptyFacts(): LeaderboardFacts {
  return { aggregates: new Map(), streaks: new Map() };
}

async function loadUncached(period: PeriodSpec, today: string): Promise<LeaderboardFacts> {
  if (period.type === 'range') return loadComposedDays(period, today);
  return loadAligned(period, today);
}

async function loadAligned(period: PeriodSpec, today: string): Promise<LeaderboardFacts> {
  const historical = period.end < today;
  try {
    const meta = await readMeta(period);
    if (meta?.ready && (!historical || meta.streakFinal)) return await readStored(period, historical);
    if (meta?.ready && historical && !meta.streakFinal) {
      const facts = await readStored(period, false);
      facts.streaks = await backfillStreaks(period);
      await markMeta(period, true, new Date().toISOString());
      return facts;
    }
  } catch (error) {
    console.warn('[sadhana] stored leaderboard read failed', error instanceof Error ? error.message : error);
  }
  return materialize(period, today, false);
}

async function loadComposedDays(period: PeriodSpec, today: string): Promise<LeaderboardFacts> {
  const historical = period.end < today;
  const dayPeriods = listDays(period.start, period.end).map(day => classifyLeaderboardPeriod(day, day));
  try {
    const metas = await Promise.all(dayPeriods.map(readMeta));
    const ready = dayPeriods.length > 0 && metas.every(meta => meta?.ready) && (!historical || metas[metas.length - 1]?.streakFinal);
    if (ready) {
      const facts = emptyFacts();
      for (const dayPeriod of dayPeriods) {
        const dayFacts = await readStored(dayPeriod, false);
        for (const [key, aggregate] of dayFacts.aggregates) {
          const existing = facts.aggregates.get(key);
          facts.aggregates.set(key, existing ? mergeAggregates(existing, aggregate) : aggregate);
        }
      }
      if (historical) facts.streaks = await readStreaks(period.end);
      return facts;
    }
  } catch (error) {
    console.warn('[sadhana] stored leaderboard read failed', error instanceof Error ? error.message : error);
  }
  return materialize(period, today, true);
}

async function materialize(period: PeriodSpec, today: string, perDay: boolean): Promise<LeaderboardFacts> {
  const updatedAt = new Date().toISOString();
  const historical = period.end < today;
  const scoreEnd = period.end < today ? period.end : today;
  const scanStart = historical ? earlier(period.start, daysAgo(period.end, DASHBOARD_RECENT_DAYS)) : period.start;
  const entries = await loadEntries(scanStart, scoreEnd);
  let facts = factsFromEntries(period, entries, scoreEnd, historical);
  if (!facts.aggregates.size && period.type === 'month') {
    const archived = await loadArchivedMonth(period);
    if (archived.aggregates.size) facts = archived;
  }
  try {
    if (perDay) await persistDays(period, entries, facts, historical, updatedAt);
    else await persistPeriod(period, facts, historical, updatedAt);
  } catch (error) {
    console.warn('[sadhana] period summary write failed', error instanceof Error ? error.message : error);
  }
  return facts;
}

async function backfillStreaks(period: PeriodSpec): Promise<StreakMap> {
  const updatedAt = new Date().toISOString();
  const entries = await loadEntries(daysAgo(period.end, DASHBOARD_RECENT_DAYS), period.end);
  const facts = factsFromEntries(period, entries, period.end, true);
  await eachChunk([...facts.streaks.values()], 20, streak =>
    writeStreak(period.end, streak.user, streak.qualifyingDates, streak.streakAtEnd, updatedAt));
  return facts.streaks;
}

async function persistPeriod(period: PeriodSpec, facts: LeaderboardFacts, historical: boolean, updatedAt: string) {
  await eachChunk([...facts.aggregates.values()], 20, aggregate => writeSummary(period, aggregate, updatedAt));
  await eachChunk([...facts.streaks.values()], 20, streak =>
    writeStreak(period.end, streak.user, streak.qualifyingDates, streak.streakAtEnd, updatedAt));
  await markMeta(period, historical, updatedAt);
}

async function persistDays(period: PeriodSpec, entries: any[], facts: LeaderboardFacts, historical: boolean, updatedAt: string) {
  const requested = new Set(listDays(period.start, period.end));
  const byDay = new Map<string, any[]>();
  for (const entry of entries) {
    const date = entryDateOf(entry);
    if (!requested.has(date)) continue;
    const list = byDay.get(date) || [];
    list.push(entry);
    byDay.set(date, list);
  }
  for (const day of requested) {
    const dayPeriod = classifyLeaderboardPeriod(day, day);
    const groups = new Map<string, any[]>();
    for (const entry of byDay.get(day) || []) {
      const user = entryUser(entry);
      if (!user) continue;
      const key = userKey(user);
      const list = groups.get(key) || [];
      list.push(entry);
      groups.set(key, list);
    }
    const aggregates: LeaderboardAggregate[] = [];
    for (const list of groups.values()) {
      const aggregate = aggregateEntries(entryUser(list[0]), list);
      if (aggregate) aggregates.push(aggregate);
    }
    await eachChunk(aggregates, 20, aggregate => writeSummary(dayPeriod, aggregate, updatedAt));
    await markMeta(dayPeriod, historical && day === period.end, updatedAt);
  }
  if (historical) {
    await eachChunk([...facts.streaks.values()], 20, streak =>
      writeStreak(period.end, streak.user, streak.qualifyingDates, streak.streakAtEnd, updatedAt));
  }
}

function factsFromEntries(period: PeriodSpec, entries: any[], scoreEnd: string, historical: boolean): LeaderboardFacts {
  const facts = emptyFacts();
  const byUser = new Map<string, any[]>();
  for (const entry of entries) {
    const user = entryUser(entry);
    if (!user) continue;
    const key = userKey(user);
    const list = byUser.get(key) || [];
    list.push(entry);
    byUser.set(key, list);
  }
  const streakStart = daysAgo(period.end, DASHBOARD_RECENT_DAYS);
  for (const [key, list] of byUser) {
    const user = entryUser(list[0]);
    const scored = list.filter(entry => {
      const date = entryDateOf(entry);
      return date >= period.start && date <= period.end && date <= scoreEnd;
    });
    const aggregate = aggregateEntries(user, scored);
    if (historical) {
      const dates = qualifyingDates(list, streakStart, period.end);
      const streakAtEnd = computeStreak(dates.map(entryDate => ({ entryDate, scorePercent: STREAK_THRESHOLD })), period.end);
      if (dates.length) facts.streaks.set(key, { user, qualifyingDates: dates, streakAtEnd });
      if (aggregate) aggregate.streakAtEnd = streakAtEnd;
    }
    if (aggregate) facts.aggregates.set(key, aggregate);
  }
  return facts;
}

async function loadArchivedMonth(period: PeriodSpec): Promise<LeaderboardFacts> {
  const facts = emptyFacts();
  const rows = await pageAll(SadhanaMonthlySummaries, {
    filters: { month: period.key },
    fields: ['user', 'daysFiled', 'entriesArchived', 'avgScorePercent', 'totalScore', 'totalMaxScore', 'sickDays', 'osDays', 'streakAtMonthEnd'],
  });
  for (const row of rows) {
    const aggregate = aggregateFromMonthlySummary(row, period);
    if (!aggregate) continue;
    const key = userKey(aggregate.user);
    const existing = facts.aggregates.get(key);
    facts.aggregates.set(key, existing ? mergeAggregates(existing, aggregate) : aggregate);
  }
  return facts;
}

function aggregateFromMonthlySummary(row: any, period: PeriodSpec): LeaderboardAggregate | null {
  const user = entryUser(row);
  const days = Number(row.daysFiled ?? row.entriesArchived ?? 0) || 0;
  if (!user || days <= 0) return null;
  const storedAverage = Number(row.avgScorePercent);
  const percent = Number.isFinite(storedAverage) ? (storedAverage <= 1 ? storedAverage * 100 : storedAverage) : 0;
  return {
    user,
    entryCount: days,
    entryDates: Array.from({ length: days }, (_, index) => `${period.key}:${index}`),
    totalScore: Number(row.totalScore) || 0,
    totalMaxScore: Number(row.totalMaxScore) || 0,
    latestMaxScore: Number(row.totalMaxScore) || 0,
    latestEntryDate: period.end,
    scorePercentSum: percent * (days === 1 ? 1 : days),
    scorePercentCount: days === 1 ? 1 : days,
    pwPercentSum: percent * days,
    pwPercentCount: days,
    flagSick: Number(row.sickDays) > 0,
    flagOs: Number(row.osDays) > 0,
    latestSubmittedAt: null,
    streakAtEnd: Number(row.streakAtMonthEnd) || 0,
  };
}

function aggregateEntries(user: string, entries: any[]): LeaderboardAggregate | null {
  if (!entries.length) return null;
  const aggregate = blankAggregate(user);
  for (const entry of entries) addEntry(aggregate, entry);
  aggregate.entryDates.sort();
  return aggregate;
}

function blankAggregate(user: string): LeaderboardAggregate {
  return {
    user,
    entryCount: 0,
    entryDates: [],
    totalScore: 0,
    totalMaxScore: 0,
    latestMaxScore: 0,
    latestEntryDate: '',
    scorePercentSum: 0,
    scorePercentCount: 0,
    pwPercentSum: 0,
    pwPercentCount: 0,
    flagSick: false,
    flagOs: false,
    latestSubmittedAt: null,
    streakAtEnd: 0,
  };
}

function addEntry(aggregate: LeaderboardAggregate, entry: any) {
  const date = entryDateOf(entry);
  aggregate.entryCount += 1;
  if (date && !aggregate.entryDates.includes(date)) aggregate.entryDates.push(date);
  aggregate.totalScore += Number(entry.totalScore) || 0;
  aggregate.totalMaxScore += Number(entry.maxScore) || 0;
  const percent = numeric(entry.scorePercent);
  if (percent != null) {
    aggregate.scorePercentSum += percent;
    aggregate.scorePercentCount += 1;
  }
  const pwPercent = pwScoreFromFieldValues(entry.fieldValuesJson).scorePercent;
  if (pwPercent != null) {
    aggregate.pwPercentSum += pwPercent;
    aggregate.pwPercentCount += 1;
  }
  if (entry.flagSick) aggregate.flagSick = true;
  if (entry.flagOs) aggregate.flagOs = true;
  const submitted = entry.submittedAt ? String(entry.submittedAt) : '';
  const later = !aggregate.latestEntryDate
    || date > aggregate.latestEntryDate
    || (date === aggregate.latestEntryDate && submitted >= (aggregate.latestSubmittedAt || ''));
  if (later) {
    aggregate.latestEntryDate = date;
    aggregate.latestSubmittedAt = submitted || null;
    aggregate.latestMaxScore = Number(entry.maxScore) || 0;
  }
}

function qualifyingDates(entries: any[], start: string, end: string): string[] {
  const dates = new Set<string>();
  for (const entry of entries) {
    const date = entryDateOf(entry);
    const score = numeric(entry.scorePercent);
    if (date >= start && date <= end && score != null && score >= STREAK_THRESHOLD) dates.add(date);
  }
  return [...dates];
}

export function mergeAggregates(left: LeaderboardAggregate, right: LeaderboardAggregate): LeaderboardAggregate {
  const rightIsLater = right.latestEntryDate > left.latestEntryDate
    || (right.latestEntryDate === left.latestEntryDate && (right.latestSubmittedAt || '') >= (left.latestSubmittedAt || ''));
  return {
    user: left.user || right.user,
    entryCount: left.entryCount + right.entryCount,
    entryDates: [...new Set([...left.entryDates, ...right.entryDates])].sort(),
    totalScore: left.totalScore + right.totalScore,
    totalMaxScore: left.totalMaxScore + right.totalMaxScore,
    latestMaxScore: rightIsLater ? right.latestMaxScore : left.latestMaxScore,
    latestEntryDate: rightIsLater ? right.latestEntryDate : left.latestEntryDate,
    scorePercentSum: left.scorePercentSum + right.scorePercentSum,
    scorePercentCount: left.scorePercentCount + right.scorePercentCount,
    pwPercentSum: left.pwPercentSum + right.pwPercentSum,
    pwPercentCount: left.pwPercentCount + right.pwPercentCount,
    flagSick: left.flagSick || right.flagSick,
    flagOs: left.flagOs || right.flagOs,
    latestSubmittedAt: rightIsLater ? right.latestSubmittedAt : left.latestSubmittedAt,
    streakAtEnd: Math.max(left.streakAtEnd, right.streakAtEnd),
  };
}

async function readStored(period: PeriodSpec, includeStreaks: boolean): Promise<LeaderboardFacts> {
  const facts = emptyFacts();
  const rows = await pageAll(SadhanaPeriodSummaries, {
    filters: { periodId: storageId(period) },
    fields: SUMMARY_FIELDS,
  });
  for (const row of rows) {
    const aggregate = asAggregate(row);
    if (!aggregate) continue;
    const key = userKey(aggregate.user);
    const existing = facts.aggregates.get(key);
    facts.aggregates.set(key, existing ? mergeAggregates(existing, aggregate) : aggregate);
  }
  if (includeStreaks) facts.streaks = await readStreaks(period.end);
  return facts;
}

async function readStreaks(asOf: string): Promise<StreakMap> {
  const streaks: StreakMap = new Map();
  const rows = await pageAll(SadhanaPeriodSummaries, {
    filters: { periodId: streakStorageId(asOf) },
    fields: ['user', 'qualifyingDates', 'streakAtEnd'],
  });
  for (const row of rows) {
    const user = entryUser(row);
    if (!user) continue;
    const qualifyingDates = Array.isArray(row.qualifyingDates) ? row.qualifyingDates.map((date: unknown) => String(date)) : [];
    streaks.set(userKey(user), { user, qualifyingDates, streakAtEnd: Number(row.streakAtEnd) || 0 });
  }
  return streaks;
}

function asAggregate(row: any): LeaderboardAggregate | null {
  const user = entryUser(row);
  if (!user) return null;
  const entryDates = Array.isArray(row.entryDates) ? row.entryDates.map((date: unknown) => String(date)) : [];
  const entryCount = Number(row.entryCount) || entryDates.length;
  if (entryCount <= 0) return null;
  return {
    user,
    entryCount,
    entryDates,
    totalScore: Number(row.totalScore) || 0,
    totalMaxScore: Number(row.totalMaxScore) || 0,
    latestMaxScore: Number(row.latestMaxScore) || 0,
    latestEntryDate: String(row.latestEntryDate || ''),
    scorePercentSum: Number(row.scorePercentSum) || 0,
    scorePercentCount: Number(row.scorePercentCount) || 0,
    pwPercentSum: Number(row.pwPercentSum) || 0,
    pwPercentCount: Number(row.pwPercentCount) || 0,
    flagSick: row.flagSick === true,
    flagOs: row.flagOs === true,
    latestSubmittedAt: row.latestSubmittedAt ? String(row.latestSubmittedAt) : null,
    streakAtEnd: Number(row.streakAtEnd) || 0,
  };
}

async function writeSummary(period: PeriodSpec, aggregate: LeaderboardAggregate, updatedAt: string) {
  const id = documentId(storageId(period), aggregate.user);
  await writeIfCurrent(SadhanaPeriodSummaries, id, {
    user: aggregate.user,
    periodId: storageId(period),
    periodType: period.type,
    periodKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    entryCount: aggregate.entryCount,
    entryDates: aggregate.entryDates,
    totalScore: aggregate.totalScore,
    totalMaxScore: aggregate.totalMaxScore,
    latestMaxScore: aggregate.latestMaxScore,
    latestEntryDate: aggregate.latestEntryDate,
    scorePercentSum: aggregate.scorePercentSum,
    scorePercentCount: aggregate.scorePercentCount,
    pwPercentSum: aggregate.pwPercentSum,
    pwPercentCount: aggregate.pwPercentCount,
    flagSick: aggregate.flagSick,
    flagOs: aggregate.flagOs,
    latestSubmittedAt: aggregate.latestSubmittedAt,
    streakAtEnd: aggregate.streakAtEnd,
    updatedAt,
  }, updatedAt);
}

async function writeStreak(asOf: string, user: string, qualifyingDates: string[], streakAtEnd: number, updatedAt: string) {
  const periodId = streakStorageId(asOf);
  await writeIfCurrent(SadhanaPeriodSummaries, documentId(periodId, user), {
    user,
    periodId,
    periodType: 'streak',
    periodKey: asOf,
    qualifyingDates,
    streakAtEnd,
    updatedAt,
  }, updatedAt);
}

async function writeIfCurrent(table: { findOne: Function; update: Function; create: Function }, id: string, record: Record<string, unknown>, updatedAt: string) {
  const existing = await table.findOne({ id, fields: ['updatedAt'] });
  if (existing?.updatedAt && String(existing.updatedAt) > updatedAt) return;
  if (existing) await table.update({ id, record });
  else await table.create({ record: { ...record, id } });
}

async function readMeta(period: PeriodSpec): Promise<{ ready?: boolean; streakFinal?: boolean } | null> {
  return SadhanaPeriodSummaryMeta.findOne({ id: storageId(period), fields: ['ready', 'streakFinal'] });
}

async function markMeta(period: PeriodSpec, streakFinal: boolean, updatedAt: string) {
  const id = storageId(period);
  const record = {
    periodId: id,
    periodType: period.type,
    periodKey: period.key,
    periodStart: period.start,
    periodEnd: period.end,
    ready: true,
    streakFinal,
    materializedAt: updatedAt,
    updatedAt,
  };
  const existing = await SadhanaPeriodSummaryMeta.findOne({ id, fields: ['id'] });
  if (existing) await SadhanaPeriodSummaryMeta.update({ id, record });
  else await SadhanaPeriodSummaryMeta.create({ record: { ...record, id } });
}

async function loadEntries(start: string, end: string): Promise<any[]> {
  if (!start || !end || start > end) return [];
  const filters = start === end ? { entryDate: start } : { entryDate: { gte: start, lte: end } };
  return pageAll(SadhanaEntries, { filters, fields: ENTRY_FIELDS });
}

async function pageAll(table: { findAll: (query: any) => Promise<{ records: any[]; hasMore: boolean }> }, query: any): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { records, hasMore } = await table.findAll({ ...query, limit: 2000, offset });
    rows.push(...records);
    if (!hasMore || records.length === 0) break;
    offset += records.length;
  }
  return rows;
}

async function deletePeriodDocs(periodIdValue: string) {
  const rows = await pageAll(SadhanaPeriodSummaries, { filters: { periodId: periodIdValue }, fields: ['user'] });
  for (const row of rows) {
    const user = entryUser(row);
    if (!user) continue;
    await SadhanaPeriodSummaries.delete({ id: documentId(periodIdValue, user) }).catch(() => undefined);
  }
}

async function eachChunk<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(item => run(item)));
  }
}

function periodsTouching(date: string): PeriodSpec[] {
  const week = isoWeekOf(date);
  const month = monthOf(date);
  return [
    { type: 'day', key: date, start: date, end: date },
    { type: 'week', key: week.key, start: week.start, end: week.end },
    { type: 'month', key: month.key, start: month.start, end: month.end },
  ];
}

function listDays(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end && days.length < 366; day = shiftDate(day, 1)) days.push(day);
  return days;
}

function storageId(period: PeriodSpec): string {
  return `${period.type}__${period.key}`;
}

function streakStorageId(asOf: string): string {
  return `streak__${asOf}`;
}

function documentId(prefix: string, user: string): string {
  return `${prefix}__${userKey(user).replace(/\//g, '_')}`.slice(0, 700);
}

function entryUser(entry: any): string {
  const user = Array.isArray(entry?.user) ? entry.user[0] : entry?.user;
  return String(user || '').trim();
}

function entryDateOf(entry: any): string {
  return String(entry?.entryDate || '').slice(0, 10);
}

function userKey(user: string): string {
  return user.trim().toLowerCase();
}

function earlier(left: string, right: string): string {
  return left < right ? left : right;
}

function numeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoWeekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
