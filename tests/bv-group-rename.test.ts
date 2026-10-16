import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import updateBvGroup from '../src/api/updateBvGroup';

function matches(record: any, filters: any) {
  return Object.entries(filters || {}).every(([field, value]) => {
    const actual = Array.isArray(record[field]) ? record[field][0] : record[field];
    if (value && typeof value === 'object' && Array.isArray((value as any).in)) {
      return (value as any).in.includes(actual);
    }
    return String(actual || '') === String(value || '');
  });
}

function installMemory(t: any, tables: Record<string, any[]>) {
  const stores: Record<string, any[]> = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]),
  );
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function' || !stores[name]) continue;
    const rows = () => stores[name];
    t.mock.method(table, 'findAll', async (options: any = {}) => ({
      records: rows().filter(record => (!options.id || record.id === options.id) && matches(record, options.filters)),
      hasMore: false,
    }));
    t.mock.method(table, 'findOne', async (options: any = {}) => {
      if (options.id) return rows().find(record => record.id === options.id);
      return rows().find(record => matches(record, options.filters));
    });
    t.mock.method(table, 'update', async ({ id, record }: { id: string; record: any }) => {
      const row = rows().find(item => item.id === id);
      if (!row) throw new Error(`Missing ${name}/${id}`);
      Object.assign(row, record);
      return row;
    });
    t.mock.method(table, 'delete', async ({ id }: { id: string }) => {
      const index = rows().findIndex(item => item.id === id);
      if (index >= 0) rows().splice(index, 1);
    });
  }
  return stores;
}

const admin = { id: 'admin', role: 'ADMIN', isBvAdmin: true, isActive: true };
const superAdmin = { id: 'super', role: 'SUPER_ADMIN', isBvSuperAdmin: true, isActive: true };
const member = { id: 'member-user', role: 'User', isActive: true };

test('an admin rename updates the group and every assigned member profile', async t => {
  const stores = installMemory(t, {
    BvGroups: [{
      id: 'group-doc',
      groupId: 'group-public',
      groupName: 'VDN Group',
      whatsAppLink: `https://wa.me/?text=${encodeURIComponent('Join *VDN Group* today')}`,
    }],
    Users: [
      { id: 'member-doc', userId: 'member-public', bvGroupId: 'group-doc', bvGroupName: 'VDN Group' },
      { id: 'member-public-ref', userId: 'member-alias', bvGroupId: 'group-public', bvGroupName: 'VDN Group' },
      { id: 'other-member', userId: 'other', bvGroupId: 'other-group', bvGroupName: 'Other Group' },
    ],
    BvGroupMembers: [
      { id: 'membership-doc', group: 'group-doc', user: 'member-doc' },
      { id: 'membership-public', groupId: 'group-public', userId: 'member-alias' },
    ],
  });

  const result = await updateBvGroup.execute({
    input: { groupId: 'group-public', groupName: '  Mayapur Reading  ' },
    context: { user: admin },
  } as never);

  assert.equal(result.groupName, 'Mayapur Reading');
  assert.equal(stores.BvGroups[0].groupName, 'Mayapur Reading');
  assert.equal(decodeURIComponent(new URL(stores.BvGroups[0].whatsAppLink).searchParams.get('text') || ''), 'Join *Mayapur Reading* today');
  assert.equal(stores.Users.find(user => user.id === 'member-doc')?.bvGroupName, 'Mayapur Reading');
  assert.equal(stores.Users.find(user => user.id === 'member-public-ref')?.bvGroupName, 'Mayapur Reading');
  assert.equal(stores.Users.find(user => user.id === 'other-member')?.bvGroupName, 'Other Group');
});

test('a super admin can rename a reading group and a member cannot', async t => {
  const stores = installMemory(t, {
    BvGroups: [{ id: 'group-doc', groupId: 'group-public', groupName: '2nd Group' }],
    Users: [{ id: 'member-doc', bvGroupId: 'group-doc', bvGroupName: '2nd Group' }],
    BvGroupMembers: [],
  });

  await assert.rejects(
    () => updateBvGroup.execute({ input: { groupId: 'group-doc', groupName: 'Renamed' }, context: { user: member } } as never),
    /Only an Admin or Super Admin/,
  );
  assert.equal(stores.BvGroups[0].groupName, '2nd Group');

  const result = await updateBvGroup.execute({
    input: { groupId: 'group-doc', groupName: 'Second Group' },
    context: { user: superAdmin },
  } as never);
  assert.equal(result.success, true);
  assert.equal(stores.BvGroups[0].groupName, 'Second Group');
  assert.equal(stores.Users[0].bvGroupName, 'Second Group');
  assert.equal(updateBvGroup.inputSchema.safeParse({ groupId: 'group-doc', groupName: '   ' }).success, false);
});

test('an admin can add a second RGF to a group and remove one', async t => {
  const stores = installMemory(t, {
    BvGroups: [
      { id: 'krishna-doc', groupId: 'krishna', groupName: 'Krishna', bvslLeader: 'rachna-doc', bvslId: 'rachna', bvslName: 'Rachna Sharma' },
      { id: 'temple-doc', groupId: 'temple', groupName: 'Temple SF 1', bvslLeader: 'punya-doc', bvslId: 'punya', bvslName: 'Punya' },
    ],
    Users: [
      { id: 'rachna-doc', userId: 'rachna', fullName: 'Rachna Sharma', email: 'rachna@example.invalid', role: 'User', isBvFacilitator: true },
      { id: 'punya-doc', userId: 'punya', fullName: 'Punya', email: 'punya@example.invalid', role: 'User', isBvFacilitator: true },
    ],
    BvGroupMembers: [],
  });

  await updateBvGroup.execute({
    input: { groupId: 'temple', bvslId: 'rachna-doc', facilitatorAction: 'add' },
    context: { user: admin },
  } as never);
  assert.deepEqual(stores.BvGroups[1].bvslLeader, ['punya-doc', 'rachna-doc']);
  assert.deepEqual(stores.BvGroups[1].bvslId, ['punya', 'rachna']);
  assert.deepEqual(stores.BvGroups[1].bvslName, ['Punya', 'Rachna Sharma']);
  assert.equal(stores.BvGroups[0].bvslLeader, 'rachna-doc');

  await updateBvGroup.execute({
    input: { groupId: 'temple', bvslId: 'rachna', facilitatorAction: 'remove' },
    context: { user: admin },
  } as never);
  assert.equal(stores.BvGroups[1].bvslLeader, 'punya-doc');
  assert.equal(stores.BvGroups[1].bvslId, 'punya');
  assert.equal(stores.BvGroups[1].bvslName, 'Punya');

  await updateBvGroup.execute({
    input: { groupId: 'krishna', bvslId: '' },
    context: { user: admin },
  } as never);
  assert.equal(stores.BvGroups[0].bvslLeader, '');
  assert.equal(stores.BvGroups[0].bvslId, '');
  assert.equal(stores.BvGroups[0].bvslName, '');

  await assert.rejects(
    () => updateBvGroup.execute({ input: { groupId: 'temple', bvslId: '' }, context: { user: member } } as never),
    (error: any) => error?.code === 'FORBIDDEN',
  );
  assert.equal(stores.BvGroups[1].bvslLeader, 'punya-doc');
});

test('an admin can remove a former RGF who is still listed on the group', async t => {
  const stores = installMemory(t, {
    BvGroups: [{
      id: 'vdn-doc',
      groupId: 'vdn',
      groupName: 'VDN Group',
      bvslLeader: ['dasa-doc', 'former-doc'],
      bvslId: ['dasa', 'former'],
      bvslName: ['Vedanarayana Dasa', 'F20190150H'],
    }],
    Users: [
      { id: 'dasa-doc', userId: 'dasa', fullName: 'Vedanarayana Dasa', email: 'dasa@example.invalid', role: 'User', isBvFacilitator: true, isBvsl: true },
      { id: 'former-doc', userId: 'former', fullName: 'F20190150H', email: 'former@example.invalid', role: 'User', isBvFacilitator: false, isBvsl: false, isBvSubFacilitator: true },
    ],
    BvGroupMembers: [],
  });

  await updateBvGroup.execute({
    input: { groupId: 'vdn', bvslId: 'former', facilitatorAction: 'remove' },
    context: { user: admin },
  } as never);

  assert.equal(stores.BvGroups[0].bvslLeader, 'dasa-doc');
  assert.equal(stores.BvGroups[0].bvslId, 'dasa');
  assert.equal(stores.BvGroups[0].bvslName, 'Vedanarayana Dasa');
});

test('removing an RGF also removes that person from the group member list', async t => {
  const stores = installMemory(t, {
    BvGroups: [{
      id: 'gauranga-doc',
      groupId: 'gauranga',
      groupName: 'Gauranga 1:30',
      bvslLeader: ['ramya-doc', 'asha-doc'],
      bvslId: ['ramya', 'asha'],
      bvslName: ['Ramya Devi Dasi', 'Asha N'],
    }],
    Users: [
      { id: 'ramya-doc', userId: 'ramya', fullName: 'Ramya Devi Dasi', email: 'ramya@example.invalid', role: 'User', isBvFacilitator: true, isBvsl: true },
      { id: 'asha-doc', userId: 'asha', fullName: 'Asha N', email: 'asha@example.invalid', role: 'User', isBvFacilitator: true, isBvsl: true, bvGroupId: 'gauranga-doc', bvGroupName: 'Gauranga 1:30', isBvMember: true },
      { id: 'priya-doc', userId: 'priya', fullName: 'Priya bansal', bvGroupId: 'gauranga-doc', bvGroupName: 'Gauranga 1:30', isBvMember: true },
    ],
    BvGroupMembers: [
      { id: 'asha-membership', group: 'gauranga-doc', groupId: 'gauranga', user: 'asha-doc', userId: 'asha', role: 'Member' },
      { id: 'priya-membership', group: 'gauranga-doc', groupId: 'gauranga', user: 'priya-doc', userId: 'priya', role: 'Member' },
    ],
  });

  await updateBvGroup.execute({
    input: { groupId: 'gauranga', bvslId: 'asha', facilitatorAction: 'remove' },
    context: { user: admin },
  } as never);

  assert.equal(stores.BvGroups[0].bvslLeader, 'ramya-doc');
  assert.deepEqual(stores.BvGroupMembers.map(row => row.id), ['priya-membership']);
  assert.equal(stores.Users.find(user => user.id === 'asha-doc')?.bvGroupId, '');
  assert.equal(stores.Users.find(user => user.id === 'asha-doc')?.isBvMember, false);
  assert.equal(stores.Users.find(user => user.id === 'priya-doc')?.bvGroupId, 'gauranga-doc');
});
