import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import conductBvSession from '../src/api/conductBvSession';

const ramya = {
  id: 'ramya-doc',
  userId: 'RAMYA',
  fullName: 'Ramya Devi Dasi',
  email: 'ramya@example.invalid',
  firebaseUid: 'ramya-firebase',
  status: 'Active',
  role: 'User',
  isBvFacilitator: true,
  isBvsl: true,
  bvGroupId: 'tempos-doc',
  bvGroupName: 'Tempos Mirrored',
};
const otherRgf = {
  id: 'riddhi-doc',
  userId: 'RIDDHI',
  fullName: 'Riddhi Pathak',
  email: 'riddhi@example.invalid',
  status: 'Active',
  role: 'User',
  isBvFacilitator: true,
};
const member = {
  id: 'radhika-doc',
  userId: 'RADHIKA',
  fullName: 'Radhika Singh',
  email: 'radhika@example.invalid',
  status: 'Active',
  role: 'User',
};
const tempos = {
  id: 'tempos-doc',
  groupId: 'BV-GROUP-TEMPOS',
  groupName: 'Tempos Mirrored',
  bvslLeader: otherRgf.id,
  bvslId: otherRgf.userId,
  bvslName: otherRgf.fullName,
};
const colliding = {
  id: 'other-doc',
  groupId: 'tempos-doc',
  groupName: 'Other Group',
  bvslLeader: 'someone-else',
  bvslId: 'SOMEONE',
  bvslName: 'Someone Else',
};

function mockDatabase(t: any, extras?: { users?: any[]; groups?: any[]; members?: any[]; guides?: any[] }) {
  const fixture: Record<string, any[]> = {
    Users: [ramya, otherRgf, member, ...(extras?.users || [])],
    BvGroups: [tempos, colliding, ...(extras?.groups || [])],
    BvGroupMembers: [
      { id: 'ramya-membership', group: tempos.id, groupId: tempos.groupId, user: ramya.id, userId: ramya.userId },
      { id: 'radhika-membership', group: tempos.id, groupId: tempos.groupId, user: member.id, userId: member.userId },
      ...(extras?.members || []),
    ],
    BvAttendance: [],
    BvSessions: [],
    Guides: extras?.guides || [],
  };
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.includes(item));
      return true;
    }
    return [actual].flat().map(item => String(item).toLowerCase()).includes(String(value).toLowerCase());
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
    if (name === 'BvSessions') t.mock.method(table, 'create', async () => ({ id: 'session-1' }));
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

test('an RGF assigned to the reading group can save attendance', async (t) => {
  const created = mockDatabase(t);
  const saved = await conductBvSession.execute({
    input: {
      bvslId: ramya.userId,
      groupId: tempos.id,
      sessionDate: '2026-10-15',
      totalMeetingMinutes: 60,
      memberAttendance: [{ userDbId: member.id, present: true, attendedMinutes: 60 }],
    },
    context: { user: { id: ramya.firebaseUid, uid: ramya.firebaseUid, email: ramya.email, fullName: ramya.fullName, isBvFacilitator: true } },
  } as never);

  assert.equal(saved.success, true);
  assert.equal(created.some(record => record.group === tempos.id), true);
  assert.equal(created.some(record => record.group === colliding.id), false);
});

test('a member who is not an RGF still cannot save attendance', async (t) => {
  mockDatabase(t);
  await assert.rejects(
    () => conductBvSession.execute({
      input: {
        bvslId: member.userId,
        groupId: tempos.id,
        sessionDate: '2026-10-15',
        presentUserIds: [member.id],
      },
      context: { user: { id: member.id, userId: member.userId, email: member.email, fullName: member.fullName } },
    } as never),
    (error: any) => error?.code === 'FORBIDDEN',
  );
});

test('an RGF stored as a guide id can save attendance', async (t) => {
  const guideGroup = {
    id: 'guide-group-doc',
    groupId: 'BV-GROUP-GUIDE',
    groupName: 'Guide Linked',
    bvslLeader: 'guide-doc',
    bvslId: 'GUIDE-1',
    bvslName: 'Old Guide Name',
  };
  const created = mockDatabase(t, {
    groups: [guideGroup],
    guides: [{ id: 'guide-doc', guideId: 'GUIDE-1', email: ramya.email, fullName: 'Old Guide Name' }],
    members: [{ id: 'guide-member', group: guideGroup.id, groupId: guideGroup.groupId, user: member.id, userId: member.userId }],
  });
  const saved = await conductBvSession.execute({
    input: {
      bvslId: ramya.userId,
      groupId: guideGroup.id,
      sessionDate: '2026-10-15',
      memberAttendance: [{ userDbId: member.id, present: true, attendedMinutes: 40 }],
    },
    context: { user: { id: ramya.id, userId: ramya.userId, email: ramya.email, fullName: ramya.fullName, isBvFacilitator: true } },
  } as never);
  assert.equal(saved.success, true);
  assert.equal(created.some(record => record.group === guideGroup.id), true);
});
