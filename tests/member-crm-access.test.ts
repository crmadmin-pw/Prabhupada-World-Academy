import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import getUserCrmData from '../src/api/getUserCrmData';
import getAshrayChecklist from '../src/api/getAshrayChecklist';

const member = (id: string, extra: any = {}) => ({ id, userId: `USER-${id}`, email: `${id}@example.test`, role: 'User', segment: 'PW', ...extra });
const own = member('101');
const foreign = member('102', { guide: 'foreign-guide' });
const caller = member('100');

function database(t: any, viewer: any, extra: Record<string, any[]> = {}) {
  const fixtures: Record<string, any[]> = {
    Users: [viewer, own, foreign],
    Trips: [{ id: 'trip', user: own.id, totalAmount: 100 }],
    RentPayments: [{ id: 'rent', user: own.id, amountDue: 50 }],
    AshrayUpgradeRequests: [{ id: 'upgrade', userId: own.userId, status: 'Pending' }],
    AshrayChecklist: [{ id: 'checklist', user: own.id, checklistDataJson: '["reading"]' }],
    ...extra,
  };
  const reads: string[] = [];
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      reads.push(name);
      const records = (fixtures[name] || []).filter(record => (!options.id || record.id === options.id)
        && Object.entries(options.filters || {}).every(([key, value]: any) =>
          value?.in ? value.in.includes(record[key]) : record[key] === value));
      const offset = options.offset || 0;
      return { records: records.slice(offset, offset + (options.limit || 2000)).map(record => options.fields
        ? Object.fromEntries(['id', ...options.fields].map(key => [key, record[key]])) : { ...record }), hasMore: false };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
  return reads;
}
const call = (endpoint: any, viewer: any, userId?: string) => endpoint.execute({ input: { userId }, context: { user: viewer } });
const protectedTables = ['Trips', 'RentPayments', 'AshrayUpgradeRequests', 'AshrayChecklist'];

for (const [name, endpoint] of [['CRM', getUserCrmData], ['Ashray checklist', getAshrayChecklist]] as const) {
  test(`${name}: role or flag alone never grants another member's records`, async t => {
    for (const roleFlags of [{ role: 'Guide' }, { role: 'BVSL' }, { role: 'Sadhana Mentor' },
      { isBvsl: true }, { isBvFacilitator: true }, { isSadhanaMentor: true },
      { isFolkLead: true }, { isTripCoordinator: true }, { role: 'ADMIN', isPwAdmin: true }, {}]) {
      await t.test(JSON.stringify(roleFlags), async st => {
        const viewer = { ...caller, ...roleFlags };
        const reads = database(st, viewer);
        for (const id of [foreign.id, foreign.userId]) {
          await assert.rejects(call(endpoint, viewer, id), (error: any) => error.code === 'FORBIDDEN');
        }
        assert.deepEqual(reads.filter(table => protectedTables.includes(table)), []);
      });
    }
  });

  test(`${name}: assigned mentors and active group coordinators retain access through both member IDs`, async t => {
    for (const type of ['mentor', 'facilitator', 'coordinator']) {
      await t.test(type, async st => {
        const viewer = { ...caller, isSadhanaMentor: type === 'mentor', isBvFacilitator: type === 'facilitator', isTripCoordinator: type === 'coordinator' };
        database(st, viewer, {
          Users: [viewer, { ...own, sadhanaMentor: type === 'mentor' ? [viewer.userId] : null }, foreign],
          BvGroups: [{ id: 'group', bvslId: viewer.id, isActive: true, segment: 'PW' }],
          BvGroupMembers: type === 'mentor' ? [] : [{ id: 'membership', group: 'group', user: own.userId, isActive: true }],
        });
        for (const id of [own.id, own.userId]) {
          const result = await call(endpoint, viewer, id);
          if (name === 'CRM') {
            assert.equal(result.trips[0].id, 'trip');
            assert.equal(result.rentPayments[0].id, 'rent');
            assert.equal(result.ashrayHistory[0].id, 'upgrade');
          } else assert.deepEqual(result.checkedItems, ['reading']);
        }
      });
    }
  });

  test(`${name}: inactive memberships deny access before protected reads`, async t => {
    const viewer = { ...caller, isBvsl: true };
    const reads = database(t, viewer, {
      BvGroups: [{ id: 'group', bvslId: viewer.id, isActive: true }],
      BvGroupMembers: [{ id: 'membership', group: 'group', user: own.id, isActive: false }],
    });
    await assert.rejects(call(endpoint, viewer, own.id), (error: any) => error.code === 'FORBIDDEN');
    assert.deepEqual(reads.filter(table => protectedTables.includes(table)), []);
  });

  test(`${name}: FOLK guide and mentor access stops at their own guide hierarchy`, async t => {
    for (const role of ['Guide', 'Sadhana Mentor']) {
      await t.test(role, async st => {
        const viewer = { ...caller, role, segment: 'FOLK', guide: 'own-guide' };
        const reads = database(st, viewer, {
          Users: [viewer, { ...own, segment: 'FOLK', guide: ['own-guide'], residency: 'own-center' },
            { ...foreign, segment: 'FOLK', residency: 'foreign-center' }],
          Guides: [{ id: 'own-guide', email: role === 'Guide' ? viewer.email : 'guide@example.test' }],
        });
        await call(endpoint, viewer, own.userId);
        reads.length = 0;
        await assert.rejects(call(endpoint, viewer, foreign.userId), (error: any) => error.code === 'FORBIDDEN');
        assert.deepEqual(reads.filter(table => protectedTables.includes(table)), []);
      });
    }
  });

  test(`${name}: self and super-admin access remain available`, async t => {
    database(t, own, { Users: [own, foreign] });
    for (const id of [own.id, own.userId]) await call(endpoint, own, id);
    await call(endpoint, { ...caller, role: 'SUPER_ADMIN' }, own.id);
    await call(endpoint, { ...caller, role: 'Super Guide' }, own.id);
    if (name !== 'CRM') assert.deepEqual((await call(endpoint, own)).checkedItems, ['reading']);
  });

  test(`${name}: failed hierarchy lookup fails closed`, async t => {
    const reads = database(t, { ...caller, isTripCoordinator: true });
    t.mock.method(sdk.BvGroups, 'findAll', async () => { throw new Error('hierarchy unavailable'); });
    await assert.rejects(call(endpoint, caller, own.id), /hierarchy unavailable/);
    assert.deepEqual(reads.filter(table => protectedTables.includes(table)), []);
  });

  test(`${name}: unknown target does not fall back to the caller`, async t => {
    const reads = database(t, caller);
    await assert.rejects(call(endpoint, caller, 'missing'), (error: any) => error.code === 'NOT_FOUND');
    assert.deepEqual(reads.filter(table => protectedTables.includes(table)), []);
  });
}
