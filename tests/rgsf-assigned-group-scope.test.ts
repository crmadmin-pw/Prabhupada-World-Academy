import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { resolveBvScopedGroups, resolveBvGroupMemberUsers } from '../src/lib/bvGroupMemberScope';
import { resolveHierarchyScope, buildReportingChains, scopeFromReportingChains } from '../src/lib/hierarchyUtils';
import { callerCanRecordGroupAttendance } from '../src/lib/bvAttendanceAccess';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import getBvslGroups from '../src/api/getBvslGroups';
import getAttendanceForDate from '../src/api/getAttendanceForDate';
import getBvslOneToOneData from '../src/api/getBvslOneToOneData';
import conductBvSession from '../src/api/conductBvSession';
import markBvAttendance from '../src/api/markBvAttendance';
import getUserDetailForGuide from '../src/api/getUserDetailForGuide';
import assignBvRole from '../src/api/assignBvRole';

const rgf = { id: 'asha', userId: 'RGF-ASHA', email: 'asha@example.test', fullName: 'Asha N', role: 'RGF', segment: 'PW', status: 'Active', isBvFacilitator: true };
const rgsf = { id: 'richa', userId: 'RGSF-RICHA', email: 'richa@example.test', fullName: 'Richa Pathak', role: 'RGSF', segment: 'PW', status: 'Active', isBvSubFacilitator: true, bvReportingFacilitatorId: rgf.userId, bvGroupId: 'GADADHARA' };
const gadadhara = { id: 'gada', groupId: 'GADADHARA', groupName: 'Gadadhara', segment: 'PW', isActive: true, bvslId: rgf.userId, subFacilitatorId: rgsf.id };
const krishna = { id: 'krishna', groupId: 'KRISHNA', groupName: 'Krishna', segment: 'PW', isActive: true, bvslId: rgf.id };
const members = ['gada-boy', 'krishna-boy'].map(id => ({ id, userId: id.toUpperCase(), fullName: id, segment: 'PW', role: 'User', status: 'Active' }));
const memberships = [
  { id: 'm-gada', group: gadadhara.id, user: members[0].id },
  { id: 'm-krishna', group: krishna.id, user: members[1].id },
];

// Every table read and write is mocked; these tests never reach Firebase.
function fixture(t: any, extra: { caller?: any; groups?: any[]; memberships?: any[] } = {}) {
  serverCacheInvalidate();
  const caller = { ...rgsf, ...extra.caller };
  const groups = extra.groups || [gadadhara, krishna];
  const rows: Record<string, any[]> = {
    Users: [rgf, caller, ...members], BvGroups: groups,
    BvGroupMembers: [...memberships, ...(extra.memberships || [])],
    BvSessions: [{ id: 'krishna-session', group: krishna.id, sessionDate: '2026-10-24' }],
  };
  const writes: string[] = [];
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      const records = (rows[name] || []).filter(record => (!options.id || record.id === options.id) &&
        Object.entries(options.filters || {}).every(([field, value]: any) => {
          const actual = [record[field]].flat();
          return value?.in ? actual.some(item => value.in.includes(item)) : actual.includes(value);
        }));
      return { records: records.map(record => options.fields
        ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, record[key]])) : { ...record }), hasMore: false };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
    for (const method of ['create', 'update', 'delete', 'bulkCreate']) {
      if (typeof table[method] !== 'function') continue;
      t.mock.method(table, method, async () => { writes.push(`${name}.${method}`); return { id: 'new', records: [] }; });
    }
  }
  return { caller, groups, rows, writes };
}
const context = (user: any) => ({ user });
const forbidden = (error: any) => error.code === 'FORBIDDEN';

test('selecting another RGF/group pair moves RGSF access to exactly that group', async t => {
  const { caller, groups, rows } = fixture(t, { groups: [{ ...gadadhara }, { ...krishna }] });
  t.mock.method(sdk.BvGroups, 'update', async ({ id, record }: any) => { Object.assign(groups.find(group => group.id === id)!, record); return { id }; });
  t.mock.method(sdk.Users, 'update', async ({ id, record }: any) => { Object.assign(rows.Users.find(user => user.id === id)!, record); return { id }; });
  await assignBvRole.execute({ input: { userId: caller.id, role: 'SUB_FACILITATOR', parentId: rgf.id, rgsfReportsToId: rgf.id, rgsfGroupId: krishna.id, multiRoles: { isSubFacilitator: true } }, context: context({ id: 'super', role: 'SUPER_ADMIN', isBvSuperAdmin: true }) } as never);
  assert.deepEqual((await resolveBvScopedGroups(caller)).map(group => group.id), [krishna.id]);
  assert.equal(await callerCanRecordGroupAttendance(groups[0], caller), false);
  assert.equal(await callerCanRecordGroupAttendance(groups[1], caller), true);
  const scoped = await resolveBvGroupMemberUsers(caller, ['id', 'userId', 'fullName']);
  assert.ok(scoped.some(user => user.id === members[1].id));
  assert.ok(!scoped.some(user => user.id === members[0].id));
});

test('an RGF/group mismatch or another department is rejected before any writes', async t => {
  const { caller, writes } = fixture(t, { groups: [{ ...gadadhara }, { ...krishna, bvslId: 'someone-else' }, { ...krishna, id: 'folk', segment: 'FOLK' }] });
  for (const groupId of [krishna.id, 'folk']) {
    await assert.rejects(assignBvRole.execute({ input: { userId: caller.id, role: 'SUB_FACILITATOR', parentId: rgf.id, rgsfGroupId: groupId }, context: context({ id: 'super', role: 'SUPER_ADMIN', isBvSuperAdmin: true }) } as never), /selected RGF|active Reading Group/);
  }
  assert.deepEqual(writes, []);
});

test('Richa sees only Gadadhara in group scope, dropdown, and member reports', async t => {
  const { caller } = fixture(t);
  assert.deepEqual((await resolveBvScopedGroups(caller)).map(g => g.id), [gadadhara.id]);
  const result = await getBvslGroups.execute({ input: { bvslId: caller.userId, viewRole: 'RGSF' }, context: context(caller) } as never);
  assert.deepEqual(result.groups.map((g: any) => g.id), [gadadhara.id]);
  const visible = await resolveBvGroupMemberUsers(caller, ['id', 'userId', 'fullName']);
  assert.ok(visible.some(user => user.id === members[0].id));
  assert.ok(!visible.some(user => user.id === members[1].id));
});

test('fresh and persisted hierarchy scopes do not inherit the reporting RGF groups', () => {
  const users = [rgf, rgsf, ...members];
  const groups = [gadadhara, krishna];
  const scope = resolveHierarchyScope(rgsf, users, groups, memberships)!;
  assert.ok(scope.has(members[0].id));
  assert.ok(!scope.has(members[1].id));
  const chains = buildReportingChains(users, groups, memberships);
  const stored = scopeFromReportingChains(rgsf, users, chains.reportingChain, chains.scopeKeys);
  assert.ok(stored?.has(members[0].id));
  assert.ok(!stored?.has(members[1].id));
});

test('attendance reads and both write endpoints reject Krishna without writes', async t => {
  const { caller, writes } = fixture(t);
  assert.equal(await callerCanRecordGroupAttendance(gadadhara, caller), true);
  assert.equal(await callerCanRecordGroupAttendance(krishna, caller), false);
  await assert.rejects(getAttendanceForDate.execute({ input: { groupId: krishna.id, date: '2026-10-24' }, context: context(caller) } as never), forbidden);
  await assert.rejects(conductBvSession.execute({ input: { bvslId: caller.userId, groupId: krishna.id, sessionDate: '2026-10-24', totalMeetingMinutes: 60, memberAttendance: [] }, context: context(caller) } as never), forbidden);
  await assert.rejects(markBvAttendance.execute({ input: { sessionId: 'krishna-session', userId: members[1].id, present: true }, context: context(caller) } as never), forbidden);
  assert.deepEqual(writes, []);
  const allowed = await getAttendanceForDate.execute({ input: { groupId: gadadhara.id, date: '2026-10-24' }, context: context(caller) } as never);
  assert.ok(allowed.members.some((member: any) => member.fullName === members[0].fullName));
});

test('stale profile or ordinary membership cannot add Krishna to an explicitly assigned RGSF', async t => {
  const { caller } = fixture(t, { caller: { bvGroupId: krishna.groupId, bvGroupName: krishna.groupName }, memberships: [{ id: 'richa-member', group: krishna.id, user: rgsf.id }] });
  assert.deepEqual((await resolveBvScopedGroups(caller)).map(g => g.id), [gadadhara.id]);
  assert.equal(await callerCanRecordGroupAttendance(krishna, caller), false);
});

test('explicit assignments to multiple groups remain accessible', async t => {
  const { caller } = fixture(t, { groups: [gadadhara, { ...krishna, rgsfId: rgsf.userId }] });
  assert.deepEqual((await resolveBvScopedGroups(caller)).map(g => g.id), [gadadhara.id, krishna.id]);
});

test('a reporting RGF alone grants no group access', async t => {
  const { caller } = fixture(t, { caller: { bvGroupId: '' }, groups: [{ ...gadadhara, subFacilitatorId: '' }, krishna] });
  assert.deepEqual(await resolveBvScopedGroups(caller), []);
  assert.equal(await callerCanRecordGroupAttendance(krishna, caller), false);
});

test('RGSF 1:1 report excludes the reporting RGF other group members', async t => {
  const { caller } = fixture(t);
  const result = await getBvslOneToOneData.execute({ input: { bvslId: caller.userId, weeksBack: 1 }, context: context(caller) } as never);
  assert.ok(JSON.stringify(result).includes(members[0].fullName));
  assert.ok(!JSON.stringify(result).includes(members[1].fullName));
});


test('RGSF cannot open a profile from an unassigned group through a direct request', async t => {
  const { caller } = fixture(t);
  await assert.rejects(getUserDetailForGuide.execute({ input: { userId: members[1].id }, context: context(caller) } as never), forbidden);
  const allowed = await getUserDetailForGuide.execute({ input: { userId: members[0].id }, context: context(caller) } as never);
  assert.ok(JSON.stringify(allowed).includes(members[0].fullName));
});


test('legacy profile assignment grants Gadadhara access without inheriting Krishna or an old membership', async t => {
  const { caller, groups, rows } = fixture(t, {
    groups: [{ ...gadadhara, subFacilitatorId: undefined }, krishna],
    memberships: [{ id: 'old-krishna-membership', group: krishna.id, user: rgsf.id }],
  });
  assert.deepEqual((await resolveBvScopedGroups(caller)).map(g => g.id), [gadadhara.id]);
  const scope = resolveHierarchyScope(caller, rows.Users, groups, rows.BvGroupMembers)!;
  assert.ok(scope.has(members[0].id));
  assert.ok(!scope.has(members[1].id));
  assert.equal(await callerCanRecordGroupAttendance(gadadhara, caller), true);
  assert.equal(await callerCanRecordGroupAttendance(krishna, caller), false);
  const allowed = await getAttendanceForDate.execute({ input: { groupId: gadadhara.id, date: '2026-10-24' }, context: context(caller) } as never);
  assert.ok(allowed.members.some((member: any) => member.fullName === members[0].fullName));
  const profile = await getUserDetailForGuide.execute({ input: { userId: members[0].id }, context: context(caller) } as never);
  assert.ok(JSON.stringify(profile).includes(members[0].fullName));
  await assert.rejects(getAttendanceForDate.execute({ input: { groupId: krishna.id, date: '2026-10-24' }, context: context(caller) } as never), forbidden);
});
