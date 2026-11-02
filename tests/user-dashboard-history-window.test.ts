import assert from 'node:assert/strict';
import test from 'node:test';
import getUserDashboardData from '../src/api/getUserDashboardData';
import { Users, SadhanaEntries } from '../src/lib/app-backend-sdk';
import { daysAgo, getTodayIST } from '../src/lib/streakUtils';
import { DASHBOARD_HISTORY_MAX_DAYS, DASHBOARD_RECENT_DAYS } from '../src/lib/sadhanaHistoryWindow';

const member = {
  id: 'user-1',
  userId: 'USER-1',
  fullName: 'Long Time Member',
  email: 'member@example.invalid',
  ashrayLevel: 'Jigyasa',
};

function entry(date: string) {
  return {
    id: `entry-${date}`,
    entryId: `entry-${date}`,
    user: member.id,
    entryDate: date,
    totalScore: 16,
    maxScore: 20,
    scorePercent: 80,
    submittedAt: `${date}T08:00:00.000Z`,
  };
}

test('opening the dashboard reads a capped recent window, not all-time history', async (t) => {
  const today = getTodayIST();
  const recent = daysAgo(today, 3);
  const ancient = '2019-01-01';
  const queries: any[] = [];

  t.mock.method(Users, 'findOne', async (query: any) => {
    if (query?.id === member.id || query?.filters?.userId === member.id || query?.filters?.userId === member.userId) {
      return member;
    }
    return null;
  });
  t.mock.method(SadhanaEntries, 'findAll', async (query: any) => {
    queries.push(query);
    const range = query.filters?.entryDate;
    const rows = [entry(ancient), entry(recent), entry(today)].filter(row => {
      if (!range) return true;
      if (range.gte && row.entryDate < range.gte) return false;
      if (range.lte && row.entryDate > range.lte) return false;
      if (range.lt && row.entryDate >= range.lt) return false;
      return true;
    });
    return { records: rows, hasMore: false };
  });

  const result = await getUserDashboardData.execute({
    input: { userId: member.userId, days: 30 },
    context: { user: { id: member.id, email: member.email } },
  } as never);

  assert.ok(queries.length > 0);
  for (const query of queries) {
    assert.equal(typeof query.filters?.user, 'string');
    assert.equal(query.filters.entryDate.gte, daysAgo(today, DASHBOARD_RECENT_DAYS));
    assert.equal(query.filters.entryDate.lte, today);
    assert.equal(query.limit, DASHBOARD_RECENT_DAYS + 15);
    assert.deepEqual(query.sorts, [{ field: 'entryDate', dir: 'desc' }]);
  }
  const dates = result.recentEntries.map((row: any) => row.entryDate);
  assert.ok(dates.includes(recent));
  assert.ok(dates.includes(today));
  assert.equal(dates.includes(ancient), false);
  assert.equal(result.windowStart, daysAgo(today, DASHBOARD_RECENT_DAYS));
  assert.equal(result.hasMore, false);
});

test('older history is a separate bounded query, and days cannot exceed the cap', async (t) => {
  const today = getTodayIST();
  const before = daysAgo(today, 10);
  const queries: any[] = [];

  t.mock.method(Users, 'findOne', async () => member);
  t.mock.method(SadhanaEntries, 'findAll', async (query: any) => {
    queries.push(query);
    return { records: [], hasMore: false };
  });

  await getUserDashboardData.execute({
    input: { userId: member.id, days: 5000, before },
    context: { user: { id: member.id, email: member.email } },
  } as never);

  assert.ok(queries.length > 0);
  for (const query of queries) {
    assert.equal(query.filters.entryDate.lt, before);
    assert.equal(query.filters.entryDate.gte, daysAgo(daysAgo(before, 1), DASHBOARD_HISTORY_MAX_DAYS));
    assert.equal(query.limit, DASHBOARD_HISTORY_MAX_DAYS + 15);
    assert.equal(query.filters.entryDate.lte, undefined);
  }
});

test('PW calendar and headline use the same saved score snapshot', async (t) => {
  const today = getTodayIST();
  const yesterday = daysAgo(today, 1);
  const earlier = daysAgo(today, 2);
  const pwMember = { ...member, segment: 'PW' };
  t.mock.method(Users, 'findOne', async () => pwMember);
  const pwEntry = (date: string, percent: number) => ({
    ...entry(date),
    totalScore: 16,
    maxScore: 60,
    scorePercent: 27,
    templateMode: 'NON_RESIDENT_TEMPLATE',
    fieldValuesJson: JSON.stringify({ _meta: { pwVersion: 2, scorePercent: percent, pwEarned: 60, pwApplicableMax: 60 } }),
  });
  t.mock.method(SadhanaEntries, 'findAll', async () => ({ records: [
    pwEntry(today, 100), pwEntry(yesterday, 60),
    { ...pwEntry(earlier, 20), fieldValuesJson: undefined, fieldValues: { _meta: { pwVersion: 2, scorePercent: 20 } } },
  ], hasMore: false }));

  const result = await getUserDashboardData.execute({
    input: { userId: member.userId },
    context: { user: { id: member.id, email: member.email } },
  } as never);
  assert.equal(result.metrics.todayPercent, 100);
  assert.deepEqual(result.recentEntries.map((row: any) => [row.entryDate, row.scorePercent]), [
    [today, 100], [yesterday, 60], [earlier, 20],
  ]);
});
