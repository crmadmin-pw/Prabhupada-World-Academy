import assert from 'node:assert/strict';
import test from 'node:test';
import { Users } from '../src/lib/app-backend-sdk';
import approveUser from '../src/api/approveUser';

test('PW approval links an unassigned member to the approving admin', async (t) => {
  const user = {
    id: 'doc-1',
    userId: 'USER-9',
    email: 'new@example.test',
    fullName: 'New Devotee',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    status: 'Pending Approval',
  };
  const captured: { record: Record<string, unknown> | null } = { record: null };
  t.mock.method(Users, 'findOne', async () => user);
  t.mock.method(Users, 'update', async (args: { record: Record<string, unknown> }) => {
    captured.record = args.record;
  });

  const result = await approveUser.execute({
    input: { userId: 'doc-1' },
    context: {
      user: {
        id: 'admin-doc',
        userId: 'USER-ADMIN',
        email: 'admin@example.test',
        fullName: 'Admin Das',
        role: 'Admin',
        normalizedRole: 'ADMIN',
        segment: 'PW',
        isBvAdmin: true,
        capabilities: ['users.approve'],
      },
    },
  } as never);

  assert.equal(result.success, true);
  assert.equal(captured.record?.status, 'Active');
  assert.equal(captured.record?.guide, 'USER-ADMIN');
  assert.equal(captured.record?.selectedGuideId, 'USER-ADMIN');
  assert.equal(captured.record?.bvReportingAdminId, 'USER-ADMIN');
  assert.equal(captured.record?.bvReportingAdminName, 'Admin Das');
});

test('PW approval keeps a member who already reports to someone else', async (t) => {
  const user = {
    id: 'doc-2',
    userId: 'USER-10',
    email: 'assigned@example.test',
    fullName: 'Assigned Devotee',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    status: 'Pending Approval',
    bvReportingFacilitatorId: 'USER-RGF',
  };
  const captured: { record: Record<string, unknown> | null } = { record: null };
  t.mock.method(Users, 'findOne', async () => user);
  t.mock.method(Users, 'update', async (args: { record: Record<string, unknown> }) => {
    captured.record = args.record;
  });

  const result = await approveUser.execute({
    input: { userId: 'doc-2' },
    context: {
      user: {
        id: 'admin-doc',
        userId: 'USER-ADMIN',
        email: 'admin@example.test',
        fullName: 'Admin Das',
        role: 'Admin',
        normalizedRole: 'ADMIN',
        segment: 'PW',
        isBvAdmin: true,
        capabilities: ['users.approve'],
      },
    },
  } as never);

  assert.equal(result.success, true);
  assert.equal(captured.record?.status, 'Active');
  assert.equal(captured.record?.bvReportingAdminId, undefined);
  assert.equal(captured.record?.guide, undefined);
});
