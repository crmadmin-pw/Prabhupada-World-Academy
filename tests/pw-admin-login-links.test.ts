import assert from 'node:assert/strict';
import test from 'node:test';
import { canReviewAccountLinks, canReviewAccountLinkProfile } from '../src/lib/accountLinkAccess';
import { canReviewAccountLinkRequest } from '../src/lib/accountLinkReview';
import { buildApiUserContext, deriveApiCapabilities, hasApiCapabilities } from '../src/lib/apiAuthorization';
import { AccountLinkRequests, Users } from '../src/lib/app-backend-sdk';
import getPendingAccountLinks from '../src/api/getPendingAccountLinks';
import reviewAccountLink from '../src/api/reviewAccountLink';

const admin = { id: 'rmdd', role: 'User', status: 'Active', segment: 'PW', isBvAdmin: true, isBvsl: true };
const member = { id: 'pw-member', userId: 'PW-MEMBER', role: 'User', status: 'Active', segment: 'PW', email: 'member@example.test' };

test('a PW admin flag exposes login review without granting system administration', () => {
  const capabilities = deriveApiCapabilities(admin);
  const context = buildApiUserContext({ uid: admin.id, email: 'admin@example.test', emailVerified: true }, admin);
  assert.equal(canReviewAccountLinks(admin), true);
  assert.ok(capabilities.includes('account.links.review'));
  assert.ok(!capabilities.includes('system.admin'));
  assert.equal(hasApiCapabilities(context, getPendingAccountLinks.requiredCapabilities), true);
  assert.equal(hasApiCapabilities(context, reviewAccountLink.requiredCapabilities), true);
  for (const user of [
    { role: 'User', segment: 'PW' },
    { role: 'User', segment: 'PW', isBvsl: true },
    { role: 'Guide', segment: 'FOLK', isBvAdmin: true },
    { role: 'Super Guide', segment: 'FOLK' },
  ]) assert.equal(canReviewAccountLinks(user), false);
  for (const user of [{ role: 'Admin' }, { role: 'PW_ADMIN' }, { role: 'SUPER_ADMIN' }, { role: 'User', isBvSuperAdmin: true }]) {
    assert.equal(canReviewAccountLinks(user), true);
  }
  assert.equal(canReviewAccountLinkProfile(admin, member), true);
  for (const profile of [
    { ...member, segment: 'FOLK' }, { ...member, segment: undefined },
    { ...member, isBvAdmin: true }, { ...member, isBvSuperAdmin: true },
    { ...member, role: 'Administrator' }, { ...member, role: 'Super Admin' },
  ]) assert.equal(canReviewAccountLinkProfile(admin, profile), false);
});

test('PW flag admins see eligible PW requests; mixed, staff and stale candidates remain restricted', async t => {
  const profiles = [member, { ...member, id: 'folk-member', segment: 'FOLK' }, { ...member, id: 'pw-admin', isBvAdmin: true }];
  const request = (id: string, ids: string[], status = 'Pending') => ({ id, status, authUid: `auth-${id}`, email: member.email, candidateProfileIds: ids,
    candidates: ids.map(id => profiles.find(profile => profile.id === id)), createdAt: '2026-11-03T04:00:00Z' });
  const requests = [request('pw', [member.id]), request('folk', ['folk-member']), request('admin', ['pw-admin']),
    request('mixed', [member.id, 'folk-member']), request('unknown', ['missing']), request('rejected-pw', [member.id], 'Rejected')];
  t.mock.method(Users, 'findOne', async (input: any) => profiles.find(profile => profile.id === input.id));
  t.mock.method(AccountLinkRequests, 'findAll', async () => ({ records: requests, hasMore: false }));
  t.mock.method(AccountLinkRequests, 'findOne', async (input: any) => requests.find(request => request.id === input.id));
  const writes: any[] = [];
  t.mock.method(Users, 'update', async (input: any) => { writes.push(input); return input; });
  t.mock.method(AccountLinkRequests, 'update', async (input: any) => { writes.push(input); return input; });

  const visible = await getPendingAccountLinks.execute({ input: {}, context: { user: admin } } as never);
  assert.deepEqual(visible.map(row => row.id), ['pw', 'rejected-pw']);
  assert.equal(await canReviewAccountLinkRequest(admin, requests[0]), true);
  const systemList = await getPendingAccountLinks.execute({ input: {}, context: { user: { role: 'ADMIN' } } } as never);
  assert.equal(systemList.length, requests.length);
  for (const requestId of ['folk', 'admin', 'mixed', 'unknown']) {
    for (const action of ['approve', 'reject', 'reopen']) {
      await assert.rejects(reviewAccountLink.execute({ input: { requestId, action, profileId: member.id }, context: { user: admin } } as never),
        (error: any) => error.code === 'FORBIDDEN');
    }
  }
  assert.equal(writes.length, 0);
  const approved = await reviewAccountLink.execute({
    input: { requestId: 'pw', action: 'approve', profileId: member.id }, context: { user: admin },
  } as never);
  assert.equal(approved.status, 'Approved');
  assert.equal(writes.find(write => write.id === member.id)?.record.firebaseUid, 'auth-pw');
  const count = writes.length;
  // Recheck live profile fields rather than trusting the old request summary.
  Object.assign(profiles[0], { segment: 'FOLK' });
  await assert.rejects(reviewAccountLink.execute({ input: { requestId: 'pw', action: 'approve', profileId: member.id }, context: { user: admin } } as never),
    (error: any) => error.code === 'FORBIDDEN');
  assert.equal(writes.length, count);
});
