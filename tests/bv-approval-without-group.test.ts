import assert from 'node:assert/strict';
import test from 'node:test';
import { BvMemberRegistrations, Users } from '../src/lib/app-backend-sdk';
import approveAndAssignBvMember from '../src/api/approveAndAssignBvMember';

const admin = {
  id: 'admin-doc',
  userId: 'USER-ADMIN',
  email: 'admin@example.test',
  fullName: 'Admin Das',
  role: 'ADMIN',
  segment: 'PW',
  isBvAdmin: true,
};

test('BV approval without a group keeps the member unassigned and in the admin directory', async (t) => {
  const member = {
    id: 'doc-1',
    userId: 'USER-9',
    email: 'new@example.test',
    fullName: 'New Devotee',
    status: 'Pending Approval',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
  };
  const captured: { record: Record<string, unknown> | null } = { record: null };
  t.mock.method(Users, 'findOne', async (args: { id?: string }) => {
    if (args?.id === 'admin-doc') return admin;
    if (args?.id === 'doc-1') return member;
    return null;
  });
  t.mock.method(Users, 'update', async (args: { record: Record<string, unknown> }) => {
    captured.record = args.record;
  });
  t.mock.method(BvMemberRegistrations, 'findOne', async () => ({
    id: 'BVREG-doc-1',
    userDbId: 'doc-1',
    userId: 'USER-9',
    email: member.email,
    segment: 'PW',
    status: 'Pending Approval',
  }));
  t.mock.method(BvMemberRegistrations, 'update', async () => {});

  const result = await approveAndAssignBvMember.execute({
    input: { registrationId: 'BVREG-doc-1', segment: 'PW' },
    context: { user: { ...admin, capabilities: ['bv.manage'] } },
  } as never);

  assert.equal(result.success, true);
  assert.equal(captured.record?.status, 'Active');
  assert.equal(captured.record?.bvRegistrationStatus, 'Approved');
  assert.equal(captured.record?.isBvMember, false);
  assert.equal(captured.record?.bvGroupId, '');
  assert.equal(captured.record?.bvGroupName, '');
  assert.equal(captured.record?.guide, 'USER-ADMIN');
  assert.equal(captured.record?.selectedGuideId, 'USER-ADMIN');
  assert.equal(captured.record?.bvReportingAdminId, 'USER-ADMIN');
  assert.equal(captured.record?.bvReportingAdminName, 'Admin Das');
});
