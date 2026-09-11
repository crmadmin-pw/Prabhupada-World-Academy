import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { resolveHierarchyScope, isUserInHierarchy, getScopedHierarchyUserIds } from '../src/lib/hierarchyUtils';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { resolveBvScopedGroups } from '../src/lib/bvGroupMemberScope';
import getGuides from '../src/api/getGuides';
import getGuideUsers from '../src/api/getGuideUsers';
import getMissingSadhanaReport from '../src/api/getMissingSadhanaReport';
import getGuideDetailedReport from '../src/api/getGuideDetailedReport';
import getSadhanaStats from '../src/api/getSadhanaStats';
import getSadhanaLeaderboard from '../src/api/getSadhanaLeaderboard';
import getActiveSadhanaMentors from '../src/api/getActiveSadhanaMentors';
import getPendingApprovals from '../src/api/getPendingApprovals';
import getUserDetailForGuide from '../src/api/getUserDetailForGuide';
import getOneToOneContext from '../src/api/getOneToOneContext';
import getBvSessionMatrix from '../src/api/getBvSessionMatrix';
import getBvStats from '../src/api/getBvStats';
import getBvPreachingReport from '../src/api/getBvPreachingReport';
import getGuideGroupStats from '../src/api/getGuideGroupStats';
import getSuperGuideAttendanceReport from '../src/api/getSuperGuideAttendanceReport';
import getPushSubscriptionStats from '../src/api/getPushSubscriptionStats';
import getSuperBvAnalytics from '../src/api/getSuperBvAnalytics';
import getAllBvGroupsAdmin from '../src/api/getAllBvGroupsAdmin';
import getAllResidenciesWithStats from '../src/api/getAllResidenciesWithStats';
import { getMeetingViewer, isMeetingVisibleToViewer } from '../src/lib/meetingAccess';

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
const ownIds = ['admin-a', 'supervisor-a', 'rgf-a', 'rgsf-a', 'direct-a', 'group-member-a', 'mentor-a', 'pending-a'];
const ownActive = ownIds.filter(id => id !== 'pending-a');
const date = '2026-09-08';
const fixture: Record<string, any[]> = { Users: users, BvGroups: groups, BvGroupMembers: memberships,
  SadhanaEntries: ['direct-a', 'member-b', 'rgf-a', 'rgf-b'].map(id => ({ id: `entry-${id}`, user: id, entryDate: date, scorePercent: 80, totalScore: 16, maxScore: 20 })),
  BvAttendance: [{ id: 'attendance-a', user: 'auth-member-a', group: 'group-a', attendanceDate: date, present: true },
    { id: 'attendance-b', user: 'member-b', group: 'group-b', attendanceDate: date, present: true }],
  BvslPreachingEntries: ['rgf-a', 'rgf-b'].map(id => ({ id: `preaching-${id}`, user: id, entryDate: date, totalPreachingMinutes: 30 })),
  PushSubscriptions: [{ id: 'push-a', user: 'direct-a' }, { id: 'push-b', user: 'member-b' }],
};

// Fully mocked reads: these tests cannot write to or query production Firebase.
function mockDatabase(t: any) {
  serverCacheInvalidate();
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.includes(item));
      return (!value.gte || actual >= value.gte) && (!value.lte || actual <= value.lte);
    }
    return [actual].flat().includes(value);
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      const offset = options.offset || 0;
      const page = records.slice(offset, offset + (options.limit || 2000));
      return { records: page.map(record => options.fields ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, record[key]])) : { ...record }), hasMore: offset + page.length < records.length };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
}
const call = (endpoint: any, input: any, caller: any = admin) => endpoint.execute({ input,
  context: { user: { ...caller, capabilities: ['users.assigned.read', 'meetings.manage'] } } });
const sorted = (values: string[]) => [...values].sort();

test('hierarchy excludes other admins, unassigned users, stale guide links and other departments', () => {
  const scope = resolveHierarchyScope(admin, users, groups, memberships);
  assert.deepEqual(sorted(users.filter(u => isUserInHierarchy(u, scope)).map(u => u.id)), sorted(ownIds));
  assert.equal(scope?.has('membership-a'), false);
  assert.equal(scope?.has('auth-member-a'), true);
  assert.equal(resolveHierarchyScope(superAdmin, users), null);
  const guide = member('folk-guide', { role: 'GUIDE', segment: 'FOLK' });
  const folkMember = member('folk-member', { segment: 'FOLK', guide: ['guide-table-id'] });
  assert.ok(isUserInHierarchy(folkMember, resolveHierarchyScope(guide, [guide, folkMember], [], [], [{ id: 'guide-table-id', email: guide.email }])));
  const inactive = resolveHierarchyScope(admin, users, groups, [{ ...memberships[0], isActive: false }]);
  assert.equal(inactive?.has('group-member-a'), false);
});

test('admin dropdowns, member directory and meeting invitees are scoped after caching', async t => {
  mockDatabase(t);
  for (const caller of [admin, otherAdmin, superAdmin, admin]) {
    const result = await call(getGuides, { segment: 'PW' }, caller);
    assert.deepEqual(sorted(result.guides.map((g: any) => g.guideId)), sorted(caller === superAdmin ? [admin.userId, otherAdmin.userId, superAdmin.userId] : [caller.userId]));
  }
  for (const guideId of ['ALL', otherAdmin.id, admin.userId]) {
    const result = await call(getGuideUsers, { guideId, minimal: true, forMeetingInvitees: true });
    assert.deepEqual(sorted(result.users.map((u: any) => u.userId)), sorted(ownIds));
  }
  const mentors = await call(getActiveSadhanaMentors, { segment: 'PW' });
  assert.deepEqual(mentors.map((u: any) => u.fullName), ['mentor-a']);
  const allMentors = await call(getActiveSadhanaMentors, { segment: 'PW' }, superAdmin);
  assert.deepEqual(sorted(allMentors.map((u: any) => u.fullName)), ['mentor-a', 'mentor-b']);
});

test('Sadhana report rows, stats, leaderboard and guide filters exclude foreign users', async t => {
  mockDatabase(t);
  for (const guideId of ['ALL', otherAdmin.id]) {
    const input = { guideId, segment: 'PW', date, reportType: 'daily', startDate: date, endDate: date };
    const missing = await call(getMissingSadhanaReport, input);
    assert.deepEqual(sorted(missing.users.map((u: any) => u.id)), sorted(ownActive.filter(id => id !== admin.id)));
    assert.equal(missing.stats.totalUsers, ownActive.length - 1);
    assert.deepEqual(missing.guides.map((g: any) => g.id), [admin.userId]);
    const report = await call(getGuideDetailedReport, input);
    assert.deepEqual(sorted(report.users.map((u: any) => u.id)), sorted(ownActive.filter(id => id !== admin.id)));
    assert.deepEqual(report.availableGuides.map((g: any) => g.guideId), [admin.userId]);
    const stats = await call(getSadhanaStats, input);
    assert.ok(stats.userSummaries.every((u: any) => ownActive.includes(u.userId || u.id) || ownActive.includes(u.fullName)));
    const leaderboard = await call(getSadhanaLeaderboard, input);
    assert.ok(!JSON.stringify(leaderboard).includes('member-b'));
  }
  const all = await call(getMissingSadhanaReport, { guideId: 'ALL', segment: 'PW', startDate: date, endDate: date }, superAdmin);
  assert.ok(all.users.some((u: any) => u.id === 'member-b'));
  assert.ok(all.users.some((u: any) => u.id === 'unassigned'));
  for (const guideId of [admin.id, admin.userId, admin.email]) {
    const input = { guideId, segment: 'PW', date, reportType: 'daily', startDate: date, endDate: date };
    const selected = await call(getMissingSadhanaReport, input, superAdmin);
    assert.deepEqual(sorted(selected.users.map((u: any) => u.id)), sorted(ownActive.filter(id => id !== admin.id)));
    const report = await call(getGuideDetailedReport, input, superAdmin);
    assert.ok(report.users.some((u: any) => u.id === 'group-member-a'));
    assert.ok(!report.users.some((u: any) => u.id === 'member-b'));
  }
});

test('BV reports and dropdowns include indirect groups and reject a forged group selection', async t => {
  mockDatabase(t);
  for (const guideId of ['ALL', otherAdmin.id]) {
    const input = { guideId, segment: 'PW', date, reportType: 'daily', startDate: date, endDate: date };
    const matrix = await call(getBvSessionMatrix, input);
    assert.deepEqual(matrix.groups.map((g: any) => g.id), ['group-a']);
    assert.deepEqual(matrix.members.map((u: any) => u.fullName), ['group-member-a']);
    const preaching = await call(getBvPreachingReport, input);
    assert.deepEqual(preaching.bvsls.map((u: any) => u.fullName), ['rgf-a']);
    const stats = await call(getBvStats, input);
    assert.deepEqual(stats.userSummaries.map((u: any) => u.fullName), ['rgf-a']);
    const groupStats = await call(getGuideGroupStats, input);
    assert.deepEqual(groupStats.groups.map((g: any) => g.groupName), ['Group A']);
  }
  await assert.rejects(resolveBvScopedGroups(admin, { groupId: 'group-b', segment: 'PW' }), /not assigned/);
  assert.deepEqual((await resolveBvScopedGroups(superAdmin, { segment: 'PW' })).map(g => g.id), ['group-a', 'group-b']);
});

test('counts and profile drilldowns cannot leak another admin member', async t => {
  mockDatabase(t);
  const approvals = await call(getPendingApprovals, { guideId: 'ALL' });
  assert.ok(!JSON.stringify(approvals).includes('pending-b'));
  assert.ok(JSON.stringify(approvals).includes('pending-a'));
  const subscriptions = await call(getPushSubscriptionStats, { segment: 'PW' });
  assert.equal(subscriptions.totalSubscriptions, 1);
  assert.deepEqual(subscriptions.subscribers.map((u: any) => u.name), ['direct-a']);
  const attendance = await call(getSuperGuideAttendanceReport, { segment: 'PW' });
  assert.ok(JSON.stringify(attendance).includes('group-member-a'));
  assert.ok(!JSON.stringify(attendance).includes('member-b'));
  await assert.rejects(call(getUserDetailForGuide, { userId: 'member-b' }), /not assigned/);
  await assert.rejects(call(getOneToOneContext, { userId: 'member-b' }), /not assigned/);
});

test('preaching analytics aggregate only the current admin hierarchy and super admins retain all guides', async t => {
  mockDatabase(t);
  const input = { date, reportType: 'daily' };
  const own = await call(getSuperBvAnalytics, input);
  assert.equal(own.overall.bvslCount, 1);
  assert.ok(!JSON.stringify(own).includes('rgf-b'));
  assert.deepEqual(own.centers.map((center: any) => center.guideName), [admin.fullName]);
  const all = await call(getSuperBvAnalytics, input, superAdmin);
  assert.equal(all.overall.bvslCount, 2);
  assert.ok(JSON.stringify(all).includes('rgf-b'));
  const management = await call(getAllBvGroupsAdmin, { guideId: otherAdmin.id });
  assert.deepEqual(management.groups.map((group: any) => group.groupName), ['Group A']);
});

test('FOLK administrators cannot read another guide users or residency statistics', async t => {
  const folkA = member('folk-a', { role: 'GUIDE', segment: 'FOLK', folkResidencies: ['res-a'] });
  const folkB = member('folk-b', { role: 'GUIDE', segment: 'FOLK', folkResidencies: ['res-b'] });
  const folkUsers = [folkA, folkB, member('resident-a', { segment: 'FOLK', guide: folkA.id, residency: 'res-a', residencyApproved: true }),
    member('resident-b', { segment: 'FOLK', guide: folkB.id, residency: 'res-b', residencyApproved: true })];
  const previousUsers = fixture.Users;
  fixture.Users = folkUsers;
  fixture.Guides = [folkA, folkB].map(user => ({ id: user.id, email: user.email, fullName: user.fullName, isActive: true, folkResidencies: user.folkResidencies }));
  fixture.FolkResidencies = [{ id: 'res-a', residencyName: 'Residence A', guideIds: [folkA.id], isActive: true }, { id: 'res-b', residencyName: 'Residence B', guideIds: [folkB.id], isActive: true }];
  t.after(() => { fixture.Users = previousUsers; delete fixture.Guides; delete fixture.FolkResidencies; });
  mockDatabase(t);
  const own = await call(getMissingSadhanaReport, { guideId: 'ALL', segment: 'FOLK', startDate: date, endDate: date }, folkA);
  assert.deepEqual(own.users.map((u: any) => u.id), ['resident-a']);
  const ownStats = await call(getAllResidenciesWithStats, {}, folkA);
  assert.equal(ownStats.length, 1);
  assert.ok(!JSON.stringify(ownStats).includes('Residence B'));
  const all = await call(getMissingSadhanaReport, { guideId: 'ALL', segment: 'FOLK', startDate: date, endDate: date }, { ...folkA, role: 'SUPER_GUIDE' });
  assert.deepEqual(sorted(all.users.map((u: any) => u.id)), ['resident-a', 'resident-b']);
});

test('regular FOLK Guide missing-Sadhana report includes legacy members without segment', async t => {
  const folkGuide = member('folk-guide-legacy', { role: 'GUIDE', segment: 'FOLK', folkResidencies: ['res-a'] });
  const folkMember = member('folk-member-legacy', { segment: undefined, guide: folkGuide.id });
  const previousUsers = fixture.Users;
  const previousGuides = fixture.Guides;
  fixture.Users = [folkGuide, folkMember];
  fixture.Guides = [{ id: folkGuide.id, email: folkGuide.email, fullName: folkGuide.fullName, folkResidencies: ['res-a'] }];
  t.after(() => { fixture.Users = previousUsers; fixture.Guides = previousGuides; });
  mockDatabase(t);
  const result = await call(getMissingSadhanaReport, {
    guideId: 'ALL', segment: 'FOLK', startDate: date, endDate: date,
  }, folkGuide);
  assert.deepEqual(result.users.map((u: any) => u.id), ['folk-member-legacy']);
  assert.equal(result.stats.totalUsers, 1);
});

test('hierarchy lookup failures never grant full access', async t => {
  mockDatabase(t);
  t.mock.method(sdk.Users, 'findAll', async () => { throw new Error('database unavailable'); });
  await assert.rejects(getScopedHierarchyUserIds(admin), /database unavailable/);
  await assert.rejects(call(getGuideUsers, { guideId: 'ALL', minimal: true }), /database unavailable/);
});

test('ordinary admins see meetings they created or were invited to; super admins can view all', () => {
  const viewer = getMeetingViewer(admin, admin);
  assert.equal(viewer.canViewAllMeetings, false);
  assert.equal(isMeetingVisibleToViewer({ createdByUserId: admin.userId }, viewer), true);
  assert.equal(isMeetingVisibleToViewer({ inviteeUserIds: [admin.id] }, viewer), true);
  assert.equal(isMeetingVisibleToViewer({ createdByUserId: otherAdmin.id, inviteeUserIds: [otherAdmin.id] }, viewer), false);
  assert.equal(getMeetingViewer(superAdmin, superAdmin).canViewAllMeetings, true);
});
