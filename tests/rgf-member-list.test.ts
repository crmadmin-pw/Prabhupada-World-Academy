import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import getBvslMembers from '../src/api/getBvslMembers';

const facilitator = {
  id: 'rgf-doc',
  userId: 'USER-235',
  email: 'rgf@example.test',
  fullName: 'Vedanarayana Dasa',
  firebaseUid: 'firebase-rgf',
  role: 'User',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvFacilitator: true,
  isBvsl: true,
  status: 'Active',
};
const devotee = {
  id: 'devotee-doc',
  userId: 'USER-246',
  email: 'devotee@example.test',
  fullName: 'BITS VEDANG',
  role: 'User',
  segment: 'PW',
  status: 'Active',
};
const group = {
  id: 'BV-GROUP-VDN',
  groupId: 'BV-GROUP-VDN',
  groupName: 'VDN Group',
  segment: 'PW',
  isActive: true,
  bvslId: facilitator.userId,
  bvslLeader: facilitator.id,
  bvslName: facilitator.fullName,
};
const fixture: Record<string, any[]> = {
  Users: [facilitator, devotee],
  BvGroups: [group],
  BvGroupMembers: [
    { id: 'm-rgf', group: group.id, groupId: group.groupId, user: facilitator.firebaseUid, userId: facilitator.userId, role: 'Member' },
    { id: 'm-devotee', group: group.id, groupId: group.groupId, user: devotee.id, userId: devotee.userId, role: 'Member' },
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

test('an RGSF sees the members of the reporting RGF groups', async (t) => {
  const rgsf = {
    id: 'rgsf-doc',
    userId: 'USER-RGSF',
    email: 'rgsf@example.test',
    fullName: 'F20190150H',
    role: 'RGSF',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    isBvSubFacilitator: true,
    bvReportingFacilitatorId: facilitator.userId,
    status: 'Active',
  };
  fixture.Users.push(rgsf);
  t.after(() => { fixture.Users = fixture.Users.filter(user => user.id !== rgsf.id); });
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const result = await getBvslMembers.execute({
      input: { bvslId: rgsf.userId },
      context: { user: rgsf },
    } as never);
    assert.deepEqual(result.members.map((member: any) => member.fullName).sort(), ['BITS VEDANG', 'Vedanarayana Dasa']);
  });
});

test('an RGF who is also a group member appears on the members tab', async (t) => {
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const result = await getBvslMembers.execute({
      input: { bvslId: facilitator.userId },
      context: { user: facilitator },
    } as never);
    assert.deepEqual(result.members.map((member: any) => member.fullName).sort(), ['BITS VEDANG', 'Vedanarayana Dasa']);
  });
});

test('a member stored only by firebase auth id or display name appears on the members tab', async (t) => {
  const rimpy = {
    id: 'rimpy-doc',
    userId: 'USER-RIMPY',
    email: 'rimpy@example.test',
    fullName: 'Rimpy',
    firebaseUid: 'rimpy-firebase',
    role: 'User',
    segment: 'PW',
    status: 'Active',
  };
  const named = {
    id: 'named-doc',
    userId: 'USER-NAMED',
    email: 'named@example.test',
    fullName: 'Guddha Krishna',
    role: 'User',
    segment: 'PW',
    status: 'Active',
  };
  fixture.Users.push(rimpy, named);
  fixture.BvGroupMembers.push(
    { id: 'm-rimpy', group: group.id, groupId: group.groupId, user: rimpy.firebaseUid, role: 'Member' },
    { id: 'm-named', group: group.id, groupId: group.groupId, user: named.fullName, memberId: named.fullName, role: 'Member' },
  );
  t.after(() => {
    fixture.Users = fixture.Users.filter(user => user.id !== rimpy.id && user.id !== named.id);
    fixture.BvGroupMembers = fixture.BvGroupMembers.filter(member => member.id !== 'm-rimpy' && member.id !== 'm-named');
  });
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const result = await getBvslMembers.execute({
      input: { bvslId: facilitator.userId },
      context: { user: facilitator },
    } as never);
    assert.deepEqual(result.members.map((member: any) => member.fullName).sort(), [
      'BITS VEDANG',
      'Guddha Krishna',
      'Rimpy',
      'Vedanarayana Dasa',
    ]);
  });
});
