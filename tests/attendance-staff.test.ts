import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import conductBvSession from '../src/api/conductBvSession';
import getAttendanceForDate from '../src/api/getAttendanceForDate';

const rgf = {
  id: 'staff-rgf-doc',
  userId: 'STAFF-RGF',
  fullName: 'Richa Dewan',
  email: 'richa@example.invalid',
  firebaseUid: 'firebase-richa',
  status: 'Active',
  isBvFacilitator: true,
};
const rgsf = {
  id: 'staff-rgsf-doc',
  userId: 'STAFF-RGSF',
  fullName: 'Nitya RGSF',
  email: 'nitya@example.invalid',
  status: 'Active',
  isBvSubFacilitator: true,
};
const devotee = {
  id: 'staff-devotee-doc',
  userId: 'STAFF-DEVOTEE',
  fullName: 'Geetha Nagaraju',
  status: 'Active',
};
const group = {
  id: 'staff-group-doc',
  groupId: 'STAFF-GROUP',
  groupName: 'Nityananda new',
  bvslLeader: rgf.id,
  bvslId: rgf.userId,
  bvslName: rgf.fullName,
  subFacilitatorId: rgsf.id,
  rgsfId: rgsf.userId,
  subFacilitator: rgsf.fullName,
};

function mockDatabase(t: any, attendance: any[] = []) {
  const fixture: Record<string, any[]> = {
    Users: [rgf, rgsf, devotee],
    BvGroups: [group],
    BvGroupMembers: [
      { id: 'staff-member', group: group.id, groupId: group.groupId, user: devotee.id, userId: devotee.userId },
    ],
    BvAttendance: attendance,
    BvSessions: [],
  };
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.includes(item));
      return true;
    }
    return [actual].flat().includes(value);
  });
  const created: any[] = [];
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      return { records, hasMore: false };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
    if (name === 'BvSessions') {
      t.mock.method(table, 'create', async () => ({ id: 'staff-session' }));
    }
    if (name === 'BvAttendance') {
      t.mock.method(table, 'bulkCreate', async ({ records }: any) => {
        created.push(...records);
        return { records };
      });
      t.mock.method(table, 'update', async () => ({}));
    }
  }
  return created;
}

test('attendance includes the group RGF and RGSF even without membership rows', async (t) => {
  mockDatabase(t, [
    {
      id: 'att-rgf',
      group: group.id,
      user: rgf.email,
      present: true,
      attendedMinutes: 40,
      totalMeetingMinutes: 50,
      attendanceDate: '2026-10-15',
    },
  ]);
  const result = await getAttendanceForDate.execute({
    input: { groupId: group.id, date: '2026-10-15' },
    context: { user: rgf },
  } as never);

  assert.deepEqual(result.members.map((member: any) => ({
    name: member.fullName,
    role: member.roleLabel,
    present: member.present,
    minutes: member.attendedMinutes,
  })), [
    { name: 'Richa Dewan', role: 'RGF', present: true, minutes: 40 },
    { name: 'Nitya RGSF', role: 'RGSF', present: null, minutes: 0 },
    { name: 'Geetha Nagaraju', role: null, present: null, minutes: 0 },
  ]);
});

test('an RGF who is already a member is listed and saved once', async (t) => {
  const created = mockDatabase(t);
  const fixtureMember = {
    id: 'staff-rgf-membership',
    group: group.id,
    groupId: group.groupId,
    user: rgf.firebaseUid,
    userId: rgf.userId,
  };
  const membersTable = (sdk as any).BvGroupMembers;
  const original = membersTable.findAll;
  t.mock.method(membersTable, 'findAll', async (options: any) => {
    const result = await original(options);
    const extra = options?.filters?.group === group.id || options?.filters?.groupId?.in?.includes(group.groupId)
      ? [fixtureMember]
      : [];
    return { records: [...result.records, ...extra], hasMore: false };
  });

  const listed = await getAttendanceForDate.execute({
    input: { groupId: group.id, date: '2026-10-16' },
    context: { user: rgf },
  } as never);
  assert.equal(listed.members.filter((member: any) => member.fullName === rgf.fullName).length, 1);
  assert.equal(listed.members.find((member: any) => member.fullName === rgf.fullName).roleLabel, 'RGF');

  await conductBvSession.execute({
    input: {
      bvslId: rgf.userId,
      groupId: group.id,
      sessionDate: '2026-10-16',
      totalMeetingMinutes: 50,
      memberAttendance: [
        { userDbId: rgf.id, present: true, attendedMinutes: 25 },
        { userDbId: rgsf.id, present: true, attendedMinutes: 25 },
        { userDbId: devotee.id, present: false, attendedMinutes: 0 },
      ],
    },
    context: { user: { id: rgf.id, userId: rgf.userId, email: rgf.email } },
  } as never);

  const rgfRows = created.filter(record => record.user === rgf.id || record.user === rgf.firebaseUid);
  assert.equal(rgfRows.length, 1);
  assert.equal(rgfRows[0].present, true);
  assert.equal(rgfRows[0].attendedMinutes, 25);
});

test('saving attendance records the RGF and RGSF and ignores someone outside the group', async (t) => {
  const created = mockDatabase(t);
  const saved = await conductBvSession.execute({
    input: {
      bvslId: rgf.userId,
      groupId: group.id,
      sessionDate: '2026-10-15',
      totalMeetingMinutes: 50,
      memberAttendance: [
        { userDbId: devotee.id, present: true, attendedMinutes: 50 },
        { userDbId: rgf.id, present: true, attendedMinutes: 50 },
        { userDbId: rgsf.id, present: false, attendedMinutes: 0 },
        { userDbId: 'stranger', present: true, attendedMinutes: 50 },
      ],
    },
    context: { user: { id: rgf.id, userId: rgf.userId, email: rgf.email, fullName: rgf.fullName } },
  } as never);

  assert.equal(saved.success, true);
  assert.equal(saved.message.includes('2/3'), true);
  assert.deepEqual(created.map(record => ({
    user: record.user,
    present: record.present,
    attendedMinutes: record.attendedMinutes,
  })).sort((a, b) => a.user.localeCompare(b.user)), [
    { user: devotee.id, present: true, attendedMinutes: 50 },
    { user: rgf.id, present: true, attendedMinutes: 50 },
    { user: rgsf.id, present: false, attendedMinutes: 0 },
  ]);
});
