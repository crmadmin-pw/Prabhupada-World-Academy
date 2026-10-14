import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import createBvGroup from '../src/api/createBvGroup';
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
    t.mock.method(table, 'create', async ({ record }: { record: any }) => {
      const row = { id: record.id || `${name}-${rows().length + 1}`, ...record };
      stores[name].push(row);
      return row;
    });
  }
  return stores;
}

const admin = { id: 'admin', role: 'ADMIN', isBvAdmin: true, segment: 'PW' };
const rgf = { id: 'rgf-doc', userId: 'rgf-public', fullName: 'Ramya Devi Dasi', segment: 'PW', isBvFacilitator: true };
const folkRgf = { id: 'folk-doc', userId: 'folk-public', fullName: 'Folk RGF', segment: 'FOLK', isBvFacilitator: true };

test('a department cannot create or rename onto a reading group name it already uses', async t => {
  const stores = installMemory(t, {
    BvGroups: [
      { id: 'pw-doc', groupId: 'pw-public', groupName: 'Gauranga', segment: 'PW', isActive: true },
      { id: 'folk-group', groupId: 'folk-public', groupName: 'Temple', segment: 'FOLK', isActive: true },
      { id: 'other-doc', groupId: 'other-public', groupName: 'Evening', segment: 'PW', isActive: true },
    ],
    Users: [rgf, folkRgf],
    Guides: [],
    BvGroupMembers: [],
  });

  await assert.rejects(
    () => createBvGroup.execute({
      input: { groupName: '  gauranga  ', bvslId: 'rgf-doc' },
      context: { user: admin },
    } as never),
    /Prabhupada World reading group named "gauranga" already exists/,
  );

  const folkCopy = await createBvGroup.execute({
    input: { groupName: 'Gauranga', bvslId: 'folk-doc' },
    context: { user: { ...admin, segment: 'FOLK' } },
  } as never);
  assert.equal(folkCopy.success, true);
  assert.equal(stores.BvGroups.find(group => group.groupId === folkCopy.groupId)?.segment, 'FOLK');

  await assert.rejects(
    () => createBvGroup.execute({
      input: { groupName: 'Temple', bvslId: 'folk-doc' },
      context: { user: { ...admin, segment: 'FOLK' } },
    } as never),
    /FOLK reading group named "Temple" already exists/,
  );

  await assert.rejects(
    () => updateBvGroup.execute({
      input: { groupId: 'other-public', groupName: 'GAURANGA' },
      context: { user: admin },
    } as never),
    /already exists/,
  );
  assert.equal(stores.BvGroups.find(group => group.id === 'other-doc')?.groupName, 'Evening');

  const renamed = await updateBvGroup.execute({
    input: { groupId: 'other-public', groupName: 'Temple' },
    context: { user: admin },
  } as never);
  assert.equal(renamed.groupName, 'Temple');
});
