import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import updateBvGroup from '../src/api/updateBvGroup';

function matches(record: any, filters: any) {
  return Object.entries(filters || {}).every(([field, value]) => {
    const actual = Array.isArray(record[field]) ? record[field][0] : record[field];
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
