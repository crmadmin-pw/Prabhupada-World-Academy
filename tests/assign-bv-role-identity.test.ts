import assert from 'node:assert/strict';
import test from 'node:test';
import { Users } from '../src/lib/app-backend-sdk';
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
