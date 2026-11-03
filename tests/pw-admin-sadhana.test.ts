import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { withRequestQueries } from '../src/lib/requestQueries';
import { daysAgo, getTodayIST } from '../src/lib/streakUtils';
import { canFillPersonalSadhana, canViewPwSadhana } from '../src/lib/pwSadhanaPrivacy';
import { canSetPwTargets, pwTargetSource, resolvePwTargetsForUser } from '../src/lib/pwTargetResolver';
import { getUserDashboardRedirect } from '../src/lib/userDashboardRoutes';
import setTargets from '../src/api/setPwSadhanaTargets';
import listTargets from '../src/api/listPwStaffTargets';
import form from '../src/api/getSadhanaFormData';
import submit from '../src/api/submitSadhana';
import report from '../src/api/getGuideDetailedReport';
import stats from '../src/api/getSadhanaStats';
import leaderboard from '../src/api/getSadhanaLeaderboard';
import missing from '../src/api/getMissingSadhanaReport';
import detail from '../src/api/getEntryDetail';
import progress from '../src/api/getUserProgressStats';
import contextReport from '../src/api/getOneToOneContext';
import profileReport from '../src/api/getUserDetailForGuide';
import statusReport from '../src/api/sadhanaStatus';
import attendance from '../src/api/recordBvAttendanceMinutes';
import recalculate from '../src/api/recalculateScoresForDate';
import roster from '../src/api/getBvslMembers';
import groupMonitor from '../src/api/getBvGroupSadhanaMonitor';
import groupMissing from '../src/api/getBvMissingSadhana';

const base = { status: 'Active', segment: 'PW', isPrabhupadaWorldUser: true, role: 'User', ashrayLevel: 'Sevak' };
const superAdmin = { ...base, id: 'super', userId: 'SUPER', fullName: 'Super One', email: 'super@example.test', isBvSuperAdmin: true, isBvAdmin: true };
const peerSuper = { ...superAdmin, id: 'super-two', userId: 'SUPER-TWO', fullName: 'Super Two', email: 'super-two@example.test' };
const admin = { ...base, id: 'admin', userId: 'ADMIN', fullName: 'PW Admin', email: 'admin@example.test', firebaseUid: 'admin-auth', isBvAdmin: true, isBvFacilitator: true, isBvsl: true };
const peerAdmin = { ...admin, id: 'peer-admin', userId: 'PEER-ADMIN', fullName: 'Peer Admin', email: 'peer@example.test', firebaseUid: 'peer-auth' };
const rgf = { ...base, id: 'rgf', userId: 'RGF', fullName: 'Group RGF', email: 'rgf@example.test', isBvFacilitator: true, isBvsl: true };
const member = { ...base, id: 'member', userId: 'MEMBER', fullName: 'PW Member', email: 'member@example.test', bvReportingFacilitatorId: rgf.userId };
const folk = { ...base, id: 'folk', userId: 'FOLK', fullName: 'FOLK Admin', email: 'folk@example.test', role: 'Super Guide', segment: 'FOLK', isBvSuperAdmin: true };
const date = daysAgo(getTodayIST(), 1);
const targets = { wakeUp: '04:30', sleep: '22:00', chanting: 16, readingMin: 30, hearingMin: 45, sevaMin: 60, setByRole: 'super_admin', setBy: superAdmin.id };
const denied = (error: any) => error?.code === 'FORBIDDEN';

function database(t: any) {
  void serverCacheInvalidate(undefined, { publish: false });
  const users = [superAdmin, peerSuper, { ...admin, pwTargets: { ...targets } }, peerAdmin, rgf, member, folk].map(user => ({ ...user }));
  const fixtures: Record<string, any[]> = {
    Users: users,
    BvGroups: [{ id: 'group', groupId: 'GROUP', groupName: 'Test Group', segment: 'PW', isActive: true, bvslLeader: rgf.id, bvslId: rgf.userId }],
    BvGroupMembers: users.filter(user => user.segment === 'PW').map(user => ({ id: `membership-${user.id}`, user: user.id, userId: user.userId, group: 'group', groupId: 'GROUP' })),
    SadhanaEntries: users.map(user => ({
      id: `entry-${user.id}`, entryId: `ENTRY-${user.id}`, user: user.firebaseUid || user.id, entryDate: date,
      submittedAt: `${date}T15:00:00Z`, templateMode: 'NR_TEMPLATE', totalScore: 20, maxScore: 20, scorePercent: 100,
      fieldValuesJson: JSON.stringify({ chanting: 16, reading: 30, _meta: { pwVersion: 2, scorePercent: 100, pwTargets: targets, pwTargetSource: 'super_admin', pwFields: { chanting: 16, reading: 8 } } }),
    })),
  };
  const writes: Array<{ table: string; method: string; value: any }> = [];
  // All reads and writes are mocked, including period-summary refreshes.
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      const rows = (fixtures[name] || []).filter(row => (!options.id || row.id === options.id) &&
        Object.entries(options.filters || {}).every(([field, value]: any) => {
          const actual = row[field];
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.in) return [actual].flat().some(item => value.in.includes(item));
            return (!value.gte || actual >= value.gte) && (!value.lte || actual <= value.lte) && (!value.lt || actual < value.lt);
          }
          return [actual].flat().includes(value);
        }));
      const offset = options.offset || 0;
      const page = rows.slice(offset, offset + (options.limit || 2000));
      return { records: page.map(row => options.fields ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, row[key]])) : { ...row }), hasMore: offset + page.length < rows.length };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0] || null);
    for (const method of ['create', 'update', 'delete']) {
      t.mock.method(table, method, async (value: any) => {
        writes.push({ table: name, method, value });
        fixtures[name] ||= [];
        const id = value.id || value.record?.id || `${name}-${fixtures[name].length}`;
        const row = fixtures[name].find(row => row.id === id);
        if (method === 'delete') fixtures[name] = fixtures[name].filter(row => row.id !== id);
        else if (row) Object.assign(row, value.record);
        else fixtures[name].push({ id, ...value.record });
        return fixtures[name].find(row => row.id === id) || { id };
      });
    }
  }
  return { fixtures, writes };
}

function run(endpoint: any, user: any, input: any = {}): Promise<any> {
  return withHierarchyDatabase(null, async () => (await withRequestQueries(() => endpoint.execute({ input, context: { user: { uid: user.firebaseUid || user.id, ...user } } }))).result);
}

test('PW admin participation and private visibility honor the highest role, including dual-role admins', () => {
  assert.equal(canFillPersonalSadhana(admin), true);
  assert.equal(canFillPersonalSadhana(superAdmin), false);
  assert.equal(canFillPersonalSadhana(folk), false);
  assert.equal(pwTargetSource(admin, true), 'super_admin');
  for (const actor of [admin, peerAdmin, rgf, { ...rgf, isSadhanaMentor: true }, folk]) {
    assert.equal(canSetPwTargets(actor, admin, true, true).allowed, false);
    assert.equal(canViewPwSadhana(actor, admin, false), false);
  }
  assert.equal(canSetPwTargets(superAdmin, admin).allowed, true);
  assert.equal(canSetPwTargets(superAdmin, peerSuper).allowed, false);
  assert.equal(canViewPwSadhana(superAdmin, admin, false), true);
  assert.equal(canViewPwSadhana(admin, admin), true);
  assert.equal(canViewPwSadhana({ ...admin, id: 'admin-auth', userId: undefined }, admin), true);
  assert.equal(canViewPwSadhana(superAdmin, peerSuper), false);
  assert.equal(canViewPwSadhana(peerSuper, superAdmin), false);
  assert.equal(canViewPwSadhana(admin, { ...peerAdmin, segment: 'FOLK' }), true);
  assert.equal(getUserDashboardRedirect(admin, { pathname: '/user/pw-dashboard', search: '', hash: '' }), null);
  assert.equal(getUserDashboardRedirect(superAdmin, { pathname: '/user/pw-dashboard', search: '', hash: '' }), '/pw-admin/dashboard');
  assert.equal(getUserDashboardRedirect(folk, { pathname: '/user/folk-dashboard', search: '', hash: '' }), '/folk-guide/dashboard');
});

test('only PW super admins list and save all six admin targets, without using old lower-role targets', async t => {
  const { fixtures, writes } = database(t);
  const saved = await run(setTargets, superAdmin, { userId: admin.userId, wakeUp: '05:00', sleep: '21:30', chantingRounds: 12, readingMinutes: 20, hearingMinutes: 30, sevaMinutes: 40 });
  assert.equal(saved.source, 'super_admin');
  assert.equal(saved.pwTargets.setBy, superAdmin.id);
  const resolved = await resolvePwTargetsForUser(fixtures.Users.find(user => user.id === admin.id));
  assert.deepEqual(resolved.targets, { wakeUp: '05:00', sleep: '21:30', chanting: 12, readingMin: 20, hearingMin: 30, sevaMin: 40 });
  for (const actor of [admin, peerAdmin, rgf, folk]) {
    await assert.rejects(run(setTargets, actor, { userId: admin.userId, chantingRounds: 8 }), denied);
  }
  await assert.rejects(run(setTargets, superAdmin, { userId: peerSuper.userId, chantingRounds: 8 }), denied);
  assert.equal(writes.filter(write => write.table === 'Users').length, 1);
  const superList = await run(listTargets, superAdmin);
  assert.deepEqual(superList.members.filter((user: any) => user.roleLabel === 'Admin').map((user: any) => user.userId).sort(), ['ADMIN', 'PEER-ADMIN']);
  assert.ok(!superList.members.some((user: any) => user.userId === peerSuper.userId || user.userId === superAdmin.userId || user.userId === folk.userId));
  const peerList = await run(listTargets, admin);
  assert.ok(peerList.members.every((user: any) => user.roleLabel !== 'Admin'));
  const old = await resolvePwTargetsForUser({ ...admin, pwTargets: { ...targets, setByRole: 'admin' }, pwChantingTarget: 64, pwReadingTarget: 60 });
  assert.equal(old.targets.chanting, null);
  assert.equal(old.targets.readingMin, null);
});

test('admins load the PW form and save a self-owned report using super admin targets; super admins cannot fill', async t => {
  const { fixtures, writes } = database(t);
  const loaded = await run(form, admin, { date, userId: peerAdmin.userId });
  assert.equal(loaded.isPw, true);
  assert.equal(loaded.pwTargetSource, 'super_admin');
  assert.equal(loaded.pwTargets.chanting, 16);
  assert.match(loaded.fields.find((field: any) => field.fieldKey === 'chanting').helpText, /super admin/);
  // Update an existing day to avoid generating a sequence ID in this test.
  await run(submit, admin, { userId: peerAdmin.userId, entryDate: date, totalScore: 0, templateMode: 'NR_TEMPLATE', fieldValues: { chanting: 8, reading: 30 } });
  const saved = writes.find(write => write.table === 'SadhanaEntries' && write.method === 'update');
  assert.equal(saved?.value.record.user, admin.id);
  const meta = JSON.parse(saved!.value.record.fieldValuesJson)._meta;
  assert.equal(meta.pwTargetSource, 'super_admin');
  assert.equal(meta.pwTargets.chanting, 16);
  const count = writes.length;
  for (const user of [superAdmin, peerSuper]) {
    await assert.rejects(run(form, user, { date }), denied);
    await assert.rejects(run(submit, user, { userId: admin.id, entryDate: date, totalScore: 0, fieldValues: {} }), denied);
  }
  assert.equal(writes.length, count);
  assert.ok(fixtures.Users.find(user => user.id === admin.id));
});

test('super admin reports include admins and exclude every super admin; admin reports exclude peer admins', async t => {
  database(t);
  const input = { guideId: 'ALL', segment: 'PW', date, reportType: 'daily', startDate: date, endDate: date };
  const superReport = await run(report, superAdmin, input);
  assert.ok(superReport.users.some((user: any) => user.id === admin.id && user.submitted));
  assert.ok(superReport.users.some((user: any) => user.id === peerAdmin.id && user.submitted));
  assert.ok(superReport.users.every((user: any) => ![superAdmin.id, peerSuper.id, folk.id].includes(user.id)));
  const adminReport = await run(report, admin, input);
  assert.ok(adminReport.users.every((user: any) => ![admin.id, peerAdmin.id, superAdmin.id, peerSuper.id].includes(user.id)));
  const groupReport = await run(report, rgf, { ...input, bvslMode: true, groupId: 'GROUP' });
  assert.ok(groupReport.users.every((user: any) => ![admin.id, peerAdmin.id, superAdmin.id, peerSuper.id].includes(user.id)));
  const superStats = await run(stats, superAdmin, input);
  assert.ok(superStats.userSummaries.some((user: any) => user.userId === admin.userId));
  const adminStats = await run(stats, admin, input);
  assert.ok(adminStats.userSummaries.every((user: any) => ![admin.userId, peerAdmin.userId, superAdmin.userId, peerSuper.userId].includes(user.userId)));
  const superMissing = await run(missing, superAdmin, input);
  assert.ok(superMissing.users.some((user: any) => user.userId === admin.userId));
  const peerMissing = await run(missing, admin, input);
  assert.ok(peerMissing.users.every((user: any) => user.userId !== peerAdmin.userId));
  const peerStatus = await run(statusReport, admin, { date });
  assert.ok(peerStatus.data.every((user: any) => ![admin.id, peerAdmin.id, superAdmin.id, peerSuper.id].includes(user.id)));
  const peerLeaderboard = await run(leaderboard, member, { segment: 'PW', date });
  assert.ok(peerLeaderboard.leaderboard.every((user: any) => ![admin.userId, peerAdmin.userId, superAdmin.userId, peerSuper.userId].includes(user.userId)));
});

test('private reports reject direct entry, profile, chart, meeting-context and attendance requests, including Auth aliases', async t => {
  const { writes, fixtures } = database(t);
  for (const actor of [peerAdmin, rgf, folk]) {
    for (const userId of [admin.id, admin.userId, admin.firebaseUid]) {
      await assert.rejects(run(progress, actor, { userId, days: 7 }), denied);
      await assert.rejects(run(contextReport, actor, { userId }), denied);
      await assert.rejects(run(profileReport, actor, { userId }), denied);
    }
    await assert.rejects(run(detail, actor, { entryId: `ENTRY-${admin.id}` }), denied);
    await assert.rejects(run(attendance, actor, { userId: admin.id, entryDate: date, attendedMinutes: 20, sessionMinutes: 30 }), denied);
  }
  assert.equal((await run(detail, superAdmin, { entryId: `ENTRY-${admin.id}` })).found, true);
  assert.equal((await run(detail, admin, { entryId: `ENTRY-${admin.id}` })).found, true);
  await assert.rejects(run(detail, superAdmin, { entryId: `ENTRY-${peerSuper.id}` }), denied);
  await assert.rejects(run(progress, superAdmin, { userId: peerSuper.id }), denied);
  assert.equal(writes.length, 0);
  Object.assign(fixtures.Users.find(user => user.id === admin.id), { isBvFacilitator: false, isBvsl: false });
  const result = await run(roster, rgf, { bvslId: rgf.userId });
  const adminRow = result.members.find((user: any) => user.userId === admin.userId);
  assert.ok(adminRow);
  assert.equal(adminRow.canAssignSadhanaTargets, false);
  assert.equal(adminRow.pwTargets, null);
  await run(recalculate, peerAdmin, { startDate: date, userIds: [admin.firebaseUid] });
  assert.ok(!writes.some(write => write.table === 'SadhanaEntries'));
});

test('group monitoring and missing reports hide admin records linked through legacy Auth IDs', async t => {
  const { fixtures } = database(t);
  fixtures.Guides = [{ id: 'guide', guideId: 'GUIDE', fullName: 'Guide', segment: 'PW' }];
  Object.assign(fixtures.BvGroups[0], { guide: 'guide', subFacilitatorId: admin.firebaseUid });
  Object.assign(fixtures.BvGroupMembers.find(row => row.user === admin.id), { user: admin.firebaseUid });
  const monitor = await run(groupMonitor, rgf, { guideId: 'guide', date });
  assert.ok(monitor.groups[0].members.some((user: any) => user.userId === member.id));
  assert.ok(monitor.groups[0].members.every((user: any) => ![admin.id, admin.firebaseUid, peerAdmin.id, superAdmin.id, peerSuper.id].includes(user.userId)));
  const absent = await run(groupMissing, rgf, { guideId: 'guide', startDate: date, endDate: date });
  assert.ok(absent.members.some((user: any) => user.userId === member.id));
  assert.ok(absent.members.every((user: any) => ![admin.id, admin.firebaseUid, peerAdmin.id, superAdmin.id, peerSuper.id].includes(user.userId)));
});
