import assert from 'node:assert/strict';
import test from 'node:test';
import { endOfISOWeek, format, getISOWeek, getISOWeekYear, startOfISOWeek } from 'date-fns';

import getSadhanaLeaderboard from '../src/api/getSadhanaLeaderboard';
import { SadhanaEntries, SadhanaMonthlySummaries, Users } from '../src/lib/app-backend-sdk';
import {
  classifyLeaderboardPeriod,
  deleteStoredLeaderboardPeriod,
  isoWeekOf,
  monthOf,
  refreshUserPeriodSummaries,
  scoreFromAggregate,
  type LeaderboardAggregate,
} from '../src/lib/sadhanaPeriodSummary';
import { getTodayIST } from '../src/lib/streakUtils';

function dayBefore(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function adminContext(user: { id: string }) {
  return {
    user: {
      ...user,
      uid: user.id,
      role: 'SUPER_ADMIN',
      isBvSuperAdmin: true,
      isBvAdmin: true,
    },
  };
}

async function cleanupAround(dates: string[]) {
  for (const date of dates) {
    const week = isoWeekOf(date);
    const month = monthOf(date);
    await deleteStoredLeaderboardPeriod(date, date);
    await deleteStoredLeaderboardPeriod(week.start, week.end);
    await deleteStoredLeaderboardPeriod(month.start, month.end);
  }
}

function watchEntryScans() {
  const original = SadhanaEntries.findAll.bind(SadhanaEntries);
  let scans = 0;
  (SadhanaEntries as any).findAll = async (query: any = {}) => {
    scans += 1;
    return original(query);
  };
  return {
    count: () => scans,
    reset: () => { scans = 0; },
    restore: () => { (SadhanaEntries as any).findAll = original; },
  };
}

test('period keys follow the leaderboard week and month selectors', () => {
  for (const [year, month, day] of [[2026, 0, 1], [2026, 7, 10], [2025, 11, 29]] as const) {
    const local = new Date(year, month, day);
    const iso = format(local, 'yyyy-MM-dd');
    const week = isoWeekOf(iso);
    assert.equal(week.start, format(startOfISOWeek(local), 'yyyy-MM-dd'));
    assert.equal(week.end, format(endOfISOWeek(local), 'yyyy-MM-dd'));
    assert.equal(week.key, `${getISOWeekYear(local)}-W${String(getISOWeek(local)).padStart(2, '0')}`);
    const monthPeriod = monthOf(iso);
    assert.equal(classifyLeaderboardPeriod(monthPeriod.start, monthPeriod.end).type, 'month');
    assert.equal(classifyLeaderboardPeriod(week.start, week.end).type, 'week');
    assert.equal(classifyLeaderboardPeriod(iso, iso).type, 'day');
  }
});

test('multi-day scores use earned points over the max, including sick days', () => {
  const aggregate = {
    user: 'member',
    entryCount: 2,
    entryDates: ['2026-08-01', '2026-08-02'],
    totalScore: 18,
    totalMaxScore: 28,
    latestMaxScore: 20,
    latestEntryDate: '2026-08-02',
    scorePercentSum: 150,
    scorePercentCount: 2,
    pwPercentSum: 180,
    pwPercentCount: 2,
    flagSick: true,
    flagOs: false,
    latestSubmittedAt: null,
    streakAtEnd: 1,
  } satisfies LeaderboardAggregate;
  assert.equal(scoreFromAggregate(aggregate, false), 64);
  assert.equal(scoreFromAggregate(aggregate, true), 90);
});

test('a historical week is stored once and later views do not rescan entries', async () => {
  const week = isoWeekOf('2026-08-10');
  const earlier = dayBefore(week.end);
  const user = {
    id: 'SUM-WEEK-USER-DB',
    userId: 'SUM-WEEK-USER',
    email: 'sum-week@example.invalid',
    fullName: 'Summary Week User',
    status: 'Active',
    role: 'User',
    currentStreak: 1,
  };
  const firstEntry = {
    id: 'SUM-WEEK-ENTRY-1',
    user: user.id,
    entryDate: earlier,
    totalScore: 16,
    maxScore: 20,
    scorePercent: 80,
    submittedAt: `${earlier}T04:00:00.000Z`,
  };
  const lastEntry = {
    id: 'SUM-WEEK-ENTRY-2',
    user: user.id,
    entryDate: week.end,
    totalScore: 18,
    maxScore: 20,
    scorePercent: 90,
    submittedAt: `${week.end}T05:00:00.000Z`,
  };
  await cleanupAround([earlier, week.end]);
  await Users.create({ record: user });
  await SadhanaEntries.create({ record: firstEntry });
  await SadhanaEntries.create({ record: lastEntry });
  const watch = watchEntryScans();
  try {
    const first = await getSadhanaLeaderboard.execute({
      input: { startDate: week.start, endDate: week.end },
      context: adminContext(user),
    } as never);
    const row = first.leaderboard.find((item: any) => item.userId === user.userId);
    assert.equal(row?.scorePercent, 85);
    assert.equal(row?.daysSubmitted, 2);
    assert.equal(row?.weightedScore, 24.3);
    assert.equal(row?.currentStreak, 2);
    assert.equal(row?.flagSick, false);

    watch.reset();
    const second = await getSadhanaLeaderboard.execute({
      input: { startDate: week.start, endDate: week.end },
      context: adminContext(user),
    } as never);
    assert.equal(watch.count(), 0);
    assert.equal(second.leaderboard.find((item: any) => item.userId === user.userId)?.scorePercent, 85);

    await SadhanaEntries.update({
      id: lastEntry.id,
      record: { totalScore: 20, maxScore: 20, scorePercent: 100 },
    });
    await refreshUserPeriodSummaries({ userId: user.id, entryDate: week.end });
    watch.reset();
    const refreshed = await getSadhanaLeaderboard.execute({
      input: { startDate: week.start, endDate: week.end },
      context: adminContext(user),
    } as never);
    assert.equal(watch.count(), 0);
    const updated = refreshed.leaderboard.find((item: any) => item.userId === user.userId);
    assert.equal(updated?.scorePercent, 90);
    assert.equal(updated?.weightedScore, 25.7);
  } finally {
    watch.restore();
    await SadhanaEntries.delete({ id: firstEntry.id });
    await SadhanaEntries.delete({ id: lastEntry.id });
    await Users.delete({ id: user.id });
    await cleanupAround([earlier, week.end]);
  }
});

test('entries stored under different ids for one person are one leaderboard row', async () => {
  const week = isoWeekOf('2026-06-08');
  const earlier = dayBefore(week.end);
  const user = {
    id: 'SUM-ALIAS-USER-DB',
    userId: 'SUM-ALIAS-USER',
    email: 'sum-alias@example.invalid',
    fullName: 'Summary Alias User',
    status: 'Active',
    role: 'User',
  };
  await cleanupAround([earlier, week.end]);
  await Users.create({ record: user });
  await SadhanaEntries.create({
    record: {
      id: 'SUM-ALIAS-ENTRY-1',
      user: user.id,
      entryDate: earlier,
      totalScore: 16,
      maxScore: 20,
      scorePercent: 80,
    },
  });
  await SadhanaEntries.create({
    record: {
      id: 'SUM-ALIAS-ENTRY-2',
      user: user.email,
      entryDate: week.end,
      totalScore: 18,
      maxScore: 20,
      scorePercent: 90,
    },
  });
  try {
    const result = await getSadhanaLeaderboard.execute({
      input: { startDate: week.start, endDate: week.end },
      context: adminContext(user),
    } as never);
    const rows = result.leaderboard.filter((item: any) => item.userId === user.userId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].daysSubmitted, 2);
    assert.equal(rows[0].scorePercent, 85);
    assert.equal(rows[0].currentStreak, 2);
  } finally {
    await SadhanaEntries.delete({ id: 'SUM-ALIAS-ENTRY-1' });
    await SadhanaEntries.delete({ id: 'SUM-ALIAS-ENTRY-2' });
    await Users.delete({ id: user.id });
    await cleanupAround([earlier, week.end]);
  }
});

test('an archived month is read from its monthly summary without scanning entries again', async () => {
  const month = monthOf('2026-07-15');
  const user = {
    id: 'SUM-ARCHIVE-USER-DB',
    userId: 'SUM-ARCHIVE-USER',
    email: 'sum-archive@example.invalid',
    fullName: 'Summary Archive User',
    status: 'Active',
    role: 'User',
  };
  await deleteStoredLeaderboardPeriod(month.start, month.end);
  await Users.create({ record: user });
  await SadhanaMonthlySummaries.create({
    record: {
      id: 'SUM-ARCHIVE-MONTH',
      user: user.id,
      month: month.key,
      daysFiled: 10,
      avgScorePercent: 0.5,
      totalScore: 100,
      totalMaxScore: 200,
      sickDays: 1,
      osDays: 0,
      streakAtMonthEnd: 4,
    },
  });
  const watch = watchEntryScans();
  try {
    const first = await getSadhanaLeaderboard.execute({
      input: { startDate: month.start, endDate: month.end },
      context: adminContext(user),
    } as never);
    const row = first.leaderboard.find((item: any) => item.userId === user.userId);
    assert.equal(row?.scorePercent, 50);
    assert.equal(row?.daysSubmitted, 10);
    assert.equal(row?.weightedScore, 16.1);
    assert.equal(row?.currentStreak, 4);
    assert.equal(row?.flagSick, true);

    watch.reset();
    const second = await getSadhanaLeaderboard.execute({
      input: { startDate: month.start, endDate: month.end },
      context: adminContext(user),
    } as never);
    assert.equal(watch.count(), 0);
    assert.equal(second.leaderboard.find((item: any) => item.userId === user.userId)?.currentStreak, 4);
  } finally {
    watch.restore();
    await SadhanaMonthlySummaries.delete({ id: 'SUM-ARCHIVE-MONTH' });
    await Users.delete({ id: user.id });
    await deleteStoredLeaderboardPeriod(month.start, month.end);
  }
});

test('today is summarized once and the next view does not scan the collection', async () => {
  const today = getTodayIST();
  const user = {
    id: 'SUM-TODAY-USER-DB',
    userId: 'SUM-TODAY-USER',
    email: 'sum-today@example.invalid',
    fullName: 'Summary Today User',
    status: 'Active',
    role: 'User',
    currentStreak: 3,
  };
  await deleteStoredLeaderboardPeriod(today, today);
  await Users.create({ record: user });
  await SadhanaEntries.create({
    record: {
      id: 'SUM-TODAY-ENTRY',
      user: user.id,
      entryDate: today,
      totalScore: 18,
      maxScore: 20,
      scorePercent: 90,
      submittedAt: `${today}T05:00:00.000Z`,
    },
  });
  const watch = watchEntryScans();
  try {
    const first = await getSadhanaLeaderboard.execute({
      input: { date: today },
      context: adminContext(user),
    } as never);
    assert.equal(first.leaderboard.find((item: any) => item.userId === user.userId)?.currentStreak, 3);
    assert.ok(watch.count() >= 1);

    watch.reset();
    const second = await getSadhanaLeaderboard.execute({
      input: { date: today },
      context: adminContext(user),
    } as never);
    assert.equal(watch.count(), 0);
    assert.equal(second.leaderboard.find((item: any) => item.userId === user.userId)?.scorePercent, 90);
  } finally {
    watch.restore();
    await SadhanaEntries.delete({ id: 'SUM-TODAY-ENTRY' });
    await Users.delete({ id: user.id });
    await deleteStoredLeaderboardPeriod(today, today);
  }
});
