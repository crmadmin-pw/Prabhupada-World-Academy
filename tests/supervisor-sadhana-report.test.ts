import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { resolveBvGroupMemberUsers } from '../src/lib/bvGroupMemberScope';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import getGuideDetailedReport from '../src/api/getGuideDetailedReport';
import getBvSessionMatrix from '../src/api/getBvSessionMatrix';
import getSadhanaLeaderboard from '../src/api/getSadhanaLeaderboard';
import { getTodayIST } from '../src/lib/streakUtils';

const supervisor = {
  id: 'sadhana-supervisor',
  userId: 'USER-SUP',
  email: 'supervisor@example.test',
  fullName: 'BITS VEDANG',
  role: 'User',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvSupervisor: true,
  status: 'Active',
};
const linked = {
  id: 'linked-member',
  userId: 'USER-LINKED',
  email: 'linked@example.test',
  fullName: 'Linked Member',
  role: 'User',
  segment: 'PW',
  status: 'Active',
};
const group = {
  id: 'BV-GROUP-HARIBOL',
  groupId: 'BV-GROUP-HARIBOL',
  groupName: 'HARIBOL',
  segment: 'PW',
  isActive: true,
  bvslId: supervisor.userId,
  bvslLeader: supervisor.id,
  bvslName: supervisor.fullName,
};
const fixture: Record<string, any[]> = {
  Users: [supervisor, linked],
  BvGroups: [group],
  BvGroupMembers: [
    { id: 'm-linked', group: group.id, groupId: group.groupId, user: linked.id, userId: linked.userId, role: 'Member' },
    { id: 'm-orphan', group: group.id, groupId: group.groupId, user: 'auth-orphan', userId: 'USER-ORPHAN', memberId: 'USER-ORPHAN', role: 'Member' },
    { id: 'm-self', group: group.id, groupId: group.groupId, user: supervisor.id, userId: supervisor.userId, role: 'Member' },
  ],
  SadhanaEntries: [],
};

function mockDatabase(t: any) {
  serverCacheInvalidate();
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.includes(item));
      return (!value.gte || actual >= value.gte) && (!value.lte || actual <= value.lte);
    }
    return [actual].flat().includes(value);
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      const offset = options.offset || 0;
      const page = records.slice(offset, offset + (options.limit || 2000));
      return {
        records: page.map(record => options.fields
          ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, record[key]]))
          : { ...record }),
        hasMore: offset + page.length < records.length,
      };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
}

test('a supervisor sadhana report keeps a group member who has no user account', async (t) => {
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const members = await resolveBvGroupMemberUsers(supervisor, ['id', 'userId', 'fullName'], {
      segment: 'PW',
      excludeCaller: true,
    });
    assert.deepEqual(members.map(member => member.id).sort(), ['auth-orphan', 'linked-member']);
    assert.equal(members.find(member => member.id === 'auth-orphan')?.fullName, 'Devotee');

    const report = await getGuideDetailedReport.execute({
      input: {
        guideId: supervisor.userId,
        date: '2026-10-12',
        reportType: 'daily',
        bvslMode: true,
        segment: 'PW',
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(report.users.map((user: any) => user.id).sort(), ['auth-orphan', 'linked-member', 'sadhana-supervisor']);
    assert.equal(report.users.filter((user: any) => user.submitted).length, 0);
  });
});

test('a supervisor report lists the supervisor and the RGF when both belong to the group', async (t) => {
  const rgf = {
    id: 'rgf-doc',
    userId: 'USER-RGF',
    email: 'rgf@example.test',
    fullName: 'Vedanarayana Dasa',
    role: 'User',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    isBvFacilitator: true,
    isBvsl: true,
    bvReportingSupervisorId: supervisor.userId,
    status: 'Active',
  };
  const originalGroup = { ...group };
  fixture.Users.push(rgf);
  fixture.BvGroupMembers.push({
    id: 'm-rgf', group: group.id, groupId: group.groupId, user: rgf.id, userId: rgf.userId, role: 'Member',
  });
  group.bvslId = rgf.userId;
  group.bvslLeader = rgf.id;
  group.bvslName = rgf.fullName;
  t.after(() => {
    fixture.Users = fixture.Users.filter(user => user.id !== rgf.id);
    fixture.BvGroupMembers = fixture.BvGroupMembers.filter(member => member.id !== 'm-rgf');
    Object.assign(group, originalGroup);
  });
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const report = await getGuideDetailedReport.execute({
      input: {
        guideId: supervisor.userId,
        date: '2026-10-14',
        reportType: 'daily',
        bvslMode: true,
        segment: 'PW',
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(report.users.map((user: any) => user.fullName).sort(), ['BITS VEDANG', 'Devotee', 'Linked Member', 'Vedanarayana Dasa']);
  });
});

test('an RGF sadhana report lists the RGF when they are also a group member', async (t) => {
  const rgf = {
    id: 'rgf-doc',
    userId: 'USER-RGF',
    email: 'rgf@example.test',
    fullName: 'Vedanarayana Dasa',
    role: 'User',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    isBvFacilitator: true,
    isBvsl: true,
    status: 'Active',
  };
  const originalGroup = { ...group };
  fixture.Users.push(rgf);
  fixture.BvGroupMembers.push({
    id: 'm-rgf', group: group.id, groupId: group.groupId, user: rgf.id, userId: rgf.userId, role: 'Member',
  });
  group.bvslId = rgf.userId;
  group.bvslLeader = rgf.id;
  group.bvslName = rgf.fullName;
  t.after(() => {
    fixture.Users = fixture.Users.filter(user => user.id !== rgf.id);
    fixture.BvGroupMembers = fixture.BvGroupMembers.filter(member => member.id !== 'm-rgf');
    Object.assign(group, originalGroup);
  });
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const report = await getGuideDetailedReport.execute({
      input: {
        guideId: rgf.userId,
        date: '2026-10-13',
        reportType: 'daily',
        bvslMode: true,
        segment: 'PW',
      },
      context: { user: rgf },
    } as never);
    assert.deepEqual(report.users.map((user: any) => user.fullName).sort(), ['BITS VEDANG', 'Devotee', 'Linked Member', 'Vedanarayana Dasa']);

    const matrix = await getBvSessionMatrix.execute({
      input: {
        guideId: rgf.userId,
        startDate: '2026-10-12',
        endDate: '2026-10-18',
        bvslMode: true,
        segment: 'PW',
      },
      context: { user: rgf },
    } as never);
    assert.deepEqual(matrix.members.map((row: any) => row.fullName).sort(), ['BITS VEDANG', 'Linked Member', 'Vedanarayana Dasa']);
  });
});

test('an RGF leaderboard includes a supervisor who is a member of the group', async (t) => {
  const rgf = {
    id: 'rgf-doc',
    userId: 'USER-RGF',
    email: 'rgf@example.test',
    fullName: 'Vedanarayana Dasa',
    role: 'User',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    isBvFacilitator: true,
    isBvsl: true,
    bvReportingSupervisorId: supervisor.userId,
    status: 'Active',
  };
  const date = getTodayIST();
  const originalGroup = { ...group };
  fixture.Users.push(rgf);
  fixture.BvGroupMembers.push({
    id: 'm-rgf', group: group.id, groupId: group.groupId, user: rgf.id, userId: rgf.userId, role: 'Member',
  });
  fixture.SadhanaPeriodSummaryMeta = [{ id: `day__${date}`, ready: true, streakFinal: true }];
  fixture.SadhanaPeriodSummaries = [supervisor, rgf].map(person => ({
    id: `sum-${person.id}`,
    periodId: `day__${date}`,
    user: person.id,
    entryCount: 1,
    entryDates: [date],
    totalScore: 0,
    totalMaxScore: 0,
    latestMaxScore: 0,
    latestEntryDate: date,
    streakAtEnd: 1,
  }));
  group.bvslId = rgf.userId;
  group.bvslLeader = rgf.id;
  group.bvslName = rgf.fullName;
  t.after(() => {
    fixture.Users = fixture.Users.filter(user => user.id !== rgf.id);
    fixture.BvGroupMembers = fixture.BvGroupMembers.filter(member => member.id !== 'm-rgf');
    fixture.SadhanaPeriodSummaries = [];
    delete fixture.SadhanaPeriodSummaryMeta;
    Object.assign(group, originalGroup);
  });
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const leaderboard = await getSadhanaLeaderboard.execute({
      input: { date, bvslMode: true, segment: 'PW', guideId: rgf.userId },
      context: { user: rgf },
    } as never);
    assert.deepEqual(
      leaderboard.leaderboard.map((row: any) => row.displayName).sort(),
      ['BITS VEDANG', 'Vedanarayana Dasa'],
    );
  });
});
