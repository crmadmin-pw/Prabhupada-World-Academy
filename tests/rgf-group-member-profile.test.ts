import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import getUserDetailForGuide from '../src/api/getUserDetailForGuide';

const rgf = {
  id: 'rgf-doc', userId: 'USER-RGF', email: 'rgf@example.test', fullName: 'Reading Guide',
  role: 'User', segment: 'PW', isBvFacilitator: true, isBvsl: false, status: 'Active',
};
const member = {
  id: 'member-doc', userId: 'USER-MEMBER', email: 'member@example.test', fullName: 'Group Member',
  role: 'User', segment: 'PW', status: 'Active',
};
const outsider = {
  id: 'outsider-doc', userId: 'USER-OUT', email: 'out@example.test', fullName: 'Someone Else',
  role: 'User', segment: 'PW', status: 'Active',
};

function database(t: any, rows: { users: any[]; groups: any[]; members: any[] }) {
  const fixtures: Record<string, any[]> = {
    Users: rows.users,
    BvGroups: rows.groups,
    BvGroupMembers: rows.members,
  };
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.map(String).includes(String(item)));
      return (value.gte === undefined || actual >= value.gte) && (value.lte === undefined || actual <= value.lte);
    }
    return [actual].flat().map(String).includes(String(value));
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixtures[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      const offset = options.offset || 0;
      const page = records.slice(offset, offset + (options.limit || 2000));
      return {
        records: page.map(record => options.fields
          ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, record[key]]))
          : { ...record }),
        hasMore: false,
      };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
}

const call = (userId: string, caller: any = rgf) => getUserDetailForGuide.execute({
  input: { userId },
  context: { user: caller },
});

test('an RGF can open a member of the group they facilitate', async t => {
  database(t, {
    users: [rgf, member, outsider],
    groups: [{ id: 'group-doc', groupId: 'BV-GROUP-1', isActive: true, segment: 'PW', bvslLeader: rgf.id, bvslId: rgf.userId, bvslName: rgf.fullName }],
    members: [{ id: 'membership', group: 'group-doc', user: member.userId, isActive: true }],
  });
  const detail = await call(member.userId);
  assert.equal(detail.user.fullName, 'Group Member');
  assert.equal(detail.user.dbId, member.id);
  await assert.rejects(call(outsider.userId), /your BV groups/);
});

test('an RGF can open a member stored on the legacy membership id', async t => {
  database(t, {
    users: [rgf, member],
    groups: [{ id: 'group-doc', groupId: 'BV-GROUP-1', isActive: true, bvslLeader: [rgf.id], bvslId: [rgf.userId], bvslName: [rgf.fullName] }],
    members: [{ id: 'membership', groupId: 'BV-GROUP-1', memberId: member.id, isActive: true }],
  });
  const detail = await call(member.id);
  assert.equal(detail.user.dbId, member.id);
});

test('an RGF who is also an RGSF can open a member of the group they sub-facilitate', async t => {
  const both = { ...rgf, isBvSubFacilitator: true };
  database(t, {
    users: [both, member],
    groups: [{
      id: 'group-evening',
      groupId: 'BV-EVENING',
      segment: 'PW',
      bvslLeader: 'other-rgf',
      bvslId: 'USER-OTHER',
      subFacilitatorId: both.id,
      rgsfId: both.userId,
      subFacilitator: both.fullName,
    }],
    members: [{ id: 'membership', group: 'group-evening', userId: member.userId, isActive: true }],
  });
  const detail = await call(member.userId, both);
  assert.equal(detail.user.fullName, 'Group Member');
});

test('an RGF can open a member whose membership uses another saved id', async t => {
  const punya = {
    ...member,
    id: 'punya-doc',
    userId: 'USER-234',
    fullName: 'Punya',
    firebaseUserId: 'firebase-punya',
  };
  database(t, {
    users: [rgf, punya],
    groups: [{ id: 'group-doc', groupId: 'BV-GROUP-1', isActive: true, bvslId: rgf.userId, bvslName: rgf.fullName }],
    members: [{ id: 'membership', groupId: 'BV-GROUP-1', user: 'firebase-punya', isActive: true }],
  });
  const detail = await call('USER-234');
  assert.equal(detail.user.fullName, 'Punya');
});

test('an RGF can open a member saved on the membership by name', async t => {
  database(t, {
    users: [rgf, member],
    groups: [{ id: 'group-doc', groupId: 'BV-GROUP-1', isActive: true, bvslLeader: rgf.fullName }],
    members: [{ id: 'membership', group: 'group-doc', memberId: member.fullName, isActive: true }],
  });
  const detail = await call(member.userId);
  assert.equal(detail.user.fullName, 'Group Member');
});

test('a left membership does not let the RGF open that profile', async t => {
  database(t, {
    users: [rgf, member],
    groups: [{ id: 'group-doc', groupId: 'BV-GROUP-1', isActive: true, bvslId: rgf.userId }],
    members: [{ id: 'membership', group: 'group-doc', user: member.id, isActive: false }],
  });
  await assert.rejects(call(member.userId), /your BV groups/);
});
