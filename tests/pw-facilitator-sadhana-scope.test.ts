import assert from 'node:assert/strict';
import test from 'node:test';

import { filterBvAdminFacilitators } from '../src/lib/bvAdminFacilitatorScope';

const adminA = {
  id: 'ADMIN-A-DB', userId: 'ADMIN-A', email: 'admin-a@example.test',
  status: 'Active', segment: 'PW', role: 'ADMIN', isBvAdmin: true,
};
const adminB = {
  id: 'ADMIN-B-DB', userId: 'ADMIN-B', email: 'admin-b@example.test',
  status: 'Active', segment: 'PW', role: 'ADMIN', isBvAdmin: true,
};
const supervisorA = {
  id: 'SUPERVISOR-A-DB', userId: 'SUPERVISOR-A', status: 'Active', segment: 'PW',
  role: 'Guide', isBvSupervisor: true, bvReportingAdminId: adminA.userId,
};
const rgfA = {
  id: 'RGF-A-DB', userId: 'RGF-A', fullName: 'Admin A RGF', status: 'Active', segment: 'PW',
  role: 'BVSL', isBvFacilitator: true, bvReportingSupervisorId: supervisorA.id,
};
const rgsfA = {
  id: 'RGSF-A-DB', userId: 'RGSF-A', fullName: 'Admin A RGSF', status: 'Active', segment: 'PW',
  role: 'User', isBvSubFacilitator: true, bvReportingFacilitatorId: rgfA.userId,
};
const rgfB = {
  id: 'RGF-B-DB', userId: 'RGF-B', fullName: 'Admin B RGF', status: 'Active', segment: 'PW',
  role: 'RGF', isBvsl: true, guide: adminB.id,
};
const memberA = {
  id: 'MEMBER-A-DB', userId: 'MEMBER-A', fullName: 'Ordinary Member', status: 'Active',
  segment: 'PW', role: 'User', guide: adminA.id,
};

const users = [adminA, adminB, supervisorA, rgfA, rgsfA, rgfB, memberA];

test('PW Admin facilitator Sadhana scope contains only RGF/RGSF descendants of that Admin', () => {
  const result = filterBvAdminFacilitators(users, adminA, adminB.userId, 'PW');
  assert.deepEqual(result.map(user => user.id).sort(), [rgfA.id, rgsfA.id].sort());
});

test('a self-linked RGF and a supervisor with a stale facilitator id still reach the Admin', () => {
  const admin = {
    id: '9LmUXbG637YTjvVXyF3Hf8D4rYB3', userId: 'USER-MTWND3S6', status: 'Active',
    segment: 'PW', role: 'ADMIN', isBvAdmin: true,
  };
  const supervisor = {
    id: 'EOPsxhyV7sfjzO1MRJ4ZooFIWXp2', userId: 'USER-246', fullName: 'BITS VEDANG',
    status: 'Active', segment: 'PW', role: 'USER', isBvSupervisor: true,
    bvReportingAdminId: admin.userId, bvReportingSupervisorId: admin.userId,
    bvReportingFacilitatorId: 'USER-235',
  };
  const rgf = {
    id: 'USER-e3764ad0b8035a353e0c39400e105773', userId: 'USER-235', fullName: 'Vedanarayana Dasa',
    status: 'Active', segment: 'PW', role: 'USER', isBvFacilitator: true, isBvsl: true,
    bvReportingAdminId: admin.userId, bvReportingSupervisorId: supervisor.userId,
    bvReportingFacilitatorId: 'USER-e3764ad0b8035a353e0c39400e105773',
  };
  const rgsf = {
    id: 'USER-51a52a4fdc58e02fca6f204c8206c548', userId: 'USER-RGSF', fullName: 'F20190150H',
    status: 'Active', segment: 'PW', role: 'USER', isBvSubFacilitator: true,
    bvReportingAdminId: admin.userId, bvReportingFacilitatorId: rgf.userId,
  };
  const result = filterBvAdminFacilitators([admin, supervisor, rgf, rgsf], admin, admin.userId, 'PW');
  assert.deepEqual(result.map(user => user.fullName).sort(), ['F20190150H', 'Vedanarayana Dasa']);
});

test('PW Super Admin can view all facilitators or select one Admin', () => {
  const superAdmin = {
    id: 'SUPER-ADMIN-DB', userId: 'SUPER-ADMIN', status: 'Active', segment: 'PW',
    role: 'SUPER_ADMIN', isBvSuperAdmin: true,
  };
  const all = filterBvAdminFacilitators([...users, superAdmin], superAdmin, 'ALL', 'PW');
  assert.deepEqual(all.map(user => user.id).sort(), [rgfA.id, rgsfA.id, rgfB.id].sort());

  const selected = filterBvAdminFacilitators([...users, superAdmin], superAdmin, adminB.userId, 'PW');
  assert.deepEqual(selected.map(user => user.id), [rgfB.id]);
});
