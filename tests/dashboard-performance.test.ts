import assert from 'node:assert/strict';
import test from 'node:test';

import getBvAttendance from '../src/api/getBvAttendance';
import getUserAttendanceCalendar from '../src/api/getUserAttendanceCalendar';
import getSadhanaLeaderboard from '../src/api/getSadhanaLeaderboard';
import markBvAttendance from '../src/api/markBvAttendance';
import { BvAttendance, BvGroupMembers, BvGroups, SadhanaEntries, Users } from '../src/lib/app-backend-sdk';
import { serverCacheGetOrFetch, serverCacheInvalidate } from '../src/lib/serverCache';
import { deleteStoredLeaderboardPeriod } from '../src/lib/sadhanaPeriodSummary';
import { getTodayIST } from '../src/lib/streakUtils';

test('server reference cache shares concurrent database fetches', async () => {
  const key = 'performance-test:single-flight';
  serverCacheInvalidate(key);
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return { value: 42 };
  };

  try {
    const results = await Promise.all([
      serverCacheGetOrFetch(key, fetcher, 1_000),
      serverCacheGetOrFetch(key, fetcher, 1_000),
      serverCacheGetOrFetch(key, fetcher, 1_000),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(results, [{ value: 42 }, { value: 42 }, { value: 42 }]);
    assert.deepEqual(await serverCacheGetOrFetch(key, fetcher, 1_000), { value: 42 });
    assert.equal(calls, 1);
  } finally {
    serverCacheInvalidate(key);
  }
});

test('BV attendance reads and aggregates only the member assigned group', async () => {
  const today = getTodayIST();
  const groupId = 'PERF-BV-GROUP';
  const outsideGroupId = 'PERF-BV-OUTSIDE-GROUP';
  const member = {
    id: 'PERF-BV-MEMBER-DB',
    userId: 'PERF-BV-MEMBER',
    firebaseUid: 'PERF-BV-MEMBER-AUTH',
    email: 'perf-bv-member@example.invalid',
    fullName: 'Performance Member',
    status: 'Active',
    role: 'User',
  };
  const peer = {
    id: 'PERF-BV-PEER-DB',
    userId: 'PERF-BV-PEER',
    email: 'perf-bv-peer@example.invalid',
    fullName: 'Performance Peer',
    status: 'Active',
    role: 'User',
  };
  const outside = {
    id: 'PERF-BV-OUTSIDE-DB',
    userId: 'PERF-BV-OUTSIDE',
    email: 'perf-bv-outside@example.invalid',
    fullName: 'Outside Member',
    status: 'Active',
    role: 'User',
  };
  const cleanup: Array<{ table: any; id: string }> = [];

  try {
    for (const user of [member, peer, outside]) {
      await Users.create({ record: user });
      cleanup.push({ table: Users, id: user.id });
    }
    for (const record of [
      { id: 'PERF-BV-MEMBERSHIP', group: groupId, groupId, user: member.id, userId: member.userId },
      { id: 'PERF-BV-PEER-MEMBERSHIP', group: groupId, groupId, user: peer.id, userId: peer.userId },
      { id: 'PERF-BV-OUTSIDE-MEMBERSHIP', group: outsideGroupId, groupId: outsideGroupId, user: outside.id, userId: outside.userId },
    ]) {
      await BvGroupMembers.create({ record });
      cleanup.push({ table: BvGroupMembers, id: record.id });
    }
    for (const record of [
      { id: 'PERF-BV-ATT-MEMBER', group: groupId, user: member.id, attendanceDate: today, present: true },
      { id: 'PERF-BV-ATT-PEER', group: groupId, user: peer.id, attendanceDate: today, present: false },
      { id: 'PERF-BV-ATT-OUTSIDE', group: outsideGroupId, user: outside.id, attendanceDate: today, present: true },
    ]) {
      await BvAttendance.create({ record });
      cleanup.push({ table: BvAttendance, id: record.id });
    }

    const result = await getBvAttendance.execute({
      input: { userId: member.userId, sinceDate: today },
      context: { user: { ...member, uid: member.firebaseUid } },
    } as never);

    assert.deepEqual(result.userHistory, [{
      attendanceDate: today,
      present: true,
      status: 'P',
      sessionTopic: '',
    }]);
    assert.deepEqual(
      result.leaderboard.map((entry: any) => entry.userId).sort(),
      [member.userId, peer.userId].sort(),
    );
    assert.equal(result.leaderboard.some((entry: any) => entry.userId === outside.userId), false);
  } finally {
    for (const item of cleanup.reverse()) await item.table.delete({ id: item.id });
  }
});

test('BV attendance calendar resolves a Firebase Auth UID to the stored Users ID', async () => {
  const member = {
    id: 'CALENDAR-BV-MEMBER-DB',
    userId: 'CALENDAR-BV-MEMBER',
    firebaseUid: 'CALENDAR-BV-MEMBER-AUTH',
    email: 'calendar-bv-member@example.invalid',
    fullName: 'Calendar Member',
    status: 'Active',
    role: 'User',
  };
  const attendance = {
    id: 'CALENDAR-BV-ATTENDANCE',
    group: 'CALENDAR-BV-GROUP',
    user: member.id,
    attendanceDate: '2026-09-06',
    present: true,
  };

  try {
    await Users.create({ record: member });
    await BvAttendance.create({ record: attendance });

    const result = await getUserAttendanceCalendar.execute({
      input: {},
      context: { user: { id: member.firebaseUid } },
    } as never);

    assert.deepEqual(result.entries, [{
      date: attendance.attendanceDate,
      present: true,
      status: 'P',
      sessionName: 'Bhakti Vriksha Session',
      eventTitle: 'Present',
    }]);
  } finally {
    await BvAttendance.delete({ id: attendance.id });
    await Users.delete({ id: member.id });
  }
});

test('BV attendance resolves legacy membership IDs to facilitator-saved attendance', async () => {
  const today = getTodayIST();
  const member = {
    id: 'BV-LEGACY-ALIAS-USER-DOC',
    userId: 'BV-LEGACY-ALIAS-USER',
    email: 'bv-legacy-alias@example.invalid',
    fullName: 'BV Legacy Alias Member',
    status: 'Active',
    role: 'User',
  };
  const group = { id: 'BV-LEGACY-ALIAS-GROUP-DOC', groupId: 'BV-LEGACY-ALIAS-GROUP' };
  const cleanup: Array<{ table: any; id: string }> = [];

  try {
    await Users.create({ record: member });
    cleanup.push({ table: Users, id: member.id });
    await BvGroups.create({ record: group });
    cleanup.push({ table: BvGroups, id: group.id });
    await BvGroupMembers.create({
      record: {
        id: 'BV-LEGACY-ALIAS-MEMBERSHIP',
        group: group.groupId,
        // Pre-migration records sometimes used memberId rather than user.
        memberId: member.email,
      },
    });
    cleanup.push({ table: BvGroupMembers, id: 'BV-LEGACY-ALIAS-MEMBERSHIP' });
    await BvAttendance.create({
      record: {
        id: 'BV-LEGACY-ALIAS-ATTENDANCE',
        group: group.id,
        user: member.id,
        attendanceDate: today,
        present: true,
      },
    });
    cleanup.push({ table: BvAttendance, id: 'BV-LEGACY-ALIAS-ATTENDANCE' });

    const context = { user: { id: member.id, userId: member.userId, email: member.email } };
    const [report, calendar] = await Promise.all([
      getBvAttendance.execute({ input: { userId: member.userId, sinceDate: today }, context } as never),
      getUserAttendanceCalendar.execute({ input: {}, context } as never),
    ]);

    assert.equal(report.userHistory[0]?.status, 'P');
    assert.equal(calendar.entries.find((entry: any) => entry.date === today)?.status, 'P');
  } finally {
    for (const item of cleanup.reverse()) await item.table.delete({ id: item.id });
  }
});

test('a facilitator save uses the member document ID for a legacy BV membership', async () => {
  const today = getTodayIST();
  const member = {
    id: 'BV-MARK-ALIAS-USER-DOC',
    userId: 'BV-MARK-ALIAS-USER',
    email: 'bv-mark-alias@example.invalid',
    fullName: 'BV Mark Alias Member',
    status: 'Active',
    role: 'User',
  };
  const group = {
    id: 'BV-MARK-ALIAS-GROUP-DOC',
    groupId: 'BV-MARK-ALIAS-GROUP',
    bvslLeader: 'BV-MARK-FACILITATOR',
  };
  const cleanup: Array<{ table: any; id: string }> = [];

  try {
    await Users.create({ record: member });
    cleanup.push({ table: Users, id: member.id });
    await BvGroups.create({ record: group });
    cleanup.push({ table: BvGroups, id: group.id });
    await BvGroupMembers.create({
      record: {
        id: 'BV-MARK-ALIAS-MEMBERSHIP',
        group: group.groupId,
        memberId: member.email,
      },
    });
    cleanup.push({ table: BvGroupMembers, id: 'BV-MARK-ALIAS-MEMBERSHIP' });

    await markBvAttendance.execute({
      input: { userId: member.userId, status: 'P', localDate: today },
      context: { user: { id: 'BV-MARK-FACILITATOR' } },
    } as never);

    const { records } = await BvAttendance.findAll({
      filters: { group: group.id, attendanceDate: today },
      fields: ['id', 'user', 'present'],
      limit: 10,
    });
    assert.deepEqual(records.map((record: any) => ({ user: record.user, present: record.present })), [{
      user: member.id,
      present: true,
    }]);
    cleanup.push(...records.map((record: any) => ({ table: BvAttendance, id: record.id })));
  } finally {
    for (const item of cleanup.reverse()) await item.table.delete({ id: item.id });
  }
});

test('current Sadhana leaderboard uses stored streaks without a 100-day collection scan', async () => {
  const today = getTodayIST();
  await deleteStoredLeaderboardPeriod(today, today);
  const user = {
    id: 'PERF-LB-USER-DB',
    userId: 'PERF-LB-USER',
    email: 'perf-lb-user@example.invalid',
    fullName: 'Performance Leaderboard User',
    status: 'Active',
    role: 'User',
    currentStreak: 7,
  };
  const entry = {
    id: 'PERF-LB-ENTRY',
    user: user.id,
    entryDate: today,
    totalScore: 18,
    maxScore: 20,
    scorePercent: 90,
    submittedAt: `${today}T05:00:00.000Z`,
  };
  const originalFindAll = SadhanaEntries.findAll.bind(SadhanaEntries);
  let requestedHistoricalWindow = false;

  await Users.create({ record: user });
  await SadhanaEntries.create({ record: entry });
  (SadhanaEntries as any).findAll = async (query: any = {}) => {
    const range = query.filters?.entryDate;
    if (range?.gte && range.gte < today) requestedHistoricalWindow = true;
    return originalFindAll(query);
  };

  try {
    const result = await getSadhanaLeaderboard.execute({
      input: { userId: user.userId, date: today },
      context: {
        user: {
          ...user,
          uid: user.id,
          role: 'SUPER_ADMIN',
          isBvSuperAdmin: true,
          isBvAdmin: true,
        },
      },
    } as never);

    assert.equal(requestedHistoricalWindow, false);
    const row = result.leaderboard.find((item: any) => item.userId === user.userId);
    assert.equal(row?.currentStreak, 7);
  } finally {
    (SadhanaEntries as any).findAll = originalFindAll;
    await SadhanaEntries.delete({ id: entry.id });
    await Users.delete({ id: user.id });
    await deleteStoredLeaderboardPeriod(today, today);
  }
});
