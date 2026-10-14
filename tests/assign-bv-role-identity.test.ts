import assert from 'node:assert/strict';
import test from 'node:test';
import { Users, BvGroups } from '../src/lib/app-backend-sdk';
import assignBvRole from '../src/api/assignBvRole';

const parent = {
  id: 'parent-auth',
  userId: 'USER-001',
  email: 'parent@example.test',
  fullName: 'Parent Das',
  role: 'User',
  isBvSupervisor: true,
};

const realMember = {
  id: 'auth-uid-1',
  userId: 'USER-045',
  email: 'member@example.test',
  fullName: 'Real Member',
  role: 'User',
};

function mockDirectory(t: any, records: any[]) {
  const updates: { id: string; record: any }[] = [];
  t.mock.method(Users, 'findOne', async (query: any) =>
    records.find(record => record.id === query.id) || null);
  t.mock.method(Users, 'findAll', async (query: any) => {
    const filters = query?.filters || {};
    let matched = records;
    if (filters.userId) {
      matched = records.filter(record => String(record.userId || '').toLowerCase() === String(filters.userId).toLowerCase());
    } else if (filters.email) {
      matched = records.filter(record => String(record.email || '').toLowerCase() === String(filters.email).toLowerCase());
    }
    return { records: matched, hasMore: false };
  });
  t.mock.method(Users, 'update', async (change: any) => {
    updates.push(change);
    return change;
  });
  return updates;
}

const superAdmin = {
  user: {
    id: 'super-admin',
    email: 'super@example.test',
    fullName: 'Super Admin',
    role: 'SUPER_ADMIN',
    isBvSuperAdmin: true,
    capabilities: ['*'],
  },
};

test('assigning a group role updates the real profile and does not write alias keys', async (t) => {
  const shadowByNumber = { id: 'USER-045', role: 'User', isBvFacilitator: false };
  const shadowByEmail = { id: 'member@example.test', role: 'User' };
  const updates = mockDirectory(t, [realMember, shadowByNumber, shadowByEmail, parent]);

  const result = await assignBvRole.execute({
    input: { userId: 'USER-045', role: 'FACILITATOR', parentId: 'USER-001' },
    context: superAdmin,
  } as never);

  assert.equal(result.success, true);
  assert.deepEqual(updates.map(update => update.id), ['auth-uid-1']);
  assert.equal(updates[0].record.isBvFacilitator, true);
  assert.equal(updates[0].record.isBvsl, true);
});

test('assigning a role by email still updates only the auth profile', async (t) => {
  const shadowByEmail = { id: 'member@example.test', role: 'User' };
  const updates = mockDirectory(t, [realMember, shadowByEmail, parent]);

  await assignBvRole.execute({
    input: { userId: 'member@example.test', role: 'SUPERVISOR', parentId: 'parent-auth' },
    context: superAdmin,
  } as never);

  assert.deepEqual(updates.map(update => update.id), ['auth-uid-1']);
  assert.equal(updates[0].record.isBvSupervisor, true);
});

test('a legacy profile whose only id is the member number is updated in place', async (t) => {
  const legacy = {
    id: 'USER-088',
    userId: 'USER-088',
    email: 'legacy@example.test',
    fullName: 'Legacy Member',
    role: 'User',
  };
  const updates = mockDirectory(t, [legacy, parent]);

  await assignBvRole.execute({
    input: { userId: 'legacy@example.test', role: 'FACILITATOR', parentId: 'parent-auth' },
    context: superAdmin,
  } as never);

  assert.deepEqual(updates.map(update => update.id), ['USER-088']);
});

test('changing an RGF to RGSF removes that person from the reading group', async (t) => {
  const parentRgf = {
    id: 'parent-rgf',
    userId: 'PARENT-RGF',
    email: 'parent-rgf@example.test',
    fullName: 'Vedanarayana Dasa',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const former = {
    id: 'former-doc',
    userId: 'FORMER-1',
    email: 'former@example.test',
    fullName: 'F20190150H',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const group = {
    id: 'vdn-doc',
    bvslLeader: ['parent-rgf', 'former-doc'],
    bvslId: ['PARENT-RGF', 'FORMER-1'],
    bvslName: ['Vedanarayana Dasa', 'F20190150H'],
  };
  const updates = mockDirectory(t, [former, parentRgf]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [group, { id: 'other', bvslLeader: 'someone-else', bvslId: 'someone-else', bvslName: 'Someone Else' }], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: { userId: 'FORMER-1', role: 'SUB_FACILITATOR', parentId: 'PARENT-RGF' },
    context: superAdmin,
  } as never);

  assert.equal(updates[0].record.isBvFacilitator, false);
  assert.equal(updates[0].record.isBvsl, false);
  assert.equal(updates[0].record.isBvSubFacilitator, true);
  assert.deepEqual(groupUpdates.map(change => change.id), ['vdn-doc']);
  assert.equal(groupUpdates[0].record.bvslLeader, 'parent-rgf');
  assert.equal(groupUpdates[0].record.bvslId, 'PARENT-RGF');
  assert.equal(groupUpdates[0].record.bvslName, 'Vedanarayana Dasa');
});

test('a PW role change for someone in several groups asks which group and leaves the others', async (t) => {
  const person = {
    id: 'pw-user',
    userId: 'PW-USER',
    email: 'pw@example.test',
    fullName: 'Pw User',
    role: 'User',
    segment: 'PW',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const morning = {
    id: 'group-morning',
    groupId: 'group-morning',
    groupName: 'Morning',
    bvslLeader: 'pw-user',
    bvslId: 'PW-USER',
    bvslName: 'Pw User',
  };
  const evening = {
    id: 'group-evening',
    groupId: 'group-evening',
    groupName: 'Evening',
    bvslLeader: ['other', 'pw-user'],
    bvslId: ['OTHER', 'PW-USER'],
    bvslName: ['Other Das', 'Pw User'],
  };
  const updates = mockDirectory(t, [person, parent]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [morning, evening], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assert.rejects(
    () => assignBvRole.execute({
      input: { userId: 'PW-USER', role: 'SUB_FACILITATOR', parentId: 'USER-001' },
      context: superAdmin,
    } as never),
    (error: any) => error.code === 'CONFLICT' && /Morning/.test(error.message) && /Evening/.test(error.message),
  );
  assert.equal(groupUpdates.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(morning.bvslLeader, 'pw-user');
});

test('a PW user can be RGF of one group and RGSF of another', async (t) => {
  const person = {
    id: 'pw-user',
    userId: 'PW-USER',
    email: 'pw@example.test',
    fullName: 'Pw User',
    role: 'User',
    segment: 'PW',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const morning = {
    id: 'group-morning',
    groupId: 'group-morning',
    groupName: 'Morning',
    bvslLeader: 'pw-user',
    bvslId: 'PW-USER',
    bvslName: 'Pw User',
  };
  const evening = {
    id: 'group-evening',
    groupId: 'group-evening',
    groupName: 'Evening',
    bvslLeader: ['other', 'pw-user'],
    bvslId: ['OTHER', 'PW-USER'],
    bvslName: ['Other Das', 'Pw User'],
  };
  const updates = mockDirectory(t, [person, parent]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [morning, evening], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: {
      userId: 'PW-USER',
      role: 'SUB_FACILITATOR',
      parentId: 'USER-001',
      groupRoles: [{ groupId: 'group-evening', role: 'SUB_FACILITATOR' }],
    },
    context: superAdmin,
  } as never);

  assert.equal(morning.bvslLeader, 'pw-user');
  assert.deepEqual(groupUpdates.map(change => change.id), ['group-evening']);
  assert.equal(groupUpdates[0].record.bvslLeader, 'other');
  assert.equal(groupUpdates[0].record.bvslId, 'OTHER');
  assert.equal(groupUpdates[0].record.subFacilitatorId, 'pw-user');
  assert.equal(groupUpdates[0].record.rgsfId, 'PW-USER');
  assert.equal(updates[0].record.isBvFacilitator, true);
  assert.equal(updates[0].record.isBvsl, true);
  assert.equal(updates[0].record.isBvSubFacilitator, true);
});

test('changing an RGF to RGSF removes them when the group stored facilitators as comma-separated text', async (t) => {
  const parentRgf = {
    id: 'parent-rgf',
    userId: 'PARENT-RGF',
    email: 'parent-rgf@example.test',
    fullName: 'Punya',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const former = {
    id: 'former-doc',
    userId: 'FORMER-1',
    email: 'richa@example.test',
    fullName: 'Richa Dewan',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const group = {
    id: 'nityananda-doc',
    bvslLeader: 'parent-rgf,former-doc',
    bvslId: 'PARENT-RGF,FORMER-1',
    bvslName: 'Punya, Richa Dewan',
  };
  const updates = mockDirectory(t, [former, parentRgf]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [group], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: { userId: 'FORMER-1', role: 'SUB_FACILITATOR', parentId: 'PARENT-RGF' },
    context: superAdmin,
  } as never);

  assert.equal(updates[0].record.isBvSubFacilitator, true);
  assert.equal(updates[0].record.isBvsl, false);
  assert.deepEqual(groupUpdates.map(change => change.id), ['nityananda-doc']);
  assert.equal(groupUpdates[0].record.bvslLeader, 'parent-rgf');
  assert.equal(groupUpdates[0].record.bvslId, 'PARENT-RGF');
  assert.equal(groupUpdates[0].record.bvslName, 'Punya');
});
