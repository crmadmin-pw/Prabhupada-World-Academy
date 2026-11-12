import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApiUserContext, hasEndpointCapabilities } from '../src/lib/apiAuthorization';
import { AshrayUpgradeRequests, Users } from '../src/lib/app-backend-sdk';
import approveAshrayUpgrade from '../src/api/approveAshrayUpgrade';
import approveUser from '../src/api/approveUser';
import rejectUser from '../src/api/rejectUser';

const identity = { uid: 'admin', email: 'admin@example.test', emailVerified: true };
const profile = { id: 'admin', userId: 'ADMIN-001', status: 'Active', role: 'User', segment: 'PW', isBvAdmin: true };
const context = { user: buildApiUserContext(identity, profile) };

test('PW admin flag grants only the PW approval endpoints', () => {
  for (const endpoint of ['getPendingApprovals', 'getGuideRequests', 'approveUser', 'rejectUser', 'approveAshrayUpgrade']) {
    assert.equal(hasEndpointCapabilities(context.user, endpoint, 'users.approve'), true, endpoint);
  }
  for (const endpoint of ['assignGuide', 'updateUserStatus', 'getResidencyTransferRequests']) {
    assert.equal(hasEndpointCapabilities(context.user, endpoint, 'users.approve'), false, endpoint);
  }
  assert.equal(hasEndpointCapabilities(buildApiUserContext(identity, { ...profile, segment: 'FOLK' }), 'getPendingApprovals', 'users.approve'), false);
  assert.equal(hasEndpointCapabilities(buildApiUserContext(identity, { ...profile, status: 'Inactive' }), 'getPendingApprovals', 'users.approve'), false);
});

test('PW flag admin cannot approve or reject FOLK records', async t => {
  const target = { id: 'folk', userId: 'folk', segment: 'FOLK', role: 'User', isPrabhupadaWorldUser: true };
  t.mock.method(Users, 'findOne', async () => target);
  let writes = 0;
  t.mock.method(Users, 'update', async () => { writes++; });
  t.mock.method(AshrayUpgradeRequests, 'findOne', async () => ({ id: 'request', userId: 'folk', status: 'Pending' }));
  t.mock.method(AshrayUpgradeRequests, 'update', async () => { writes++; });
  for (const endpoint of [approveUser, rejectUser]) {
    await assert.rejects(endpoint.execute({ input: { userId: 'folk' }, context } as never), (error: any) => error.code === 'FORBIDDEN');
  }
  await assert.rejects(approveAshrayUpgrade.execute({ input: { requestId: 'request', action: 'approve' }, context } as never), (error: any) => error.code === 'FORBIDDEN');
  assert.equal(writes, 0);
});

test('PW flag admin can review a PW Ashraya request', async t => {
  t.mock.method(Users, 'findOne', async () => ({ id: 'pw-user', userId: 'PW-1', segment: 'PW', ashrayLevel: 'Jigyasa' }));
  t.mock.method(AshrayUpgradeRequests, 'findOne', async () => ({ id: 'request', userId: 'PW-1', status: 'Pending' }));
  const writes: any[] = [];
  t.mock.method(AshrayUpgradeRequests, 'update', async (input: any) => { writes.push(input); });
  const result = await approveAshrayUpgrade.execute({ input: { requestId: 'request', action: 'approve' }, context } as never);
  assert.equal(result.success, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].record.status, 'APPROVED');
});
