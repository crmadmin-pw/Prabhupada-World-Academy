import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import getBvslOneToOneData from '../src/api/getBvslOneToOneData';

const admin = {
  id: 'admin-doc',
  userId: 'USER-ADMIN',
  email: 'admin@example.test',
  fullName: 'Vedanarayana Das',
  role: 'Admin',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isPwAdmin: true,
  isBvAdmin: true,
  status: 'Active',
};
const supervisor = {
  id: 'supervisor-doc',
  userId: 'USER-SUP',
  email: 'supervisor@example.test',
  fullName: 'BITS VEDANG',
  role: 'User',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvSupervisor: true,
  bvReportingAdminId: admin.userId,
  status: 'Active',
};
const rgf = {
  id: 'rgf-doc',
  userId: 'USER-RGF',
  email: 'rgf@example.test',
  fullName: 'Vedanarayana Dasa',
  role: 'User',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvFacilitator: true,
  isBvsl: true,
  bvReportingSupervisorId: supervisor.userId,
  status: 'Active',
};
const rgsf = {
  id: 'rgsf-doc',
  userId: 'USER-RGSF',
  email: 'rgsf@example.test',
  fullName: 'F20190150H',
  role: 'RGSF',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvSubFacilitator: true,
  bvReportingFacilitatorId: rgf.userId,
  bvReportingAdminId: 'other-admin',
  status: 'Active',
};
const group = {
  id: 'BV-GROUP-VDN',
  groupId: 'BV-GROUP-VDN',
  groupName: 'VDN Group',
  segment: 'PW',
  isActive: true,
  bvslId: rgf.userId,
  bvslLeader: rgf.id,
};
const fixture: Record<string, any[]> = {
  Users: [admin, supervisor, rgf, rgsf],
  BvGroups: [group],
  BvGroupMembers: [],
  OneToOneMeetings: [],
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

test('an admin 1:1 list includes an RGSF who reports to an RGF in that hierarchy', async (t) => {
  mockDatabase(t);
  await withHierarchyDatabase(null, async () => {
    const result = await getBvslOneToOneData.execute({
      input: { department: 'PW' },
      context: { user: admin },
    } as never);
    assert.deepEqual(result.users.map((user: any) => user.fullName).sort(), ['BITS VEDANG', 'F20190150H', 'Vedanarayana Dasa']);
  });
});
