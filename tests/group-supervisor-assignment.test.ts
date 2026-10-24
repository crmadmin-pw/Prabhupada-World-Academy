import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import updateBvGroup from '../src/api/updateBvGroup';
import getAllBvGroupsAdmin from '../src/api/getAllBvGroupsAdmin';
import getBvSupervisorReport from '../src/api/getBvSupervisorReport';
import { resolveBvScopedGroups } from '../src/lib/bvGroupMemberScope';
import { resolveHierarchyScope, buildReportingChains, scopeFromReportingChains } from '../src/lib/hierarchyUtils';
import { serverCacheInvalidate } from '../src/lib/serverCache';

function memory(t: any, stores: Record<string, any[]>) {
  serverCacheInvalidate();
  const matches = (row: any, filters: any) => Object.entries(filters || {}).every(([key, value]: any) =>
    value && typeof value === 'object' && value.in ? value.in.includes(row[key]) : row[key] === value);
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const rows = stores[name] ||= [];
    t.mock.method(table, 'findAll', async (q: any = {}) => ({ records: rows.filter(row => matches(row, q.filters)), hasMore: false }));
    t.mock.method(table, 'findOne', async (q: any = {}) => rows.find(row => q.id ? row.id === q.id : matches(row, q.filters)) || null);
    t.mock.method(table, 'update', async ({ id, record }: any) => {
      const row = rows.find(row => row.id === id);
      assert.ok(row, `missing ${name}/${id}`);
      Object.assign(row, record);
      return row;
    });
  }
}

for (const segment of ['FOLK', 'PW']) {
  test(`${segment}: explicit assignments control groups and per-group RGF parentage`, async t => {
    const admin = { id: 'admin', userId: 'ADMIN', role: segment === 'FOLK' ? 'GUIDE' : 'ADMIN', segment, isBvAdmin: true, status: 'Active' };
    const supervisor = { id: 'sup', userId: 'SUP', fullName: 'First Supervisor', role: 'User', segment, isBvSupervisor: true, status: 'Active', bvSupervisedGroupIds: ['two'] };
    const second = { ...supervisor, id: 'second', userId: 'SECOND', fullName: 'Second Supervisor' };
    const rgf = { id: 'rgf', userId: 'RGF', fullName: 'Shared RGF', role: 'BVSL', segment, isBvFacilitator: true, status: 'Active', bvReportingSupervisorId: supervisor.id };
    const member = { id: 'member', userId: 'MEMBER', fullName: 'Member One', segment, status: 'Active', bvReportingFacilitatorId: rgf.id };
    const outside = { ...member, id: 'outside', userId: 'OUTSIDE', fullName: 'Member Two' };
    const groups: any[] = [
      { id: 'one', groupId: 'ONE', groupName: 'Group One', bvslId: rgf.userId, guide: admin.id, segment, isActive: true },
      { id: 'two', groupId: 'TWO', groupName: 'Group Two', bvslId: rgf.userId, guide: admin.id, segment, isActive: true },
      { id: 'peer', groupId: 'PEER', groupName: 'Peer Admin Group', guide: 'another-admin', segment, isActive: true },
      { id: 'foreign', groupId: 'FOREIGN', groupName: 'Other Department', bvslId: rgf.userId, segment: segment === 'PW' ? 'FOLK' : 'PW', isActive: true },
    ];
    const foreignSupervisor = { ...supervisor, id: 'foreign-supervisor', userId: 'FOREIGN-SUP', segment: segment === 'PW' ? 'FOLK' : 'PW' };
    const users = [admin, supervisor, second, rgf, member, outside, foreignSupervisor];
    const memberships = [{ id: 'm1', user: member.id, group: 'one' }, { id: 'm2', user: outside.id, group: 'two' }];
    memory(t, { Users: users, BvGroups: groups, BvGroupMembers: memberships });
    assert.deepEqual(await resolveBvScopedGroups(supervisor), []);
    const expectedAdminGroups = segment === 'PW' ? ['one', 'two', 'peer'] : ['one', 'two'];
    assert.deepEqual((await resolveBvScopedGroups(admin)).map(g => g.id), expectedAdminGroups);
    const listed = await getAllBvGroupsAdmin.execute({
      input: { guideId: 'unrelated-admin', departmentWide: true, segment },
      context: { user: admin },
    } as never);
    assert.deepEqual(listed.groups.map(g => g.groupId).sort(), expectedAdminGroups.map(id => id.toUpperCase()).sort());
    await assert.rejects(updateBvGroup.execute({ input: { groupId: 'one', supervisorId: 'SUP' }, context: { user: supervisor } } as never), /Only an Admin/);
    await assert.rejects(updateBvGroup.execute({ input: { groupId: 'foreign', supervisorId: 'SUP' }, context: { user: admin } } as never), /department/);
    await assert.rejects(updateBvGroup.execute({ input: { groupId: 'one', supervisorId: 'FOREIGN-SUP' }, context: { user: admin } } as never), /department/);
    await assert.rejects(updateBvGroup.execute({ input: { groupId: 'one', supervisorId: rgf.id }, context: { user: admin } } as never), /active supervisor/);
    assert.equal(groups[0].supervisorId, undefined);
    for (const [groupId, supervisorId] of [['one', 'SUP'], ['two', 'SECOND']]) {
      await updateBvGroup.execute({ input: { groupId, supervisorId }, context: { user: admin } } as never);
    }
    assert.equal(groups[0].supervisorId, supervisor.id);
    assert.deepEqual((await resolveBvScopedGroups(supervisor, { supervisionOnly: true })).map(g => g.id), ['one']);
    assert.deepEqual((await resolveBvScopedGroups(second)).map(g => g.id), ['two']);
    await assert.rejects(resolveBvScopedGroups(supervisor, { groupId: 'two' }), /not assigned/);
    const scope = resolveHierarchyScope(supervisor, users, groups, memberships)!;
    assert.ok(scope.has(rgf.id));
    assert.ok(scope.has(member.id));
    assert.equal(scope.has(outside.id), false);
    const built = buildReportingChains(users, groups, memberships);
    assert.deepEqual(scopeFromReportingChains(supervisor, users, built.reportingChain, built.scopeKeys), scope);
    await updateBvGroup.execute({ input: { groupId: 'one', supervisorId: 'SECOND' }, context: { user: admin } } as never);
    assert.deepEqual(await resolveBvScopedGroups(supervisor), []);
    assert.equal(resolveHierarchyScope(supervisor, users, groups, memberships)!.has(rgf.id), false);
    await updateBvGroup.execute({ input: { groupId: 'one', supervisorId: '' }, context: { user: admin } } as never);
    const report = await getBvSupervisorReport.execute({ input: { segment }, context: { user: { ...admin, isBvAdmin: true } } } as never);
    assert.deepEqual(report.groups.find(g => g.id === 'one')?.supervisorNames, []);
    assert.deepEqual(report.groups.find(g => g.id === 'two')?.supervisorNames, ['Second Supervisor']);
    // Being an RGF grants personal access, but does not mark them as supervisor.
    groups[0].bvslId = supervisor.userId;
    assert.deepEqual(await resolveBvScopedGroups(supervisor, { supervisionOnly: true }), []);
    assert.deepEqual((await resolveBvScopedGroups(supervisor)).map(g => g.id), ['one']);
  });
}
