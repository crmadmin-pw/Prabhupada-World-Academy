import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { queryCacheKey } from '../src/lib/app-endpoints-sdk';
import { organizationalDepartment } from '../src/lib/directoryDepartment';
import { getBulkExportOptions, requireBulkUserManager } from '../src/lib/bulkUserManagement';
import getGuides from '../src/api/getGuides';
import getGuideUsers from '../src/api/getGuideUsers';
import getBvslGroups from '../src/api/getBvslGroups';
import getPendingApprovals from '../src/api/getPendingApprovals';
import getPendingBvRegistrations from '../src/api/getPendingBvRegistrations';
import getUserDetailForGuide from '../src/api/getUserDetailForGuide';
import exportUserData from '../src/api/exportUserData';
import getCurrentGuide from '../src/api/getCurrentGuide';
import getMissingSadhanaReport from '../src/api/getMissingSadhanaReport';
import getPushSubscriptionStats from '../src/api/getPushSubscriptionStats';
import getActiveSadhanaMentors from '../src/api/getActiveSadhanaMentors';

const folkGuide = {
  id: 'folk-guide', userId: 'public-folk-guide', email: 'folk-guide@example.test',
  fullName: 'Folk Guide', role: 'GUIDE', segment: 'FOLK', status: 'Active',
  isPrabhupadaWorldUser: true, folkResidencies: ['res-folk'],
};
const folkSuper = {
  id: 'folk-super', userId: 'public-folk-super', email: 'folk-super@example.test',
  fullName: 'Folk Super', role: 'SUPER_GUIDE', segment: 'FOLK', status: 'Active', isBvSuperAdmin: true,
};
const folkMember = {
  id: 'folk-member', userId: 'public-folk-member', email: 'folk-member@example.test',
  phone: '+91 9876543210', fullName: 'Folk Member', role: 'User', segment: 'FOLK', status: 'Active', guide: folkGuide.id,
};
const legacyMember = {
  id: 'legacy-member', userId: 'public-legacy-member', email: 'legacy-member@example.test',
  fullName: 'Legacy Member', role: 'User', status: 'Active', guide: folkGuide.id,
};
const pwMember = {
  id: 'pw-member', userId: 'public-pw-member', email: 'pw-member@example.test',
  phone: '+91 9876543211', fullName: 'PW Member', role: 'User', segment: 'Prabhupada World', status: 'Active', guide: folkGuide.id,
};
const pwAdmin = {
  id: 'pw-admin', userId: 'public-pw-admin', email: 'pw-admin@example.test',
  fullName: 'PW Admin', role: 'ADMIN', segment: 'Prabhupada World', status: 'Active', isBvAdmin: true,
};
const pwResident = {
  id: 'pw-resident', userId: 'public-pw-resident', email: 'pw-resident@example.test',
  fullName: 'PW Resident', role: 'User', segment: 'PW', status: 'Active', guide: 'pw-admin',
};
const pwSuper = {
  id: 'pw-super', userId: 'public-pw-super', email: 'pw-super@example.test',
  fullName: 'PW Super', role: 'SUPER_ADMIN', segment: 'PW', status: 'Active', isBvSuperAdmin: true,
};
const bareAdmin = {
  id: 'bare-admin', userId: 'public-bare-admin', email: 'bare-admin@example.test',
  fullName: 'Bare Admin', role: 'ADMIN', status: 'Active', guide: folkGuide.id,
};
const pwPending = {
  id: 'pw-pending', userId: 'public-pw-pending', email: 'pw-pending@example.test',
  fullName: 'PW Pending', role: 'User', segment: 'Prabhupada World', status: 'Pending Approval',
  bvRegistrationStatus: 'Pending Approval', guide: folkGuide.id,
};
const folkPending = {
  id: 'folk-pending', userId: 'public-folk-pending', email: 'folk-pending@example.test',
  fullName: 'Folk Pending', role: 'User', segment: 'FOLK', status: 'Pending Approval', guide: folkGuide.id,
};

const users = [folkGuide, folkSuper, folkMember, legacyMember, pwMember, pwResident, pwAdmin, pwSuper, bareAdmin, pwPending, folkPending];
const fixture: Record<string, any[]> = {
  Users: users,
  Guides: [folkGuide, folkSuper, pwAdmin, pwSuper, bareAdmin].map(user => ({
    id: user.id, guideId: user.userId, email: user.email, fullName: user.fullName,
    name: user.fullName, isActive: true, segment: user.segment, role: user.role, folkResidencies: (user as any).folkResidencies,
  })),
  FolkResidencies: [{ id: 'res-folk', residencyName: 'Folk Residence', guideIds: [folkGuide.id], isActive: true, segment: 'FOLK' }],
  BvGroups: [
    { id: 'folk-group', groupId: 'public-folk-group', groupName: 'Folk Group', segment: 'FOLK', isActive: true, bvslLeader: folkGuide.id, bvslName: folkGuide.fullName, guide: folkGuide.id },
    { id: 'pw-group', groupId: 'public-pw-group', groupName: 'PW Group', segment: 'Prabhupada World', isActive: true, bvslLeader: pwAdmin.id, bvslId: pwAdmin.userId, bvslName: pwAdmin.fullName, guide: pwAdmin.id },
  ],
  BvGroupMembers: [
    { id: 'folk-membership', group: 'folk-group', user: folkMember.id, userId: folkMember.userId },
    { id: 'pw-membership', group: 'pw-group', user: pwMember.id, userId: pwMember.userId, memberId: pwMember.email },
  ],
  SadhanaEntries: [],
  BvAttendance: [],
  PushSubscriptions: [
    { id: 'push-folk', user: folkMember.id },
    { id: 'push-pw', user: pwAdmin.id },
  ],
  BvMemberRegistrations: [],
  Config: [],
};

function mockDatabase(t: any) {
  serverCacheInvalidate();
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.map(String).includes(String(item)));
      return (!value.gte || actual >= value.gte) && (!value.lte || actual <= value.lte);
    }
    return [actual].flat().map(String).includes(String(value));
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      const offset = options.offset || 0;
      const page = records.slice(offset, offset + (options.limit || 2000));
      return {
        records: page.map(record => options.fields
          ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, record[key]]))
          : { ...record }),
        hasMore: offset + page.length < records.length,
      };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
}

const call = (endpoint: any, input: any, caller: any) => endpoint.execute({
  input,
  context: {
    user: {
      ...caller,
      capabilities: ['*', 'users.assigned.read', 'users.approve', 'bv.manage', 'notifications.send'],
    },
  },
});

const names = (value: unknown) => JSON.stringify(value);
const hidden = ['PW Member', 'PW Resident', 'PW Admin', 'PW Super', 'Bare Admin', 'PW Pending'];

test('department classification keeps an explicit segment ahead of a stale flag', () => {
  assert.equal(organizationalDepartment(folkGuide), 'FOLK');
  assert.equal(organizationalDepartment(pwMember), 'PW');
  assert.equal(organizationalDepartment(pwAdmin), 'PW');
  assert.equal(organizationalDepartment(bareAdmin), 'PW');
  assert.equal(organizationalDepartment(legacyMember), null);
  assert.equal(organizationalDepartment(folkSuper), 'FOLK');
});

test('a FOLK Guide cannot list, search, or open Prabhupada World personnel', async t => {
  mockDatabase(t);
  const directory = await call(getGuideUsers, { guideId: 'ALL', statusFilter: 'all', segment: 'FOLK' }, folkGuide);
  const listed = directory.users.map((user: any) => user.fullName);
  assert.ok(listed.includes('Folk Member'));
  assert.ok(listed.includes('Legacy Member'));
  for (const name of hidden) assert.equal(listed.includes(name), false, name);
  const searched = directory.users.filter((user: any) => String(user.fullName).toLowerCase().includes('pw') || String(user.fullName).toLowerCase().includes('admin'));
  assert.deepEqual(searched, []);

  await assert.rejects(
    call(getGuideUsers, { guideId: 'ALL', segment: 'PW' }, folkGuide),
    /another department/,
  );
  await assert.rejects(
    call(getUserDetailForGuide, { userId: pwAdmin.id }, folkGuide),
    /another department/,
  );
  await assert.rejects(
    call(getUserDetailForGuide, { userId: pwMember.id }, folkGuide),
    /another department/,
  );
  const legacyProfile = await call(getUserDetailForGuide, { userId: legacyMember.id }, folkGuide);
  assert.equal(legacyProfile.user?.fullName || legacyProfile.fullName, 'Legacy Member');
});

test('a FOLK Super Guide cannot discover PW admins through guides, groups, approvals, or export', async t => {
  mockDatabase(t);
  await call(getGuides, { segment: 'PW' }, pwAdmin);
  const guides = await call(getGuides, {}, folkSuper);
  assert.equal(names(guides).includes('PW Admin'), false);
  assert.equal(names(guides).includes('PW Super'), false);
  assert.equal(names(guides).includes('Bare Admin'), false);
  assert.ok(names(guides).includes('Folk Guide'));

  const groups = await call(getBvslGroups, { bvslId: 'ALL' }, folkSuper);
  assert.equal(names(groups).includes('PW Admin'), false);
  assert.equal(names(groups).includes('PW Group'), false);
  assert.ok(names(groups).includes('Folk Group'));

  const approvals = await call(getPendingApprovals, { guideId: 'ALL' }, folkSuper);
  assert.equal(names(approvals).includes('PW Pending'), false);
  assert.ok(names(approvals).includes('Folk Pending'));

  const registrations = await call(getPendingBvRegistrations, {}, folkSuper);
  assert.equal(names(registrations).includes('PW Pending'), false);

  const exported = await call(exportUserData, {}, folkSuper);
  for (const name of hidden) assert.equal(names(exported).includes(name), false, name);
  assert.ok(names(exported).includes('Folk Member'));
  assert.ok(names(exported).includes('Legacy Member'));

  const manager = await requireBulkUserManager({ ...folkSuper, isActive: true } as any);
  const options = await getBulkExportOptions(manager);
  assert.equal(names(options).includes('PW Admin'), false);
  assert.ok(options.guides.some(guide => guide.name === 'Folk Guide'));

  await assert.rejects(
    call(getPushSubscriptionStats, { segment: 'PW' }, folkSuper),
    /another department/,
  );
  const ownStats = await call(getPushSubscriptionStats, { segment: 'FOLK' }, folkSuper);
  assert.equal(names(ownStats).includes('PW Admin'), false);
});

test('FOLK dashboard counts exclude Prabhupada World people and keep the FOLK member', async t => {
  mockDatabase(t);
  const report = await call(getMissingSadhanaReport, {
    guideId: 'ALL', segment: 'FOLK', startDate: '2026-09-08', endDate: '2026-09-08',
  }, folkGuide);
  assert.deepEqual(report.users.map((user: any) => user.id).sort(), ['folk-member', 'legacy-member']);
  assert.equal(report.stats.totalUsers, 2);
  assert.equal(report.users.find((user: any) => user.id === 'folk-member').phone, folkMember.phone);
  assert.equal(report.users.find((user: any) => user.id === 'legacy-member').segment, 'FOLK');
  const pwReport = await call(getMissingSadhanaReport, { segment: 'PW', startDate: '2026-09-08', endDate: '2026-09-08' }, pwSuper);
  assert.ok(pwReport.users.length > 0);
  assert.ok(pwReport.users.every((user: any) => user.phone === null && user.segment !== 'FOLK'));
  assert.equal(names(report).includes('PW Member'), false);
  assert.equal(names(report.guides).includes('PW Admin'), false);

  const current = await call(getCurrentGuide, {}, folkGuide);
  assert.equal(current.metrics.totalActive, 2);
});

test('directory cache keys stay separate and a cached guide catalogue does not cross departments', async t => {
  mockDatabase(t);
  const folkKey = queryCacheKey('getGuideUsers', { guideId: 'ALL', statusFilter: 'all', segment: 'FOLK' });
  const pwKey = queryCacheKey('getGuideUsers', { guideId: 'ALL', statusFilter: 'all', segment: 'PW' });
  assert.notEqual(folkKey, pwKey);

  const pwDirectory = await call(getGuideUsers, { guideId: 'ALL', statusFilter: 'all', segment: 'PW' }, pwAdmin);
  assert.ok(pwDirectory.users.some((user: any) => user.fullName === 'PW Resident'));
  assert.ok(pwDirectory.users.some((user: any) => user.fullName === 'PW Admin'));
  assert.equal(pwDirectory.users.some((user: any) => user.fullName === 'Folk Guide'), false);
  assert.equal(pwDirectory.users.some((user: any) => user.fullName === 'Folk Member'), false);

  const folkDirectory = await call(getGuideUsers, { guideId: 'ALL', statusFilter: 'all', segment: 'FOLK' }, folkSuper);
  assert.equal(names(folkDirectory).includes('PW Admin'), false);
  assert.ok(names(folkDirectory).includes('Legacy Member'));

  const mentors = await call(getActiveSadhanaMentors, { segment: 'PW' }, pwAdmin);
  assert.equal(names(mentors).includes('Folk Guide'), false);
});
