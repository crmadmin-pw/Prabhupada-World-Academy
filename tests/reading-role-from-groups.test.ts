import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { BvGroups, Users } from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import { effectiveReadingRoles, listedReadingRoles } from '../src/lib/bvGroupFacilitators';
import getBvslMembers from '../src/api/getBvslMembers';
import getUserProfile from '../src/api/getUserProfile';
import resolveUserLogin from '../src/api/resolveUserLogin';

test('a group listing wins over a stale RGSF flag, and no listing keeps the stored flag', () => {
  const stored = { isBvFacilitator: true, isBvsl: true, isBvSubFacilitator: true };
  const person = { id: 'doc-1', userId: 'USER-1', email: 'person@example.test', fullName: 'Person One' };
  const listedOnlyAsFacilitator = listedReadingRoles([
    { bvslLeader: person.id, bvslId: person.userId, bvslName: person.fullName, subFacilitatorId: 'other', rgsfId: 'USER-2', subFacilitator: 'Other' },
  ], person);
  assert.deepEqual(effectiveReadingRoles(stored, listedOnlyAsFacilitator), {
    isFacilitator: true,
    isSubFacilitator: false,
  });
  assert.deepEqual(effectiveReadingRoles(stored, listedReadingRoles([], person)), {
    isFacilitator: true,
    isSubFacilitator: true,
  });
  assert.deepEqual(effectiveReadingRoles(stored, null), {
    isFacilitator: true,
    isSubFacilitator: true,
  });
});

const parent = {
  id: 'stale-parent-doc',
  userId: 'USER-STALE-PARENT',
  email: 'stale-parent@example.test',
  fullName: 'Parent Facilitator',
  role: 'User',
  segment: 'PW',
  isBvFacilitator: true,
  isBvsl: true,
  status: 'Active',
};
const facilitator = {
  id: 'stale-rgf-doc',
  userId: 'USER-STALE-RGF',
  email: 'stale-rgf@example.test',
  fullName: 'Stale Rgsf Flag',
  role: 'User',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvFacilitator: true,
  isBvsl: true,
  isBvSubFacilitator: true,
  bvReportingFacilitatorId: parent.userId,
  status: 'Active',
  lastLoginAt: '2026-10-01T00:00:00.000Z',
};
const parentMember = {
  id: 'stale-parent-member-doc',
  userId: 'USER-STALE-PARENT-MEMBER',
  email: 'stale-parent-member@example.test',
  fullName: 'Parent Group Member',
  role: 'User',
  segment: 'PW',
  status: 'Active',
};
const ownMember = {
  id: 'stale-own-member-doc',
  userId: 'USER-STALE-OWN-MEMBER',
  email: 'stale-own-member@example.test',
  fullName: 'Own Group Member',
  role: 'User',
  segment: 'PW',
  status: 'Active',
};
const parentGroup = {
  id: 'BV-GROUP-STALE-PARENT',
  groupId: 'BV-GROUP-STALE-PARENT',
  groupName: 'Parent Group',
  segment: 'PW',
  isActive: true,
  bvslId: parent.userId,
  bvslLeader: parent.id,
  bvslName: parent.fullName,
};
const ownGroup = {
  id: 'BV-GROUP-STALE-OWN',
  groupId: 'BV-GROUP-STALE-OWN',
  groupName: 'Own Group',
  segment: 'PW',
  isActive: true,
  bvslId: facilitator.userId,
  bvslLeader: facilitator.id,
  bvslName: facilitator.fullName,
  subFacilitatorId: 'other-rgsf-doc',
  rgsfId: 'USER-OTHER-RGSF',
  subFacilitator: 'Other Rgsf',
};
const fixture: Record<string, any[]> = {
  Users: [parent, facilitator, parentMember, ownMember],
  BvGroups: [parentGroup, ownGroup],
  BvGroupMembers: [
    { id: 'm-parent', group: parentGroup.id, groupId: parentGroup.groupId, user: parentMember.id, userId: parentMember.userId, role: 'Member' },
    { id: 'm-own', group: ownGroup.id, groupId: ownGroup.groupId, user: ownMember.id, userId: ownMember.userId, role: 'Member' },
  ],
};

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

test('an RGF with a stale RGSF flag does not inherit the parent facilitator groups', async (t) => {
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const result = await getBvslMembers.execute({
      input: { bvslId: facilitator.userId },
      context: { user: facilitator },
    } as never);
    assert.deepEqual(result.members.map((member: any) => member.fullName), ['Own Group Member']);
  });
});

test('login and profile follow the group: RGF only, even when the stored RGSF flag is still set', async () => {
  const user = {
    id: 'ROLE-FROM-GROUP-DOC',
    userId: 'ROLE-FROM-GROUP',
    email: 'role-from-group@example.invalid',
    fullName: 'Role From Group',
    role: 'User',
    status: 'Active',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    isBvFacilitator: true,
    isBvsl: true,
    isBvSubFacilitator: true,
    bvReportingFacilitatorId: 'ROLE-FROM-GROUP-PARENT',
    lastLoginAt: '2026-10-01T00:00:00.000Z',
  };
  const group = {
    id: 'ROLE-FROM-GROUP-BV',
    groupId: 'ROLE-FROM-GROUP-BV',
    groupName: 'Role From Group Circle',
    segment: 'PW',
    isActive: true,
    bvslLeader: user.id,
    bvslId: user.userId,
    bvslName: user.fullName,
    subFacilitatorId: 'ROLE-FROM-GROUP-OTHER',
    rgsfId: 'USER-ROLE-FROM-GROUP-OTHER',
    subFacilitator: 'Other Rgsf',
  };
  try {
    await Users.create({ record: user });
    await BvGroups.create({ record: group });
    const context = { user: { id: user.id, userId: user.userId, email: user.email } };
    const login = await resolveUserLogin.execute({ input: {}, context } as never);
    assert.equal(login.route, '/bvsl/dashboard');
    assert.equal(login.user.isBvFacilitator, true);
    assert.equal(login.user.isBvSubFacilitator, false);
    const profile = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(profile.user?.isBvFacilitator, true);
    assert.equal(profile.user?.isBvSubFacilitator, false);
    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.isBvSubFacilitator, true);
  } finally {
    await BvGroups.delete({ id: group.id }).catch(() => undefined);
    await Users.delete({ id: user.id }).catch(() => undefined);
  }
});
