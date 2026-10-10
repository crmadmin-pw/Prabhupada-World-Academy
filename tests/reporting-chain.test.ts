import assert from 'node:assert/strict';
import test from 'node:test';
import { isUserInHierarchy, resolveHierarchyScope, buildReportingChains, scopeFromReportingChains } from '../src/lib/hierarchyUtils';

const member = (id: string, extra: any = {}) => ({ id, userId: `public-${id}`, email: `${id}@example.test`,
  fullName: id, role: 'User', segment: 'PW', status: 'Active', ...extra });
const admin = member('admin-a', { role: 'ADMIN', isBvAdmin: true });
const otherAdmin = member('admin-b', { role: 'ADMIN', isBvAdmin: true });
const superAdmin = member('super', { role: 'SUPER_ADMIN', isBvAdmin: true, isBvSuperAdmin: true });
const supervisor = member('supervisor-a', { isBvSupervisor: true, bvReportingAdminId: [' PUBLIC-ADMIN-A '] });
const rgf = member('rgf-a', { isBvsl: true, isBvFacilitator: true, bvReportingSupervisorId: supervisor.email });
const rgsf = member('rgsf-a', { isBvSubFacilitator: true, bvReportingFacilitatorId: [rgf.userId] });
const users = [admin, otherAdmin, superAdmin, supervisor, rgf, rgsf,
  member('direct-a', { guide: admin.id }), member('group-member-a', { authUid: 'auth-member-a' }),
  member('mentor-a', { isSadhanaMentor: true, guide: admin.email }),
  member('pending-a', { status: 'Pending Approval', selectedGuideId: admin.userId }),
  member('member-b', { guide: otherAdmin.id }), member('pending-b', { status: 'Pending Approval', guide: otherAdmin.id }),
  member('rgf-b', { isBvsl: true, isBvFacilitator: true, bvReportingAdminId: otherAdmin.id }),
  member('mentor-b', { isSadhanaMentor: true, guide: otherAdmin.id }),
  member('unassigned'), member('stale-guide', { guide: admin.id, bvReportingAdminId: otherAdmin.id }),
  member('folk-outsider', { segment: 'FOLK', guide: admin.id }),
];
const groups = [
  { id: 'group-a', groupId: 'public-group-a', groupName: 'Group A', segment: 'PW', isActive: true, bvslLeader: rgf.userId },
  { id: 'group-b', groupId: 'public-group-b', groupName: 'Group B', segment: 'PW', isActive: true, bvslLeader: 'public-rgf-b', guide: otherAdmin.id },
];
const memberships = [
  { id: 'membership-a', group: ['public-group-a'], memberId: 'auth-member-a' },
  { id: 'membership-b', group: 'group-b', user: 'member-b' },
];
const sorted = (values: Iterable<string>) => [...values].sort();

function sameScope(actual: Set<string> | null, expected: Set<string> | null) {
  if (expected === null || actual === null) {
    assert.equal(actual, expected);
    return;
  }
  assert.deepEqual(sorted(actual), sorted(expected));
}

test('stored reporting chains match the hierarchy resolver', () => {
  const built = buildReportingChains(users, groups, memberships);
  for (const caller of [admin, otherAdmin, supervisor, rgf, rgsf, users.find(user => user.id === 'mentor-a')]) {
    const expected = resolveHierarchyScope(caller, users, groups, memberships);
    const actual = scopeFromReportingChains(caller, users, built.reportingChain, built.scopeKeys);
    sameScope(actual, expected);
    assert.deepEqual(
      sorted(users.filter(user => isUserInHierarchy(user, actual)).map(user => user.id)),
      sorted(users.filter(user => isUserInHierarchy(user, expected)).map(user => user.id)),
    );
  }
  const adminScope = scopeFromReportingChains(admin, users, built.reportingChain, built.scopeKeys);
  assert.equal(adminScope?.has('membership-a'), false);
  assert.equal(adminScope?.has('auth-member-a'), true);
  assert.equal(scopeFromReportingChains(superAdmin, users, built.reportingChain, built.scopeKeys), null);

  const guide = member('folk-guide', { role: 'GUIDE', segment: 'FOLK' });
  const folkMember = member('folk-member', { segment: 'FOLK', guide: ['guide-table-id'] });
  const folkUsers = [guide, folkMember];
  const folkGuides = [{ id: 'guide-table-id', email: guide.email }];
  const folkBuilt = buildReportingChains(folkUsers, [], [], folkGuides, []);
  sameScope(
    scopeFromReportingChains(guide, folkUsers, folkBuilt.reportingChain, folkBuilt.scopeKeys),
    resolveHierarchyScope(guide, folkUsers, [], [], folkGuides),
  );

  const inactive = [{ ...memberships[0], isActive: false }];
  const inactiveBuilt = buildReportingChains(users, groups, inactive);
  const inactiveScope = scopeFromReportingChains(admin, users, inactiveBuilt.reportingChain, inactiveBuilt.scopeKeys);
  sameScope(inactiveScope, resolveHierarchyScope(admin, users, groups, inactive));
  assert.equal(inactiveScope?.has('group-member-a'), false);
});
