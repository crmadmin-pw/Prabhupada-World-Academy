import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { resolveBvGroupMemberUsers } from '../src/lib/bvGroupMemberScope';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import getGuideDetailedReport from '../src/api/getGuideDetailedReport';

const supervisor = {
  id: 'sadhana-supervisor',
  userId: 'USER-SUP',
  email: 'supervisor@example.test',
  fullName: 'BITS VEDANG',
  role: 'User',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvSupervisor: true,
  status: 'Active',
};
const linked = {
  id: 'linked-member',
  userId: 'USER-LINKED',
  email: 'linked@example.test',
  fullName: 'Linked Member',
  role: 'User',
  segment: 'PW',
  status: 'Active',
};
const group = {
  id: 'BV-GROUP-HARIBOL',
  groupId: 'BV-GROUP-HARIBOL',
  groupName: 'HARIBOL',
  segment: 'PW',
  isActive: true,
  bvslId: supervisor.userId,
  bvslLeader: supervisor.id,
  bvslName: supervisor.fullName,
};
const fixture: Record<string, any[]> = {
  Users: [supervisor, linked],
  BvGroups: [group],
  BvGroupMembers: [
    { id: 'm-linked', group: group.id, groupId: group.groupId, user: linked.id, userId: linked.userId, role: 'Member' },
    { id: 'm-orphan', group: group.id, groupId: group.groupId, user: 'auth-orphan', userId: 'USER-ORPHAN', memberId: 'USER-ORPHAN', role: 'Member' },
    { id: 'm-self', group: group.id, groupId: group.groupId, user: supervisor.id, userId: supervisor.userId, role: 'Member' },
  ],
  SadhanaEntries: [],
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

test('a supervisor sadhana report keeps a group member who has no user account', async (t) => {
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const members = await resolveBvGroupMemberUsers(supervisor, ['id', 'userId', 'fullName'], {
      segment: 'PW',
      excludeCaller: true,
    });
    assert.deepEqual(members.map(member => member.id).sort(), ['auth-orphan', 'linked-member']);
    assert.equal(members.find(member => member.id === 'auth-orphan')?.fullName, 'Devotee');

    const report = await getGuideDetailedReport.execute({
      input: {
        guideId: supervisor.userId,
        date: '2026-10-12',
        reportType: 'daily',
        bvslMode: true,
        segment: 'PW',
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(report.users.map((user: any) => user.id).sort(), ['auth-orphan', 'linked-member']);
    assert.equal(report.users.filter((user: any) => user.submitted).length, 0);
  });
});
