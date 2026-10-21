import assert from 'node:assert/strict';
import test from 'node:test';
import { BvAttendance, BvGroupMembers, BvGroups, BvQuizzes, BvSessions, Guides, Users } from '../src/lib/app-backend-sdk';
import getBvAttendanceMatrix from '../src/api/getBvAttendanceMatrix';
import getBvGroupDetail from '../src/api/getBvGroupDetail';

const leader = {
  id: 'detail-leader', userId: 'DETAIL-LEADER', email: 'detail-leader@example.test',
  fullName: 'Detail Leader', role: 'User', status: 'Active', segment: 'PW',
  isBvFacilitator: true, isBvsl: true,
};
const supervisor = {
  id: 'detail-supervisor', userId: 'DETAIL-SUPERVISOR', email: 'detail-supervisor@example.test',
  fullName: 'Detail Supervisor', role: 'User', status: 'Active', segment: 'PW', isBvSupervisor: true,
};
const reportingLeader = { ...leader, bvReportingSupervisorId: supervisor.id };
const member = {
  id: 'detail-member', userId: 'DETAIL-MEMBER', email: 'detail-member@example.test',
  fullName: 'Detail Member', phone: '9000000001', role: 'User', status: 'Active', segment: 'PW',
  isBvMember: true, bvGroupId: 'detail-group',
};
const outsider = {
  id: 'detail-outsider', userId: 'DETAIL-OUTSIDER', email: 'detail-outsider@example.test',
  fullName: 'Detail Outsider', role: 'User', status: 'Active', segment: 'PW',
};
const group = {
  id: 'detail-group', groupId: 'DETAIL-GROUP', groupName: 'Scoped Reading Group',
  isActive: true, segment: 'PW', bvslId: leader.userId, bvslLeader: leader.id,
  joinToken: 'join-secret', whatsAppLink: 'https://chat.example/group',
};
const membership = {
  id: 'detail-membership', group: group.id, groupId: group.groupId,
  user: member.id, userId: member.userId, memberId: member.email, role: 'Member',
};

function database(t: any) {
  const fixtures = new Map<any, any[]>([
    [Users, [reportingLeader, supervisor, member, outsider]],
    [BvGroups, [group]],
    [BvGroupMembers, [membership]],
    [BvSessions, []],
    [BvAttendance, []],
    [BvQuizzes, []],
    [Guides, []],
  ]);
  const reads: string[] = [];
  for (const [table, rows] of fixtures) {
    const name = [...fixtures.keys()].indexOf(table) === 2 ? 'BvGroupMembers' : '';
    const matches = (row: any, query: any = {}) => {
      if (query.id && row.id !== query.id) return false;
      return Object.entries(query.filters || {}).every(([key, value]: any) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.in)) {
          return value.in.includes(row[key]);
        }
        return row[key] === value;
      });
    };
    t.mock.method(table, 'findAll', async (query: any) => {
      if (name) reads.push(name);
      return { records: rows.filter(row => matches(row, query)), hasMore: false };
    });
    t.mock.method(table, 'findOne', async (query: any) => rows.find(row => matches(row, query)));
  }
  return reads;
}

const call = (user: any, groupId = group.groupId) => getBvGroupDetail.execute({
  input: { groupId },
  context: { user },
} as never);

test('a group leader can read member contacts and the join token', async t => {
  database(t);
  const detail = await call(reportingLeader);
  assert.equal(detail.group.groupName, group.groupName);
  assert.equal(detail.members.length, 2);
  const listedMember = detail.members.find((row: any) => row.fullName === member.fullName);
  assert.equal(listedMember?.phone, member.phone);
  assert.deepEqual(detail.members.find((row: any) => row.fullName === leader.fullName)?.badges, ['RGF']);
  assert.equal(detail.group.joinToken, group.joinToken);
});

test('a supervisor in the chain can read the group but not its join token', async t => {
  database(t);
  const detail = await call(supervisor);
  assert.equal(detail.members.find((row: any) => row.fullName === member.fullName)?.userId, member.userId);
  assert.equal(detail.group.joinToken, null);
  assert.equal(detail.group.whatsAppLink, group.whatsAppLink);
});

test('the attendance grid uses the same chain and refuses outsiders', async t => {
  database(t);
  const allowed = await getBvAttendanceMatrix.execute({
    input: { groupId: group.groupId, startDate: '2026-10-01', endDate: '2026-10-07' },
    context: { user: reportingLeader },
  } as never);
  assert.equal(allowed.members[0].fullName, member.fullName);

  const reads = database(t);
  await assert.rejects(
    getBvAttendanceMatrix.execute({
      input: { groupId: group.groupId },
      context: { user: outsider },
    } as never),
    (error: any) => error.code === 'FORBIDDEN',
  );
  assert.deepEqual(reads, []);
});

test('an RGF and RGSF without a membership row are members of their group', async t => {
  const rgsf = {
    id: 'detail-rgsf', userId: 'DETAIL-RGSF', email: 'detail-rgsf@example.test',
    fullName: 'Detail RGSF', role: 'RGSF', status: 'Active', segment: 'PW',
    isBvSubFacilitator: true,
  };
  const facilitatedGroup = {
    ...group,
    subFacilitatorId: rgsf.userId,
  };
  const attendance = [
    { id: 'rgf-present', group: group.id, user: leader.id, present: true, attendanceDate: '2026-10-01' },
    { id: 'rgf-absent', group: group.id, user: leader.userId, present: false, attendanceDate: '2026-10-08' },
    { id: 'rgsf-present', group: group.id, user: rgsf.email, present: true, attendanceDate: '2026-10-01' },
  ];
  const fixtures = new Map<any, any[]>([
    [Users, [reportingLeader, supervisor, member, outsider, rgsf]],
    [BvGroups, [facilitatedGroup]],
    [BvGroupMembers, [membership]],
    [BvSessions, []],
    [BvAttendance, attendance],
    [BvQuizzes, []],
    [Guides, []],
  ]);
  for (const [table, rows] of fixtures) {
    const matches = (row: any, query: any = {}) => {
      if (query.id && row.id !== query.id) return false;
      return Object.entries(query.filters || {}).every(([key, value]: any) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.in)) {
          return value.in.includes(row[key]);
        }
        return row[key] === value;
      });
    };
    t.mock.method(table, 'findAll', async (query: any) => ({ records: rows.filter(row => matches(row, query)), hasMore: false }));
    t.mock.method(table, 'findOne', async (query: any) => rows.find(row => matches(row, query)));
  }

  const detail = await call(reportingLeader);
  assert.deepEqual(detail.members.find((row: any) => row.fullName === leader.fullName)?.badges, ['RGF']);
  assert.deepEqual(detail.members.find((row: any) => row.fullName === rgsf.fullName)?.badges, ['RGSF']);
  assert.equal(detail.members.find((row: any) => row.fullName === member.fullName)?.badges.length, 0);
});

test('an RGF removed from the group is not kept on as a member', async t => {
  const formerRgf = {
    id: 'detail-asha', userId: 'DETAIL-ASHA', email: 'asha@example.test',
    fullName: 'Asha N', role: 'User', status: 'Active', segment: 'PW',
    isBvFacilitator: true, isBvsl: true, isBvMember: true, bvGroupId: group.id,
  };
  const staleMembership = {
    id: 'asha-membership', group: group.id, groupId: group.groupId,
    user: formerRgf.id, userId: formerRgf.userId, role: 'Member',
  };
  const fixtures = new Map<any, any[]>([
    [Users, [reportingLeader, supervisor, member, outsider, formerRgf]],
    [BvGroups, [group]],
    [BvGroupMembers, [membership, staleMembership]],
    [BvSessions, []],
    [BvAttendance, []],
    [BvQuizzes, []],
    [Guides, []],
  ]);
  for (const [table, rows] of fixtures) {
    const matches = (row: any, query: any = {}) => {
      if (query.id && row.id !== query.id) return false;
      return Object.entries(query.filters || {}).every(([key, value]: any) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.in)) {
          return value.in.includes(row[key]);
        }
        return row[key] === value;
      });
    };
    t.mock.method(table, 'findAll', async (query: any) => ({ records: rows.filter(row => matches(row, query)), hasMore: false }));
    t.mock.method(table, 'findOne', async (query: any) => rows.find(row => matches(row, query)));
  }

  const detail = await call(reportingLeader);
  assert.equal(detail.members.some((row: any) => row.fullName === 'Asha N'), false);
  assert.equal(detail.members.some((row: any) => row.fullName === member.fullName), true);
  assert.equal(detail.members.some((row: any) => row.fullName === leader.fullName), true);
});

test('a member and an outsider are refused before membership records are read', async t => {
  for (const user of [member, outsider]) {
    await t.test(user.userId, async st => {
      const reads = database(st);
      await assert.rejects(call(user), (error: any) => error.code === 'FORBIDDEN');
      assert.deepEqual(reads, []);
    });
  }
});
