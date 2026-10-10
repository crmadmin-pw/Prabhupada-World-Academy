import assert from 'node:assert/strict';
import test from 'node:test';

import getUserProfile from '../src/api/getUserProfile';
import registerUser from '../src/api/registerUser';
import resolveUserLogin from '../src/api/resolveUserLogin';
import reviewAccountLink from '../src/api/reviewAccountLink';
import { AccountLinkRequests, Users } from '../src/lib/app-backend-sdk';
import { accountLinkRequestId, resolveAuthenticatedProfile } from '../src/lib/accountLinkReview';

const email = 'first-login-link@example.invalid';
const authUid = 'auth-first-login-link';
const profileId = 'profile-first-login-link';
const otherProfileId = 'other-profile-first-login-link';

function loginContext() {
  return {
    user: {
      id: authUid,
      uid: authUid,
      email,
      role: 'UNREGISTERED',
      status: null,
    },
  };
}

async function seedUnlinkedMatch() {
  await Users.create({
    record: {
      id: authUid,
      email,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  });
  await Users.create({
    record: {
      id: profileId,
      userId: 'USER-LINK-1',
      fullName: 'Matched Devotee',
      email,
      role: 'User',
      status: 'Active',
      segment: 'PW',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  });
  await Users.create({
    record: {
      id: otherProfileId,
      userId: 'USER-LINK-2',
      fullName: 'Other Devotee',
      email,
      role: 'Guide',
      status: 'Active',
      segment: 'FOLK',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
  });
}

async function cleanup() {
  await Users.delete({ id: authUid }).catch(() => undefined);
  await Users.delete({ id: profileId }).catch(() => undefined);
  await Users.delete({ id: otherProfileId }).catch(() => undefined);
  await AccountLinkRequests.delete({ id: accountLinkRequestId(authUid) }).catch(() => undefined);
}

test('first login records a review and does not attach or delete either profile', async () => {
  await cleanup();
  await seedUnlinkedMatch();
  try {
    const resolved = await resolveAuthenticatedProfile(authUid, email);
    assert.equal(resolved?.id, authUid);
    assert.equal(resolved?.userId, undefined);

    const login = await resolveUserLogin.execute({ input: {}, context: loginContext() } as never);
    assert.equal(login.action, 'account_link_pending');

    const profile = await getUserProfile.execute({ input: {}, context: loginContext() } as never);
    assert.equal(profile.user, null);

    const stub = await Users.findOne({ id: authUid });
    const matched = await Users.findOne({ id: profileId });
    const other = await Users.findOne({ id: otherProfileId });
    assert.equal(stub?.userId, undefined);
    assert.equal(stub?.status, undefined);
    assert.equal(stub?.fullName, undefined);
    assert.equal(matched?.firebaseUid, undefined);
    assert.equal(matched?.fullName, 'Matched Devotee');
    assert.equal(other?.firebaseUid, undefined);
    assert.equal(other?.fullName, 'Other Devotee');

    const request = await AccountLinkRequests.findOne({ id: accountLinkRequestId(authUid) });
    assert.equal(request.status, 'Pending');
    assert.deepEqual([...request.candidateProfileIds].sort(), [otherProfileId, profileId].sort());
  } finally {
    await cleanup();
  }
});

test('a guide cannot approve the link, and approval attaches only the chosen profile', async () => {
  await cleanup();
  await seedUnlinkedMatch();
  try {
    await resolveAuthenticatedProfile(authUid, email);

    await assert.rejects(
      () => reviewAccountLink.execute({
        input: { requestId: accountLinkRequestId(authUid), action: 'approve', profileId },
        context: { user: { id: 'guide-reviewer', role: 'GUIDE', capabilities: ['users.approve'] } },
      } as never),
      (error: any) => error.code === 'FORBIDDEN',
    );

    const before = await Users.findOne({ id: profileId });
    assert.equal(before.firebaseUid, undefined);

    const result = await reviewAccountLink.execute({
      input: { requestId: accountLinkRequestId(authUid), action: 'approve', profileId },
      context: { user: { id: 'admin-reviewer', role: 'ADMIN', capabilities: ['system.admin'] } },
    } as never);
    assert.equal(result.status, 'Approved');

    const matched = await Users.findOne({ id: profileId });
    const other = await Users.findOne({ id: otherProfileId });
    const stub = await Users.findOne({ id: authUid });
    assert.equal(matched.firebaseUid, authUid);
    assert.equal(typeof matched.authLinkedAt, 'string');
    assert.equal(matched.fullName, 'Matched Devotee');
    assert.equal(matched.role, 'User');
    assert.equal(other.firebaseUid, undefined);
    assert.equal(other.fullName, 'Other Devotee');
    assert.equal(stub, undefined);

    const linked = await resolveAuthenticatedProfile(authUid, email);
    assert.equal(linked?.id, profileId);
    assert.equal(linked?.userId, 'USER-LINK-1');
  } finally {
    await cleanup();
  }
});

test('rejection leaves every record unchanged, and an already linked login is not reviewed again', async () => {
  await cleanup();
  await seedUnlinkedMatch();
  try {
    await resolveAuthenticatedProfile(authUid, email);
    const rejected = await reviewAccountLink.execute({
      input: { requestId: accountLinkRequestId(authUid), action: 'reject' },
      context: { user: { id: 'admin-reviewer', role: 'SUPER_ADMIN', capabilities: ['*'] } },
    } as never);
    assert.equal(rejected.status, 'Rejected');

    const login = await resolveUserLogin.execute({ input: {}, context: loginContext() } as never);
    assert.equal(login.action, 'account_link_rejected');
    assert.equal((await Users.findOne({ id: authUid }))?.id, authUid);
    assert.equal((await Users.findOne({ id: profileId }))?.firebaseUid, undefined);
    assert.equal((await Users.findOne({ id: otherProfileId }))?.id, otherProfileId);

    await Users.update({ id: profileId, record: { firebaseUid: 'already-linked-uid' } });
    await assert.rejects(
      () => reviewAccountLink.execute({
        input: { requestId: accountLinkRequestId(authUid), action: 'reopen' },
        context: { user: { id: 'admin-reviewer', role: 'ADMIN' } },
      } as never).then(() => reviewAccountLink.execute({
        input: { requestId: accountLinkRequestId(authUid), action: 'approve', profileId },
        context: { user: { id: 'admin-reviewer', role: 'ADMIN' } },
      } as never)),
      (error: any) => error.code === 'CONFLICT',
    );
    assert.equal((await Users.findOne({ id: profileId })).firebaseUid, 'already-linked-uid');
    assert.equal((await Users.findOne({ id: authUid }))?.id, authUid);
  } finally {
    await cleanup();
  }
});

test('an existing firebase uid link signs in without merging or deleting records', async () => {
  const linkedAuth = 'auth-already-linked';
  const linkedProfile = 'profile-already-linked';
  const linkedEmail = 'already-linked@example.invalid';
  await Users.create({
    record: { id: linkedAuth, email: linkedEmail, createdAt: '2026-10-01T00:00:00.000Z' },
  });
  await Users.create({
    record: {
      id: linkedProfile,
      userId: 'USER-ALREADY',
      fullName: 'Linked Devotee',
      email: linkedEmail,
      role: 'User',
      status: 'Active',
      segment: 'PW',
      firebaseUid: linkedAuth,
    },
  });
  try {
    const resolved = await resolveAuthenticatedProfile(linkedAuth, linkedEmail);
    assert.equal(resolved?.id, linkedProfile);
    assert.equal((await AccountLinkRequests.findOne({ id: accountLinkRequestId(linkedAuth) })), undefined);
    assert.equal((await Users.findOne({ id: linkedAuth }))?.id, linkedAuth);
    assert.equal((await Users.findOne({ id: linkedProfile }))?.fullName, 'Linked Devotee');
  } finally {
    await Users.delete({ id: linkedAuth }).catch(() => undefined);
    await Users.delete({ id: linkedProfile }).catch(() => undefined);
    await AccountLinkRequests.delete({ id: accountLinkRequestId(linkedAuth) }).catch(() => undefined);
  }
});

test('registration does not take over an unlinked profile with the same email', async () => {
  await cleanup();
  await Users.create({
    record: {
      id: profileId,
      userId: 'USER-LINK-1',
      fullName: 'Matched Devotee',
      email,
      role: 'User',
      status: 'Active',
      segment: 'PW',
    },
  });
  try {
    await assert.rejects(
      () => (registerUser as any).execute({
        input: {
          fullName: 'New Person',
          phoneCountryCode: '+91',
          phone: '9000000001',
          phoneE164: '+919000000001',
          email,
          residencyUserClaim: false,
          isPrabhupadaWorldUser: true,
        },
        context: loginContext(),
      }),
      (error: any) => error.code === 'CONFLICT',
    );
    const matched = await Users.findOne({ id: profileId });
    assert.equal(matched.fullName, 'Matched Devotee');
    assert.equal(matched.firebaseUid, undefined);
    assert.equal(matched.status, 'Active');
    const request = await AccountLinkRequests.findOne({ id: accountLinkRequestId(authUid) });
    assert.equal(request.status, 'Pending');
  } finally {
    await cleanup();
  }
});
