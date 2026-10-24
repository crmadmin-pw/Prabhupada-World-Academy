import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import getAttendanceForDate from '../src/api/getAttendanceForDate';

const facilitator = {
  id: 'rgf-doc',
  userId: 'USER-235',
  fullName: 'Vedanarayana Dasa',
  firebaseUid: 'firebase-rgf',
};
const devotee = {
  id: 'devotee-doc',
  userId: 'USER-246',
  fullName: 'BITS VEDANG',
};
const group = {
  id: 'BV-GROUP-VDN',
  groupId: 'BV-GROUP-VDN',
  groupName: 'VDN Group',
  bvslId: facilitator.userId,
};
const fixture: Record<string, any[]> = {
  Users: [facilitator, devotee],
  BvGroups: [group],
  BvGroupMembers: [
    { id: 'm-rgf', group: group.id, groupId: group.groupId, user: facilitator.firebaseUid, userId: facilitator.userId },
    { id: 'm-devotee', group: group.id, groupId: group.groupId, user: devotee.id, userId: devotee.userId },
  ],
  BvAttendance: [],
  BvSessions: [],
};

function mockDatabase(t: any) {
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.includes(item));
      return true;
    }
    return [actual].flat().includes(value);
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      return { records, hasMore: false };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
}

test('a new attendance date lists every member and marks nobody present', async (t) => {
  mockDatabase(t);
  const result = await getAttendanceForDate.execute({
    input: { groupId: group.id, date: '2026-10-14' },
    context: { user: facilitator },
  } as never);
  assert.equal(result.sessionExists, false);
  assert.deepEqual(result.members.map((member: any) => ({
    name: member.fullName,
    present: member.present,
    minutes: member.attendedMinutes,
  })).sort((left: any, right: any) => left.name.localeCompare(right.name)), [
    { name: 'BITS VEDANG', present: null, minutes: 0 },
    { name: 'Vedanarayana Dasa', present: null, minutes: 0 },
  ]);
});
