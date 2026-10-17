import assert from 'node:assert/strict';
import test from 'node:test';

import getUserProfile from '../src/api/getUserProfile';
import resolveUserLogin from '../src/api/resolveUserLogin';
import updateLastLogin from '../src/api/updateLastLogin';
import { BvGroupMembers, Users } from '../src/lib/app-backend-sdk';

test('an authentication-only Users record remains unregistered', async () => {
  const id = 'AUTH-ONLY-REGRESSION-TEST';
  const email = 'auth-only-regression-test@example.invalid';
  const context = {
    user: {
      id,
      uid: id,
      userId: id,
      email,
      role: 'UNREGISTERED',
      status: null,
    },
  };

  await Users.create({
    record: {
      id,
      email,
      createdAt: new Date().toISOString(),
    },
  });

  try {
    const profile = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(profile.user, null);

    const login = await resolveUserLogin.execute({ input: {}, context } as never);
    assert.equal(login.action, 'register');

    const lastLogin = await updateLastLogin.execute({ input: {}, context } as never);
    assert.equal(lastLogin.success, false);

    const stored = await Users.findOne({ id });
    assert.equal(stored.userId, undefined);
    assert.equal(stored.status, undefined);
    assert.equal(stored.lastLoginAt, undefined);
  } finally {
    await Users.delete({ id });
  }
});

test('a complete registered profile still resolves and updates last login', async () => {
  const id = 'REGISTERED-PROFILE-REGRESSION-TEST';
  const email = 'registered-profile-regression-test@example.invalid';
  const context = {
    user: {
      id,
      uid: id,
      userId: 'USER-REGRESSION-TEST',
      email,
      role: 'User',
      status: 'Active',
    },
  };

  await Users.create({
    record: {
      id,
      userId: 'USER-REGRESSION-TEST',
      fullName: 'Registered Regression Test',
      email,
      role: 'User',
      status: 'Active',
      segment: 'PW',
      createdAt: new Date().toISOString(),
    },
  });

  try {
    const profile = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(profile.user?.userId, 'USER-REGRESSION-TEST');
    assert.equal(profile.user?.status, 'ACTIVE');

    const login = await resolveUserLogin.execute({ input: {}, context } as never);
    assert.equal(login.action, 'route');

    const lastLogin = await updateLastLogin.execute({ input: {}, context } as never);
    assert.equal(lastLogin.success, true);

    const stored = await Users.findOne({ id });
    assert.equal(typeof stored.lastLoginAt, 'string');
  } finally {
    await Users.delete({ id });
  }
});

test('profile reuses the user record already loaded to authorize the request', async () => {
  const id = 'LOADED-PROFILE-REUSE-TEST';
  const email = 'loaded-profile-reuse-test@example.invalid';
  const record = {
    id,
    userId: 'USER-LOADED-REUSE',
    fullName: 'Loaded Reuse',
    email,
    role: 'User',
    status: 'Active',
    segment: 'PW',
    lastLoginAt: '2026-10-17T00:00:00.000Z',
  };
  const context = {
    user: { id, uid: id, userId: record.userId, email, role: 'User', status: 'Active' },
    loadedProfile: record,
  };

  const profile = await getUserProfile.execute({ input: {}, context } as never);
  assert.equal(profile.user?.userId, 'USER-LOADED-REUSE');
  assert.equal(profile.user?.fullName, 'Loaded Reuse');
  assert.equal(profile.user?.isBvMember, false);
  assert.equal(await Users.findOne({ id }), undefined);
});

test('a membership stored only by member id or a legacy user array is found without a prior flag', async () => {
  const id = 'MEMBERSHIP-INDEX-PROFILE-TEST';
  const email = 'membership-index-profile-test@example.invalid';
  const userId = 'USER-MEMBERSHIP-INDEX';
  const context = { user: { id, uid: id, userId, email, role: 'User', status: 'Active' } };
  await Users.create({ record: { id, userId, fullName: 'Indexed Member', email, role: 'User', status: 'Active', segment: 'PW' } });
  await BvGroupMembers.create({ record: { id: 'MEM-BY-MEMBER-ID', memberId: email, group: 'GROUP-1', role: 'Member' } });

  try {
    const byMemberId = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(byMemberId.user?.isBvMember, true);
    assert.equal(byMemberId.user?.bvGroupId, 'GROUP-1');

    await BvGroupMembers.delete({ id: 'MEM-BY-MEMBER-ID' });
    await Users.update({ id, record: { isBvMember: false, bvGroupId: '', bvRegistrationStatus: '' } });
    await BvGroupMembers.create({ record: { id: 'MEM-BY-USER-ARRAY', user: [userId], group: 'GROUP-2', role: 'Member' } });
    const byArray = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(byArray.user?.isBvMember, true);
    assert.equal(byArray.user?.bvGroupId, 'GROUP-2');
  } finally {
    await BvGroupMembers.delete({ id: 'MEM-BY-MEMBER-ID' }).catch(() => undefined);
    await BvGroupMembers.delete({ id: 'MEM-BY-USER-ARRAY' }).catch(() => undefined);
    await Users.delete({ id }).catch(() => undefined);
  }
});
